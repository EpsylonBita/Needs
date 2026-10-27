-- A successful capture webhook must resolve the capture reservation in the
-- same transaction. Otherwise a completed payment remains blocked for refunds
-- and seller recovery until an unrelated reconciliation happens to run.
begin;
create or replace function public.process_stripe_webhook_event(
  p_event jsonb,
  p_payment_intent text default null,
  p_request_id text default null
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  event_id text := p_event->>'id';
  event_type text := p_event->>'type';
  obj jsonb := p_event#>'{data,object}';
  prior public.webhook_events%rowtype;
  payment public.payments%rowtype;
  existing_dispute public.disputes%rowtype;
  amount_value numeric;
  fee_value numeric;
  refund_recorded numeric;
  changed boolean := false;
  action_name text := 'ignored';
  reason text := 'unhandled_event_type';
  result jsonb;
  metadata_value jsonb;
begin
  if coalesce(event_id, '') = '' or coalesce(event_type, '') = '' or obj is null then
    raise exception 'Invalid Stripe event';
  end if;

  insert into public.webhook_events(id, source, event_type, payload)
    values(event_id, 'stripe', event_type, p_event) on conflict (id) do nothing;
  select * into prior from public.webhook_events where id = event_id for update;
  -- Validate the immutable succeeded intent before terminal-state or duplicate
  -- handling. Never release a reservation on a mismatched or partial capture.
  if event_type = 'payment_intent.succeeded' then
    select * into payment from public.payments
      where stripe_payment_intent = p_payment_intent for update;
    if not found then raise exception 'Payment not found for Stripe intent %', p_payment_intent; end if;
    if obj->>'id' is distinct from p_payment_intent
      or obj->>'status' is distinct from 'succeeded'
      or obj->>'capture_method' is distinct from 'manual'
      or (obj->>'amount')::numeric is distinct from payment.amount * 100
      or (obj->>'amount_received')::numeric is distinct from payment.amount * 100
      or (obj->>'amount_capturable')::numeric is distinct from 0
      or coalesce((obj->>'application_fee_amount')::numeric, 0) is distinct from coalesce(payment.platform_fee, 0) * 100
      or obj->>'currency' is distinct from payment.currency
      or obj#>>'{metadata,listing_id}' is distinct from payment.listing_id::text
      or obj#>>'{metadata,buyer_profile_id}' is distinct from payment.buyer_id::text
      or obj#>>'{metadata,seller_profile_id}' is distinct from payment.seller_id::text then
      raise exception 'Stripe capture evidence does not match the payment' using errcode='23514';
    end if;
    -- A replay also repairs a historical completed capture reservation. Active
    -- and canceled orders retain their existing claims and lifecycle guards.
    if payment.status in ('completed','refunded','disputed')
      and payment.stripe_canceled_at is null and payment.cancel_claim_id is null then
      update public.payments set capture_claim_id=null,capture_claimed_at=null
        where id=payment.id and capture_claim_id is not null;
    end if;
  end if;
  -- Legacy code wrote processed_at BEFORE processing, including on failure.
  -- A persisted successful result is the only trustworthy completion marker.
  if prior.processed_at is not null and prior.processing_result is not null
     and prior.processing_error is null
     and coalesce(prior.processing_result->>'reason', '') <> 'payment_not_found' then
    return jsonb_build_object('duplicate', true, 'action', 'already_processed');
  end if;

  if event_type in ('payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.canceled', 'payment_intent.amount_capturable_updated',
    'charge.refunded', 'transfer.created', 'transfer.failed',
    'charge.dispute.created', 'charge.dispute.closed') then
    if p_payment_intent is null then
      reason := 'no_payment_intent';
    else
      select * into payment from public.payments
        where stripe_payment_intent = p_payment_intent for update;
      if not found then
        -- Stripe may deliver before create-intent finishes saving its payment.
        raise exception 'Payment not found for Stripe intent %', p_payment_intent;
      end if;
      amount_value := coalesce((obj->>'amount')::numeric, 0) / 100;
      fee_value := coalesce((obj->>'application_fee_amount')::numeric, 0) / 100;
      metadata_value := jsonb_build_object('stripe_event_id', event_id,
        'stripe_payment_intent_id', p_payment_intent, 'request_id', p_request_id,
        'stripe_object_id', obj->>'id');

      case event_type
        when 'payment_intent.amount_capturable_updated' then
          if payment.status = 'requires_capture' and coalesce((obj->>'amount_capturable')::numeric, 0) > 0 then
            update public.milestones set status = 'requires_capture'
              where id = payment.milestone_id and status = 'pending';
            action_name := 'payment_authorized'; changed := true;
          else reason := 'payment_already_settled'; end if;
        when 'payment_intent.succeeded' then
          if payment.status in ('completed', 'refunded', 'disputed') then
            reason := 'payment_already_settled';
          else
            update public.payments set status = 'completed', completed_at = now(),
              buyer_confirmed = payment.buyer_confirmed or coalesce((select m.buyer_confirmed from public.milestones m where m.id = payment.milestone_id), false),
              seller_confirmed = payment.seller_confirmed or coalesce((select m.seller_confirmed from public.milestones m where m.id = payment.milestone_id), false)
              where id = payment.id;
            insert into public.transactions(payment_id, type, amount, fee, status, metadata)
              values(payment.id, 'charge', amount_value, fee_value, 'succeeded', metadata_value);
            update public.milestones set status = 'completed', completed_at = now(),
              buyer_confirmed = true, seller_confirmed = true
              where stripe_payment_intent = p_payment_intent
                and buyer_id = payment.buyer_id and seller_id = payment.seller_id;
            action_name := 'payment_completed'; changed := true;
          end if;
          -- Settlement and release of its capture reservation commit together.
          -- The HTTP capture acknowledgment alone deliberately cannot do this.
          update public.payments set capture_claim_id=null,capture_claimed_at=null
            where id=payment.id and status in ('completed','refunded','disputed')
              and stripe_canceled_at is null and cancel_claim_id is null
              and capture_claim_id is not null;
        when 'payment_intent.payment_failed', 'payment_intent.canceled' then
          if payment.status in ('completed', 'refunded', 'disputed', 'failed') then
            reason := 'payment_already_settled';
          else
            if event_type = 'payment_intent.canceled' then
              update public.payments set status = 'failed', failed_at = now() where id = payment.id;
              update public.milestones set status = 'failed'
                where stripe_payment_intent = p_payment_intent and status <> 'completed';
            end if;
            insert into public.transactions(payment_id, type, amount, status, metadata)
              values(payment.id, 'charge', amount_value, 'failed', metadata_value);
            action_name := 'payment_failed'; changed := true;
          end if;
        when 'charge.refunded' then
          amount_value := coalesce((obj->>'amount_refunded')::numeric, 0) / 100;
          -- amount_refunded is cumulative, so record only its new delta. Also
          -- covers a different event ID for the same underlying refund.
          select coalesce(sum(t.amount), 0) into refund_recorded from public.transactions t
            where t.payment_id = payment.id and t.type = 'refund' and t.status = 'succeeded';
          if amount_value <= refund_recorded then
            reason := 'refund_already_recorded';
          else
            insert into public.transactions(payment_id, type, amount, status, metadata)
              values(payment.id, 'refund', amount_value - refund_recorded, 'succeeded', metadata_value);
            if amount_value >= payment.amount then
              update public.payments set status = 'refunded', refunded_at = now() where id = payment.id;
            end if;
            action_name := 'payment_refunded'; changed := true;
          end if;
        when 'transfer.created', 'transfer.failed' then
          if exists(select 1 from public.transactions t where t.payment_id = payment.id
              and t.type = 'transfer' and coalesce(t.metadata->>'stripe_object_id', t.metadata->>'stripe_transfer_id') = obj->>'id'
              and t.status = case when event_type = 'transfer.created' then 'created' else 'failed' end) then
            reason := 'transfer_already_recorded';
          else
            insert into public.transactions(payment_id, type, amount, status, metadata)
              values(payment.id, 'transfer', amount_value,
                case when event_type = 'transfer.created' then 'created' else 'failed' end, metadata_value);
            action_name := case when event_type = 'transfer.created' then 'transfer_created' else 'transfer_failed' end;
            changed := true;
          end if;
        when 'charge.dispute.created', 'charge.dispute.closed' then
          select * into existing_dispute from public.disputes
            where payment_id = payment.id and stripe_dispute_id = obj->>'id' limit 1 for update;
          if event_type = 'charge.dispute.created' then
            if existing_dispute.id is not null then
              reason := 'dispute_already_recorded';
            else
              insert into public.disputes(payment_id, stripe_dispute_id, reason, status, amount, currency)
                values(payment.id, obj->>'id', coalesce(obj->>'reason', 'unknown'), 'open', amount_value, coalesce(obj->>'currency',payment.currency));
              update public.payments set status = 'disputed', disputed_at = now() where id = payment.id;
              action_name := 'dispute_opened'; changed := true;
            end if;
          else
            if obj->>'status' not in ('won', 'lost', 'warning_closed', 'prevented') then
              raise exception 'Unexpected closed dispute status';
            end if;
            if existing_dispute.id is not null and existing_dispute.status in ('won', 'lost', 'resolved', 'refunded', 'rejected') then
              reason := 'dispute_already_closed';
            else
              -- Closed may arrive before created. Scope updates to this Stripe
              -- dispute, never every dispute belonging to the same payment.
              if existing_dispute.id is null then
                insert into public.disputes(payment_id, stripe_dispute_id, reason, status, amount, currency, resolved_at)
                  values(payment.id, obj->>'id', coalesce(obj->>'reason', 'unknown'),
                    case when obj->>'status' in ('warning_closed','prevented') then 'resolved' else obj->>'status' end, amount_value, coalesce(obj->>'currency',payment.currency), now());
              else
                update public.disputes set status = case when obj->>'status' in ('warning_closed','prevented') then 'resolved' else obj->>'status' end,
                  resolved_at = now(), amount=amount_value, currency=coalesce(obj->>'currency',payment.currency) where id = existing_dispute.id;
              end if;
              if payment.status <> 'refunded' and (payment.status = 'disputed' or obj->>'status' = 'lost') then
                update public.payments set status = case when obj->>'status' = 'lost' then 'refunded' else 'completed' end
                  where id = payment.id;
              end if;
              action_name := 'dispute_resolved'; changed := true;
            end if;
          end if;
      end case;

      if changed then
        insert into public.payment_audit_logs(payment_id, action, metadata)
          values(payment.id, action_name, metadata_value || jsonb_build_object('actor_type', 'system', 'amount', amount_value, 'fee', fee_value));
        if action_name in ('payment_completed', 'transfer_created', 'dispute_opened', 'dispute_resolved') then
          insert into public.notifications(user_id, type, payload)
            values(payment.seller_id, action_name, metadata_value || jsonb_build_object('payment_id', payment.id, 'amount', amount_value));
          if action_name <> 'transfer_created' then
            insert into public.notifications(user_id, type, payload)
              values(payment.buyer_id, case when action_name = 'payment_completed' then 'payment_sent' else action_name end,
                metadata_value || jsonb_build_object('payment_id', payment.id, 'amount', amount_value));
          end if;
        end if;
      end if;
    end if;
  end if;
  result := jsonb_build_object('duplicate', false, 'action', action_name, 'reason', case when changed then null else reason end, 'paymentId', payment.id);
  update public.webhook_events set source = 'stripe', event_type = p_event->>'type',
    payload = p_event, processed_at = now(), processing_result = result, processing_error = null
    where id = event_id;
  return result;
end;
$$;
commit;
