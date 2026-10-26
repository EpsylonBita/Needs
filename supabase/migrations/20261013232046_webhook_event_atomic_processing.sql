-- Apply after the legacy supabase/sql baseline. No external payment calls occur here.
-- Keep the event marker and its effects in the SAME transaction. A failed call
-- rolls back the marker too, so both concurrent and retried deliveries are safe.
alter table public.webhook_events enable row level security;
revoke all on public.webhook_events from anon, authenticated;
grant select, insert, update on public.webhook_events to service_role;

alter table public.disputes add column if not exists resolved_at timestamptz;
alter table public.payments add column if not exists milestone_id uuid references public.milestones(id);
-- Existing intents were denominated in USD; new checkout requests use EUR.
alter table public.payments add column if not exists currency text not null default 'usd';
alter table public.milestones add column if not exists currency text not null default 'usd';
alter table public.payment_audit_logs add column if not exists actor_type text;
alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments add constraint payments_status_check
  check (status in ('requires_capture', 'completed', 'refunded', 'failed', 'disputed'));
alter table public.disputes drop constraint if exists disputes_status_check;
alter table public.disputes add constraint disputes_status_check
  check (status in ('open', 'resolved', 'refunded', 'rejected', 'won', 'lost'));

-- A listing can have several milestones, each with its own payment.
drop index if exists public.payments_unique_open_intent;
create unique index payments_unique_open_intent
  on public.payments (buyer_id, listing_id)
  where status in ('requires_capture', 'requires_payment_method') and milestone_id is null;
create unique index if not exists payments_milestone_uidx on public.payments(milestone_id)
  where milestone_id is not null and status <> 'failed';

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
              insert into public.disputes(payment_id, stripe_dispute_id, reason, status, amount)
                values(payment.id, obj->>'id', coalesce(obj->>'reason', 'unknown'), 'open', payment.amount);
              update public.payments set status = 'disputed', disputed_at = now() where id = payment.id;
              action_name := 'dispute_opened'; changed := true;
            end if;
          else
            if obj->>'status' not in ('won', 'lost', 'warning_closed') then
              raise exception 'Unexpected closed dispute status';
            end if;
            if existing_dispute.id is not null and existing_dispute.status in ('won', 'lost', 'resolved', 'refunded', 'rejected') then
              reason := 'dispute_already_closed';
            else
              -- Closed may arrive before created. Scope updates to this Stripe
              -- dispute, never every dispute belonging to the same payment.
              if existing_dispute.id is null then
                insert into public.disputes(payment_id, stripe_dispute_id, reason, status, amount, resolved_at)
                  values(payment.id, obj->>'id', coalesce(obj->>'reason', 'unknown'),
                    case when obj->>'status' = 'warning_closed' then 'resolved' else obj->>'status' end, payment.amount, now());
              else
                update public.disputes set status = case when obj->>'status' = 'warning_closed' then 'resolved' else obj->>'status' end,
                  resolved_at = now() where id = existing_dispute.id;
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
revoke all on function public.process_stripe_webhook_event(jsonb, text, text) from public, anon, authenticated;
grant execute on function public.process_stripe_webhook_event(jsonb, text, text) to service_role;

-- A milestone and the payment needed by capture/webhooks are one local commit.
create or replace function public.create_milestone_payment(
  p_listing_id uuid, p_buyer_id uuid, p_seller_id uuid, p_title text,
  p_amount numeric, p_platform_fee numeric, p_intent_id text, p_milestone_id uuid default null
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  listing_price numeric;
  existing public.payments%rowtype;
  total numeric;
  milestone_id_value uuid;
  payment_id_value uuid;
  proposal public.milestones%rowtype;
begin
  select price into listing_price from public.listings where id = p_listing_id
    and seller_id = p_seller_id and status = 'active' for update;
  if not found then raise exception 'Listing not found or unavailable'; end if;
  select * into existing from public.payments where stripe_payment_intent = p_intent_id;
  if found then
    if existing.buyer_id <> p_buyer_id or existing.seller_id <> p_seller_id
       or existing.listing_id <> p_listing_id or existing.amount <> p_amount or existing.milestone_id is null
       or (p_milestone_id is not null and existing.milestone_id <> p_milestone_id) then
      raise exception 'Intent does not match this milestone';
    end if;
    return jsonb_build_object('payment_id', existing.id, 'milestone_id', existing.milestone_id);
  end if;
  if p_buyer_id = p_seller_id or p_amount <= 0 or p_amount <> round(p_amount, 2)
     or length(btrim(p_title)) not between 1 and 200 or p_platform_fee < 0 or p_platform_fee > p_amount then
    raise exception 'Invalid milestone payment';
  end if;
  if p_milestone_id is not null then
    select * into proposal from public.milestones where id = p_milestone_id for update;
    if not found or proposal.listing_id <> p_listing_id or proposal.buyer_id <> p_buyer_id
       or proposal.seller_id <> p_seller_id or proposal.amount <> p_amount or proposal.title <> p_title
       or (proposal.stripe_payment_intent is not null and proposal.status <> 'failed')
       or proposal.status not in ('pending', 'failed') then
      raise exception 'Milestone proposal does not match this payment';
    end if;
  else
    select * into proposal from public.milestones where listing_id = p_listing_id and buyer_id = p_buyer_id
      and seller_id = p_seller_id and title = p_title and amount = p_amount
      and stripe_payment_intent is null and status = 'pending' order by created_at, id limit 1 for update;
  end if;
  select coalesce(sum(amount), 0) into total from public.milestones
    where listing_id = p_listing_id and buyer_id = p_buyer_id and status <> 'failed'
      and (proposal.id is null or id <> proposal.id);
  if total + p_amount > listing_price then
    raise exception 'Total milestone amount would exceed listing price';
  end if;
  if proposal.id is null then
    insert into public.milestones(listing_id, buyer_id, seller_id, title, amount, stripe_payment_intent, status, currency)
      values(p_listing_id, p_buyer_id, p_seller_id, p_title, p_amount, p_intent_id, 'pending', 'eur')
      returning id into milestone_id_value;
  else
    milestone_id_value := proposal.id;
    update public.milestones set stripe_payment_intent = p_intent_id, status = 'pending', currency = 'eur',
      buyer_confirmed = false, seller_confirmed = false where id = proposal.id;
  end if;
  insert into public.payments(listing_id, buyer_id, seller_id, amount, platform_fee, stripe_payment_intent, status, buyer_confirmed, seller_confirmed, milestone_id, currency)
    values(p_listing_id, p_buyer_id, p_seller_id, p_amount, p_platform_fee, p_intent_id, 'requires_capture', false, false, milestone_id_value, 'eur')
    returning id into payment_id_value;
  insert into public.payment_audit_logs(payment_id, buyer_id, seller_id, listing_id, amount, platform_fee, action, metadata)
    values(payment_id_value, p_buyer_id, p_seller_id, p_listing_id, p_amount, p_platform_fee,
      'milestone_payment_created', jsonb_build_object('milestone_id', milestone_id_value, 'intent_id', p_intent_id));
  return jsonb_build_object('payment_id', payment_id_value, 'milestone_id', milestone_id_value);
end;
$$;

-- Chat saves an unfunded proposal. Serialize totals with funding on the listing.
create or replace function public.create_milestone_proposal(
  p_listing_id uuid, p_buyer_id uuid, p_title text, p_amount numeric
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare target public.listings%rowtype; total numeric; proposal_id uuid;
begin
  select * into target from public.listings where id = p_listing_id for update;
  if not found or target.status <> 'active' or target.seller_id = p_buyer_id then
    raise exception 'Listing is unavailable for this milestone';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2)
     or p_title is null or length(btrim(p_title)) not between 1 and 200 then
    raise exception 'Invalid milestone title or amount';
  end if;
  select coalesce(sum(amount), 0) into total from public.milestones
    where listing_id = p_listing_id and buyer_id = p_buyer_id and status <> 'failed';
  if total + p_amount > target.price then raise exception 'Total milestone amount would exceed listing price'; end if;
  insert into public.milestones(listing_id,buyer_id,seller_id,title,amount,currency)
    values(p_listing_id,p_buyer_id,target.seller_id,btrim(p_title),p_amount,'eur') returning id into proposal_id;
  return proposal_id;
end;
$$;
revoke all on function public.create_milestone_proposal(uuid,uuid,text,numeric) from public,anon,authenticated;
grant execute on function public.create_milestone_proposal(uuid,uuid,text,numeric) to service_role;

-- Row-level policies restrict participants; this guard also restricts fields.
create or replace function public.guard_payment_confirmation() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare profile_id uuid;
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then return new; end if;
  select id into profile_id from public.profiles where user_id = auth.uid();
  if profile_id is null or profile_id not in (old.buyer_id, old.seller_id) then
    raise exception 'Only payment participants may confirm';
  end if;
  if (to_jsonb(new) - 'buyer_confirmed' - 'seller_confirmed')
      is distinct from (to_jsonb(old) - 'buyer_confirmed' - 'seller_confirmed') then
    raise exception 'Only your own confirmation may be changed';
  end if;
  if (new.buyer_confirmed is distinct from old.buyer_confirmed and profile_id <> old.buyer_id)
     or (new.seller_confirmed is distinct from old.seller_confirmed and profile_id <> old.seller_id) then
    raise exception 'Only your own confirmation may be changed';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_payment_confirmation() from public,anon,authenticated;
drop trigger if exists payments_confirmation_guard on public.payments;
create trigger payments_confirmation_guard before update on public.payments
  for each row execute function public.guard_payment_confirmation();
drop trigger if exists milestones_confirmation_guard on public.milestones;
create trigger milestones_confirmation_guard before update on public.milestones
  for each row execute function public.guard_payment_confirmation();
revoke all on function public.create_milestone_payment(uuid, uuid, uuid, text, numeric, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.create_milestone_payment(uuid, uuid, uuid, text, numeric, numeric, text, uuid) to service_role;

-- Reusing Stripe's idempotency key must also reuse the local payment, rather
-- than hitting its unique index and cancelling an already valid intent.
create or replace function public.create_listing_payment(
  p_listing_id uuid, p_buyer_id uuid, p_seller_id uuid,
  p_amount numeric, p_platform_fee numeric, p_intent_id text
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  listing_price numeric;
  existing public.payments%rowtype;
  payment_id_value uuid;
begin
  select price into listing_price from public.listings where id = p_listing_id
    and seller_id = p_seller_id and status = 'active' for update;
  if not found then raise exception 'Listing not found or unavailable'; end if;
  select * into existing from public.payments where stripe_payment_intent = p_intent_id;
  if found then
    if existing.buyer_id <> p_buyer_id or existing.seller_id <> p_seller_id
       or existing.listing_id <> p_listing_id or existing.amount <> p_amount or existing.milestone_id is not null then
      raise exception 'Intent does not match this listing';
    end if;
    return jsonb_build_object('payment_id', existing.id);
  end if;
  if p_buyer_id = p_seller_id or p_amount <= 0 or p_amount <> listing_price
     or p_platform_fee < 0 or p_platform_fee > p_amount then
    raise exception 'Invalid listing payment';
  end if;
  insert into public.payments(listing_id,buyer_id,seller_id,amount,platform_fee,stripe_payment_intent,status,currency)
    values(p_listing_id,p_buyer_id,p_seller_id,p_amount,p_platform_fee,p_intent_id,'requires_capture','eur')
    returning id into payment_id_value;
  insert into public.payment_audit_logs(payment_id,action,buyer_id,seller_id,listing_id,amount,platform_fee,metadata)
    values(payment_id_value,'payment_record_created',p_buyer_id,p_seller_id,p_listing_id,p_amount,p_platform_fee,jsonb_build_object('intent_id',p_intent_id));
  return jsonb_build_object('payment_id',payment_id_value);
end;
$$;
revoke all on function public.create_listing_payment(uuid,uuid,uuid,numeric,numeric,text) from public, anon, authenticated;
grant execute on function public.create_listing_payment(uuid,uuid,uuid,numeric,numeric,text) to service_role;

grant select on public.listings to service_role;
grant select,insert,update on public.payments,public.milestones,public.transactions,
  public.disputes,public.notifications,public.payment_audit_logs to service_role;

-- Older privileged finance helpers must never remain browser-callable.
do $$
declare signature text;
begin
  foreach signature in array array[
    'public.payment_complete_atomic(text,numeric,numeric,uuid)',
    'public.payment_fail_atomic(text,numeric)',
    'public.payment_refund_atomic(text,numeric)',
    'public.create_payment_with_audit(uuid,uuid,uuid,numeric,numeric,text)'
  ] loop
    if to_regprocedure(signature) is not null then
      execute 'revoke all on function ' || signature || ' from public,anon,authenticated';
      execute 'grant execute on function ' || signature || ' to service_role';
    end if;
  end loop;
end;
$$;
