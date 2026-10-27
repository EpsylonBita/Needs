begin;

-- A successful provider read resolves transient authorization/refund alerts,
-- but it is not an administrator's settlement decision. Keep only the durable
-- late-win/recovery review reasons visible through later worker observations.
create or replace function needs_private.order_financial_review_required(p_payment_id uuid)
returns boolean language sql stable set search_path='' as $$
  select exists(
    select 1 from public.payment_audit_logs a
    where a.payment_id=p_payment_id and a.action='dispute_resolved'
      and a.actor_type='system'
      and a.metadata @> '{"source":"stripe_api","late_win":true}'::jsonb
  ) or exists(
    select 1 from public.payment_recoveries r
    where r.payment_id=p_payment_id
      and(r.status='review_required' or r.last_error_code='late_win_after_recovery')
  )
$$;
revoke all on function needs_private.order_financial_review_required(uuid) from public,anon,authenticated;

create or replace function public.reconcile_order_provider(
  p_payment_id uuid,p_intent_id text,p_provider_status text,p_amount_cents bigint,p_currency text,
  p_amount_capturable bigint,p_amount_received bigint,p_platform_fee_cents bigint,
  p_capture_before timestamptz,p_read_started_at timestamptz,p_lease_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare payment public.payments%rowtype; recipient uuid; settled boolean; contradiction boolean; buyer_done boolean; seller_done boolean;
begin
  payment:=needs_private.lock_order_provider(p_payment_id);
  if p_intent_id is distinct from payment.stripe_payment_intent or p_amount_cents is distinct from(payment.amount*100)::bigint
    or p_platform_fee_cents is distinct from(coalesce(payment.platform_fee,0)*100)::bigint or p_currency is distinct from payment.currency
    or p_amount_capturable is null or p_amount_capturable<0 or p_amount_received is null or p_amount_received<0
    or p_provider_status is null or p_provider_status not in('requires_payment_method','requires_confirmation','requires_action','processing','requires_capture','succeeded','canceled')
    or p_read_started_at is null or p_read_started_at>clock_timestamp()+interval '1 minute' then
    raise exception 'Provider snapshot does not match the order' using errcode='23514';
  end if;
  if p_lease_id is not null and (payment.reconciliation_lease_id is distinct from p_lease_id or payment.reconciliation_lease_until is null or payment.reconciliation_lease_until<=clock_timestamp()) then
    return jsonb_build_object('applied',false);
  end if;
  if payment.provider_read_started_at is not null and p_read_started_at<=payment.provider_read_started_at then return jsonb_build_object('applied',false); end if;
  -- A verified cancellation webhook may have committed while this earlier API
  -- read was in flight. Generic local 'failed' alone is not terminal evidence.
  if p_provider_status<>'canceled' and exists(select 1 from public.webhook_events
    where event_type='payment_intent.canceled' and processed_at is not null and processing_error is null
      and payload#>>'{data,object,id}'=p_intent_id) then return jsonb_build_object('applied',false); end if;
  settled:=payment.status in('completed','refunded','disputed') or exists(select 1 from public.transactions where payment_id=payment.id and type='charge' and status='succeeded');
  select coalesce(payment.buyer_confirmed,false) or coalesce(bool_or(buyer_confirmed),false),
    coalesce(payment.seller_confirmed,false) or coalesce(bool_or(seller_confirmed),false) into buyer_done,seller_done
    from public.milestones where id=payment.milestone_id and stripe_payment_intent=p_intent_id
      and buyer_id=payment.buyer_id and seller_id=payment.seller_id and listing_id=payment.listing_id;
  contradiction:=(settled and p_provider_status<>'succeeded') or(payment.stripe_canceled_at is not null and p_provider_status<>'canceled');
  if contradiction then
    update public.payments set attention_required=true,provider_read_started_at=p_read_started_at,provider_checked_at=clock_timestamp() where id=payment.id;
    foreach recipient in array array[payment.buyer_id,payment.seller_id] loop
      perform needs_private.notify_order(payment.id,recipient,'payment_attention_required','provider_terminal_conflict',jsonb_build_object('reason_code','provider_terminal_conflict'));
    end loop;
    return jsonb_build_object('applied',false);
  end if;
  if (p_provider_status='requires_capture' and (p_amount_capturable<>p_amount_cents or p_amount_received<>0))
    or(p_provider_status='succeeded' and(p_amount_received<>p_amount_cents or p_amount_capturable<>0))
    or(p_provider_status='canceled' and(p_amount_capturable<>0 or p_amount_received<>0)) then
    raise exception 'Provider financial totals do not match the order' using errcode='23514';
  end if;
  update public.payments set provider_status=p_provider_status,provider_checked_at=clock_timestamp(),provider_read_started_at=p_read_started_at,
    authorization_expires_at=case when p_provider_status='requires_capture' then p_capture_before else authorization_expires_at end,
    attention_required=(p_provider_status='requires_capture' and(p_capture_before is null or p_capture_before<=clock_timestamp()))
      or(p_provider_status='succeeded' and not(buyer_done and seller_done))
      or needs_private.order_bank_loss_attention(payment.id)
      or needs_private.order_financial_review_required(payment.id)
      or exists(select 1 from public.transactions where payment_id=payment.id and type='refund' and status in('failed','canceled','requires_action')),
    reconciliation_next_at=clock_timestamp()+case when p_provider_status in('succeeded','canceled') then interval '6 hours' else interval '5 minutes' end
    where id=payment.id;
  if p_provider_status='requires_capture' and not settled and payment.stripe_canceled_at is null then
    update public.payments set status='requires_capture' where id=payment.id;
    if not exists(select 1 from public.payment_audit_logs where payment_id=payment.id and action='payment_authorized') then
      insert into public.payment_audit_logs(payment_id,action,actor_type,metadata) values(payment.id,'payment_authorized','system',jsonb_build_object('source','stripe_api','read_started_at',p_read_started_at));
    end if;
    update public.milestones set status='requires_capture' where id=payment.milestone_id and stripe_payment_intent=p_intent_id and status not in('completed','refunded');
  elsif p_provider_status='succeeded' then
    if not settled then
      update public.payments set status='completed',completed_at=coalesce(completed_at,clock_timestamp()),buyer_confirmed=buyer_done,seller_confirmed=seller_done,
        capture_claim_id=null,capture_claimed_at=null,cancel_claim_id=null,cancel_claimed_at=null where id=payment.id;
      update public.milestones set status='completed',completed_at=coalesce(completed_at,clock_timestamp()),provider_settled_at=clock_timestamp(),
        buyer_confirmed=buyer_done,seller_confirmed=seller_done where id=payment.milestone_id and stripe_payment_intent=p_intent_id
        and buyer_id=payment.buyer_id and seller_id=payment.seller_id and listing_id=payment.listing_id;
      insert into public.payment_audit_logs(payment_id,action,actor_type,metadata) values(payment.id,'payment_completed','system',jsonb_build_object('source','stripe_api','read_started_at',p_read_started_at));
      perform needs_private.notify_order(payment.id,payment.buyer_id,'payment_sent','payment_completed');
      perform needs_private.notify_order(payment.id,payment.seller_id,'payment_completed','payment_completed');
    else
      update public.payments set capture_claim_id=null,capture_claimed_at=null,cancel_claim_id=null,cancel_claimed_at=null where id=payment.id;
    end if;
    if not exists(select 1 from public.transactions where payment_id=payment.id and type='charge' and status='succeeded') then
      insert into public.transactions(payment_id,type,amount,fee,status,metadata) values(payment.id,'charge',payment.amount,payment.platform_fee,'succeeded',
        jsonb_build_object('source','stripe_api','stripe_payment_intent',p_intent_id,'read_started_at',p_read_started_at));
    end if;
    if not(buyer_done and seller_done) then
      foreach recipient in array array[payment.buyer_id,payment.seller_id] loop
        perform needs_private.notify_order(payment.id,recipient,'payment_attention_required','settled_without_confirmations',jsonb_build_object('reason_code','settled_without_confirmations'));
      end loop;
    end if;
  elsif p_provider_status='canceled' then
    update public.payments set status='failed',failed_at=coalesce(failed_at,clock_timestamp()),stripe_canceled_at=coalesce(stripe_canceled_at,clock_timestamp()),
      capture_claim_id=null,capture_claimed_at=null,cancel_claim_id=null,cancel_claimed_at=null where id=payment.id;
    update public.milestones set status='failed' where id=payment.milestone_id and stripe_payment_intent=p_intent_id and status not in('completed','refunded');
    if payment.agreement_id is not null and not exists(select 1 from public.payments where agreement_id=payment.agreement_id and stripe_canceled_at is null) then
      update public.service_price_agreements set checkout_started_at=null where id=payment.agreement_id;
    end if;
    if payment.stripe_canceled_at is null then
      insert into public.payment_audit_logs(payment_id,action,actor_type,metadata) values(payment.id,'payment_canceled','system',jsonb_build_object('source','stripe_api','read_started_at',p_read_started_at));
    end if;
    foreach recipient in array array[payment.buyer_id,payment.seller_id] loop
      perform needs_private.notify_order(payment.id,recipient,'payment_canceled','payment_canceled');
    end loop;
  end if;
  perform needs_private.order_authorization_notifications(payment.id);
  return jsonb_build_object('applied',true);
end $$;

-- Restore attention that an earlier provider refresh may already have cleared.
-- This changes no payment status, authorization, ledger or provider operation.
update public.payments p set attention_required=true
where not p.attention_required and needs_private.order_financial_review_required(p.id);

revoke all on function public.reconcile_order_provider(uuid,text,text,bigint,text,bigint,bigint,bigint,timestamptz,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.reconcile_order_provider(uuid,text,text,bigint,text,bigint,bigint,bigint,timestamptz,timestamptz,uuid) to service_role;
commit;
