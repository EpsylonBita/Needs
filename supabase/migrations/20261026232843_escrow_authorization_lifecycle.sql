-- Provider truth is reconciled from Stripe retrieval, never from elapsed time.
-- Every financial RPC is service-only. Participants retain the safe order DTO.
begin;

alter table public.payments
  add column authorization_expires_at timestamptz,
  add column provider_status text,
  add column provider_checked_at timestamptz,
  add column provider_read_started_at timestamptz,
  add column attention_required boolean not null default false,
  add column cancel_claim_id uuid,
  add column cancel_claimed_at timestamptz,
  add column reconciliation_lease_id uuid,
  add column reconciliation_lease_until timestamptz,
  add column reconciliation_next_at timestamptz not null default now(),
  add column reconciliation_failures integer not null default 0,
  add column refunds_read_started_at timestamptz,
  add column disputes_read_started_at timestamptz;
-- A verified irreversible provider settlement must be recordable even when
-- local consent is missing. This does NOT authorize capture: that RPC still
-- requires both confirmations. Browser writes cannot alter these markers.
alter table public.payments drop constraint payments_completed_requires_confirmations;
alter table public.payments add constraint payments_completed_requires_confirmations check (
  status<>'completed' or(buyer_confirmed is true and seller_confirmed is true)
  or((provider_status='succeeded') is true and provider_checked_at is not null));
alter table public.milestones add column provider_settled_at timestamptz;
alter table public.milestones drop constraint milestones_completed_requires_confirmations;
alter table public.milestones add constraint milestones_completed_requires_confirmations check (
  status<>'completed' or(buyer_confirmed is true and seller_confirmed is true) or provider_settled_at is not null);
alter table public.payments add constraint payments_exclusive_financial_claims
  check (capture_claim_id is null or cancel_claim_id is null);
create index payments_reconciliation_due on public.payments(reconciliation_next_at,id)
  where stripe_payment_intent is not null and stripe_canceled_at is null;
alter table public.disputes add column currency text check(currency is null or currency~'^[a-z]{3}$');
update public.disputes d set currency=p.currency from public.payments p where p.id=d.payment_id and d.stripe_dispute_id is not null;
create index webhook_canceled_intent_evidence on public.webhook_events((payload#>>'{data,object,id}'))
  where event_type='payment_intent.canceled' and processed_at is not null and processing_error is null;

create table public.order_cancellations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  accepted_by uuid references public.profiles(id) on delete restrict,
  reason text check(reason is null or char_length(reason) between 1 and 1000),
  status text not null default 'proposed' check(status in('proposed','accepted','rejected','withdrawn')),
  requested_at timestamptz not null default clock_timestamp(),
  responded_at timestamptz,
  check (accepted_by is null or accepted_by<>requested_by),
  check ((status='proposed')=(responded_at is null)),
  check ((status='accepted')=(accepted_by is not null))
);
create unique index order_cancellations_current on public.order_cancellations(payment_id)
  where status in('proposed','accepted');
create index order_cancellations_history on public.order_cancellations(payment_id,requested_at desc,id desc);
alter table public.order_cancellations enable row level security;
revoke all on public.order_cancellations from public,anon,authenticated;
grant select,insert,update,delete on public.order_cancellations to service_role;

-- Dedupe is transactionally coupled to notification insertion. It is not a
-- fabricated Stripe event and is deliberately outside the exposed API schema.
create table needs_private.order_notification_events (
  payment_id uuid not null references public.payments(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete restrict,
  event_key text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(payment_id,recipient_id,event_key)
);
revoke all on needs_private.order_notification_events from public,anon,authenticated;

create function needs_private.notify_order(p_payment_id uuid,p_recipient_id uuid,p_type text,p_key text,p_payload jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into needs_private.order_notification_events(payment_id,recipient_id,event_key)
    values(p_payment_id,p_recipient_id,p_key) on conflict do nothing;
  if found then
    insert into public.notifications(user_id,type,payload)
      values(p_recipient_id,p_type,coalesce(p_payload,'{}')||jsonb_build_object('payment_id',p_payment_id));
  end if;
end $$;

create function needs_private.order_lifecycle_blocked(p_payment_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select p.stripe_canceled_at is not null or p.cancel_claim_id is not null
    or (p.authorization_expires_at is not null and p.authorization_expires_at<=clock_timestamp())
    or (p.provider_status is not null and p.provider_status<>'requires_capture')
    or exists(select 1 from public.order_cancellations c where c.payment_id=p.id and c.status='proposed')
  from public.payments p where p.id=p_payment_id
$$;

create function needs_private.order_bank_loss_attention(p_payment_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.disputes d join public.payments p on p.id=d.payment_id
    where p.id=p_payment_id and d.stripe_dispute_id is not null and d.status='lost'
      and(d.amount is distinct from p.amount or d.currency is distinct from p.currency))
$$;

create function needs_private.order_authorization_notifications(p_payment_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare payment public.payments%rowtype; recipient uuid; threshold text; key_value text;
begin
  select * into payment from public.payments where id=p_payment_id;
  if not found or payment.status<>'requires_capture' or payment.stripe_canceled_at is not null then return; end if;
  if payment.authorization_expires_at is not null and payment.authorization_expires_at<=clock_timestamp() then
    update public.payments set attention_required=true where id=payment.id;
    foreach recipient in array array[payment.buyer_id,payment.seller_id] loop
      perform needs_private.notify_order(payment.id,recipient,'payment_authorization_expired',
        'expired:'||extract(epoch from payment.authorization_expires_at)::text,jsonb_build_object('expires_at',payment.authorization_expires_at));
    end loop;
  elsif payment.authorization_expires_at is not null and payment.authorization_expires_at<=clock_timestamp()+interval '24 hours' then
    threshold:=case when payment.authorization_expires_at<=clock_timestamp()+interval '1 hour' then '1h' else '24h' end;
    key_value:='expiring:'||threshold||':'||extract(epoch from payment.authorization_expires_at)::text;
    foreach recipient in array array[payment.buyer_id,payment.seller_id] loop
      perform needs_private.notify_order(payment.id,recipient,'payment_authorization_expiring',key_value,
        jsonb_build_object('threshold',threshold,'expires_at',payment.authorization_expires_at));
    end loop;
  elsif payment.provider_status='requires_capture' and payment.authorization_expires_at is null then
    update public.payments set attention_required=true where id=payment.id;
    foreach recipient in array array[payment.buyer_id,payment.seller_id] loop
      perform needs_private.notify_order(payment.id,recipient,'payment_attention_required','authorization_deadline_unknown',
        jsonb_build_object('reason_code','authorization_deadline_unknown'));
    end loop;
  end if;
end $$;

-- Match the existing agreement lock hierarchy before taking a payment lock.
-- Payment-only operations never acquire agreement/listing locks afterwards.
create function needs_private.lock_order_provider(p_payment_id uuid)
returns public.payments language plpgsql security definer set search_path='' as $$
declare payment public.payments%rowtype; agreement public.service_price_agreements%rowtype;
begin
  select * into payment from public.payments where id=p_payment_id;
  if not found then raise exception 'Order not found' using errcode='P0002'; end if;
  if payment.agreement_id is not null then
    select * into agreement from public.service_price_agreements where id=payment.agreement_id;
    perform 1 from public.listings where id=agreement.listing_id for update;
    perform 1 from public.chats where id=agreement.chat_id for update;
    perform 1 from public.service_price_agreements where id=agreement.id for update;
  end if;
  select * into payment from public.payments where id=p_payment_id for update;
  return payment;
end $$;

create function needs_private.assert_order_cancelable(p_payment_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare payment public.payments%rowtype;
begin
  select * into payment from public.payments where id=p_payment_id;
  if not found or payment.stripe_payment_intent is null or payment.status in('completed','refunded','disputed')
    or exists(select 1 from public.transactions where payment_id=p_payment_id and type='charge' and status='succeeded')
    or exists(select 1 from public.disputes where payment_id=p_payment_id and stripe_dispute_id is not null and status in('open','lost')) then
    raise exception 'Settled or bank-disputed money cannot be canceled' using errcode='23514';
  end if;
  if payment.capture_claim_id is not null then raise exception 'Payment capture is being reconciled' using errcode='23514'; end if;
end $$;

create function public.request_order_cancellation(p_payment_id uuid,p_user_id uuid,p_expected_cancellation_id uuid default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare profile_id uuid; payment public.payments%rowtype; prior public.order_cancellations%rowtype; request_id uuid; reason_value text;
begin
  profile_id:=needs_private.order_profile(p_user_id);
  select * into payment from public.payments where id=p_payment_id for update;
  if not found or profile_id not in(payment.buyer_id,payment.seller_id) then raise exception 'Order not found' using errcode='42501'; end if;
  perform needs_private.assert_order_cancelable(payment.id);
  if payment.stripe_canceled_at is not null or payment.cancel_claim_id is not null then raise exception 'Cancellation is already being reconciled' using errcode='23514'; end if;
  select * into prior from public.order_cancellations where payment_id=payment.id order by requested_at desc,id desc limit 1;
  if prior.id is distinct from p_expected_cancellation_id then raise exception 'Cancellation changed. Refresh and try again' using errcode='40001'; end if;
  if prior.status in('proposed','accepted') then raise exception 'A cancellation request is already active' using errcode='23514'; end if;
  reason_value:=nullif(btrim(p_reason),'');
  if char_length(reason_value)>1000 then raise exception 'Cancellation reason is too long' using errcode='22023'; end if;
  insert into public.order_cancellations(payment_id,requested_by,reason) values(payment.id,profile_id,reason_value) returning id into request_id;
  insert into public.payment_audit_logs(payment_id,action,actor_type,metadata) values(payment.id,'cancellation_requested','user',
    jsonb_build_object('user_id',p_user_id,'profile_id',profile_id,'cancellation_id',request_id));
  perform needs_private.notify_order(payment.id,case when profile_id=payment.buyer_id then payment.seller_id else payment.buyer_id end,
    'payment_cancellation_requested','cancellation_requested:'||request_id::text,jsonb_build_object('cancellation_id',request_id));
  return needs_private.order_json(payment.id,profile_id);
end $$;

create function public.respond_order_cancellation(p_payment_id uuid,p_user_id uuid,p_cancellation_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare profile_id uuid; payment public.payments%rowtype; request public.order_cancellations%rowtype; new_status text;
begin
  if p_action is null or p_action not in('accept','reject','withdraw') then raise exception 'Invalid cancellation action' using errcode='22023'; end if;
  profile_id:=needs_private.order_profile(p_user_id);
  select * into payment from public.payments where id=p_payment_id for update;
  if not found or profile_id not in(payment.buyer_id,payment.seller_id) then raise exception 'Order not found' using errcode='42501'; end if;
  select * into request from public.order_cancellations where payment_id=payment.id order by requested_at desc,id desc limit 1 for update;
  if request.id is null or request.id is distinct from p_cancellation_id then raise exception 'Cancellation changed. Refresh and try again' using errcode='40001'; end if;
  if (p_action='withdraw' and profile_id<>request.requested_by) or(p_action in('accept','reject') and profile_id=request.requested_by) then
    raise exception 'Only the other participant can accept or reject cancellation' using errcode='42501';
  end if;
  new_status:=case p_action when 'accept' then 'accepted' when 'reject' then 'rejected' else 'withdrawn' end;
  -- Exact request/action retries are idempotent; they cannot act on a newer row.
  if request.status=new_status then return needs_private.order_json(payment.id,profile_id); end if;
  if request.status<>'proposed' then raise exception 'Cancellation request is no longer pending' using errcode='23514'; end if;
  if payment.stripe_canceled_at is not null or payment.cancel_claim_id is not null then raise exception 'Cancellation is already being reconciled' using errcode='23514'; end if;
  perform needs_private.assert_order_cancelable(payment.id);
  update public.order_cancellations set status=new_status,responded_at=clock_timestamp(),
    accepted_by=case when p_action='accept' then profile_id else null end where id=request.id;
  if p_action='accept' then
    update public.payments set cancel_claim_id=gen_random_uuid(),cancel_claimed_at=clock_timestamp(),reconciliation_next_at=clock_timestamp()
      where id=payment.id;
  end if;
  insert into public.payment_audit_logs(payment_id,action,actor_type,metadata) values(payment.id,'cancellation_'||new_status,'user',
    jsonb_build_object('user_id',p_user_id,'profile_id',profile_id,'cancellation_id',request.id));
  perform needs_private.notify_order(payment.id,case when profile_id=payment.buyer_id then payment.seller_id else payment.buyer_id end,
    'payment_cancellation_'||new_status,'cancellation_'||new_status||':'||request.id::text,jsonb_build_object('cancellation_id',request.id));
  return needs_private.order_json(payment.id,profile_id);
end $$;

create function public.claim_order_cancellation(p_payment_id uuid,p_user_id uuid,p_cancellation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payment public.payments%rowtype; profile_id uuid; request public.order_cancellations%rowtype;
begin
  profile_id:=needs_private.order_profile(p_user_id);
  select * into payment from public.payments where id=p_payment_id for update;
  if not found or profile_id not in(payment.buyer_id,payment.seller_id) then raise exception 'Order not found' using errcode='42501'; end if;
  select * into request from public.order_cancellations where payment_id=payment.id order by requested_at desc,id desc limit 1;
  if request.id is null or request.id is distinct from p_cancellation_id or request.status<>'accepted' then raise exception 'An accepted cancellation is required' using errcode='23514'; end if;
  if payment.stripe_canceled_at is not null then
    return jsonb_build_object('payment_id',payment.id,'intent_id',payment.stripe_payment_intent,'claim_id',null,'status','canceled','released',true);
  end if;
  perform needs_private.assert_order_cancelable(payment.id);
  if payment.cancel_claim_id is null then raise exception 'Cancellation claim is missing' using errcode='23514'; end if;
  return jsonb_build_object('payment_id',payment.id,'intent_id',payment.stripe_payment_intent,'claim_id',payment.cancel_claim_id,'status','claimed','released',false);
end $$;

create function public.claim_admin_order_cancellation(p_payment_id uuid,p_admin_user_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payment public.payments%rowtype; reason_value text:=nullif(btrim(p_reason),'');
begin
  if p_admin_user_id is null or not exists(select 1 from auth.users where id=p_admin_user_id) or reason_value is null or char_length(reason_value)>1000 then
    raise exception 'Administrator identity and cancellation reason are required' using errcode='22023';
  end if;
  select * into payment from public.payments where id=p_payment_id for update;
  if not found then raise exception 'Order not found' using errcode='P0002'; end if;
  if payment.stripe_canceled_at is not null then return jsonb_build_object('payment_id',payment.id,'intent_id',payment.stripe_payment_intent,'claim_id',null,'status','canceled','released',true); end if;
  perform needs_private.assert_order_cancelable(payment.id);
  if payment.cancel_claim_id is null then
    update public.payments set cancel_claim_id=gen_random_uuid(),cancel_claimed_at=clock_timestamp(),reconciliation_next_at=clock_timestamp()
      where id=payment.id returning * into payment;
    insert into public.payment_audit_logs(payment_id,action,actor_type,metadata) values(payment.id,'admin_cancellation_claimed','admin',
      jsonb_build_object('user_id',p_admin_user_id,'reason',reason_value,'claim_id',payment.cancel_claim_id));
  end if;
  return jsonb_build_object('payment_id',payment.id,'intent_id',payment.stripe_payment_intent,'claim_id',payment.cancel_claim_id,'status','claimed','released',false);
end $$;

create function public.reconcile_order_provider(
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

create function public.claim_order_reconciliation(p_limit integer default 20,p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payment public.payments%rowtype; results jsonb:='[]'::jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 or p_lease_seconds is null or p_lease_seconds not between 30 and 600 then raise exception 'Invalid reconciliation batch' using errcode='22023'; end if;
  for payment in
    with candidates as (
      select id from public.payments where stripe_payment_intent is not null and stripe_canceled_at is null
        and reconciliation_next_at<=clock_timestamp() and(reconciliation_lease_until is null or reconciliation_lease_until<=clock_timestamp())
      order by reconciliation_next_at,id for update skip locked limit p_limit
    ) update public.payments p set reconciliation_lease_id=gen_random_uuid(),reconciliation_lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds)
      from candidates c where p.id=c.id returning p.*
  loop
    perform needs_private.order_authorization_notifications(payment.id);
    results:=results||jsonb_build_array(jsonb_build_object('payment_id',payment.id,'intent_id',payment.stripe_payment_intent,
      'lease_id',payment.reconciliation_lease_id,'listing_id',payment.listing_id,'buyer_id',payment.buyer_id,'seller_id',payment.seller_id,
      'agreement_id',payment.agreement_id,'milestone_id',payment.milestone_id,'amount',payment.amount,'platform_fee',payment.platform_fee,
      'currency',payment.currency,'status',payment.status,'cancel_claim_id',payment.cancel_claim_id,'capture_claim_id',payment.capture_claim_id));
  end loop;
  return results;
end $$;

create function public.finish_order_reconciliation(p_payment_id uuid,p_lease_id uuid,p_error_code text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare payment public.payments%rowtype; recipient uuid;
begin
  if p_error_code is not null and p_error_code!~'^[a-zA-Z0-9_.:-]{1,80}$' then raise exception 'Invalid reconciliation error code' using errcode='22023'; end if;
  select * into payment from public.payments where id=p_payment_id for update;
  if not found or p_lease_id is null or payment.reconciliation_lease_id is distinct from p_lease_id
    or payment.reconciliation_lease_until is null or payment.reconciliation_lease_until<=clock_timestamp() then return false; end if;
  update public.payments set reconciliation_lease_id=null,reconciliation_lease_until=null,
    reconciliation_failures=case when p_error_code is null then 0 else least(reconciliation_failures+1,20) end,
    reconciliation_next_at=case when p_error_code is null then greatest(reconciliation_next_at,clock_timestamp()+interval '1 minute')
      else clock_timestamp()+make_interval(secs=>least(3600,60*power(2,least(reconciliation_failures,6)))::integer) end,
    attention_required=attention_required or(p_error_code is not null and reconciliation_failures>=2)
    where id=payment.id;
  if p_error_code is not null and payment.reconciliation_failures>=2 then
    foreach recipient in array array[payment.buyer_id,payment.seller_id] loop
      perform needs_private.notify_order(payment.id,recipient,'payment_attention_required','reconciliation_failed',jsonb_build_object('reason_code','reconciliation_failed'));
    end loop;
  end if;
  return true;
end $$;

-- Existing function identities and grants are preserved for all callers.
create or replace function needs_private.order_json(p_payment_id uuid,p_profile_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  payment public.payments%rowtype; milestone public.milestones%rowtype;
  buyer_done boolean; seller_done boolean; authorized boolean; open_dispute boolean;
  cancellation jsonb; active_request public.order_cancellations%rowtype; lifecycle_blocked boolean; cancelable boolean; pending_capture boolean; complaint jsonb; review_value jsonb; safe_chat uuid;
begin
  select * into payment from public.payments where id=p_payment_id;
  if not found or p_profile_id is null or p_profile_id not in(payment.buyer_id,payment.seller_id) then
    raise exception 'Order not found' using errcode='42501';
  end if;
  -- A retried milestone can point at a newer intent. Its newer confirmations
  -- must never authorize the older failed payment attempt.
  select * into milestone from public.milestones where id=payment.milestone_id
    and buyer_id=payment.buyer_id and seller_id=payment.seller_id and listing_id=payment.listing_id
    and stripe_payment_intent=payment.stripe_payment_intent;
  buyer_done:=coalesce(payment.buyer_confirmed,false) or coalesce(milestone.buyer_confirmed,false);
  seller_done:=coalesce(payment.seller_confirmed,false) or coalesce(milestone.seller_confirmed,false);
  authorized:=exists(select 1 from public.payment_audit_logs where payment_id=payment.id and action='payment_authorized');
  open_dispute:=exists(select 1 from public.disputes where payment_id=payment.id and status='open');
  lifecycle_blocked:=needs_private.order_lifecycle_blocked(payment.id);
  select * into active_request from public.order_cancellations where payment_id=payment.id order by requested_at desc,id desc limit 1;
  if active_request.id is not null then cancellation:=jsonb_build_object('id',active_request.id,'status',active_request.status,
    'requested_by',active_request.requested_by,'reason',active_request.reason,'requested_at',active_request.requested_at); end if;
  cancelable:=payment.status not in('completed','refunded','disputed') and payment.stripe_payment_intent is not null
    and payment.stripe_canceled_at is null and payment.capture_claim_id is null and payment.cancel_claim_id is null
    and not exists(select 1 from public.disputes where payment_id=payment.id and stripe_dispute_id is not null and status in('open','lost'))
    and not exists(select 1 from public.transactions where payment_id=payment.id and type='charge' and status='succeeded');
  pending_capture:=payment.status='requires_capture' and payment.capture_claim_id is not null;
  select jsonb_build_object('id',id,'status',status) into complaint from public.disputes
    where payment_id=payment.id and stripe_dispute_id is null
    order by (status='open') desc,created_at desc nulls last,id desc limit 1;
  select jsonb_build_object('id',id,'rating',rating) into review_value from public.reviews
    where payment_id=payment.id and reviewer_id=payment.buyer_id order by created_at,id limit 1;
  select c.id into safe_chat from public.chats c where c.id=coalesce(payment.chat_id,milestone.chat_id)
    and c.listing_id=payment.listing_id and c.type='direct'
    and exists(select 1 from public.chat_participants where chat_id=c.id and user_id=p_profile_id)
    and exists(select 1 from public.chat_participants where chat_id=c.id and user_id=payment.buyer_id)
    and exists(select 1 from public.chat_participants where chat_id=c.id and user_id=payment.seller_id);
  return jsonb_build_object(
    'id',payment.id,'created_at',coalesce(payment.created_at,'epoch'::timestamptz),
    'status',payment.status,'amount',payment.amount,'currency',payment.currency,'platform_fee',payment.platform_fee,
    'payments_enabled',coalesce((select enabled from public.feature_flags where key='payments_enabled'),false),
    'listing',(select jsonb_build_object('id',l.id,'title',l.title,'available',l.status='active',
      'thumbnail',(select url from public.listing_images where listing_id=l.id order by main desc nulls last,id limit 1))
      from public.listings l where l.id=payment.listing_id),
    'buyer',(select jsonb_build_object('id',id,'display_name',display_name,'avatar_url',avatar_url) from public.profiles where id=payment.buyer_id),
    'seller',(select jsonb_build_object('id',id,'display_name',display_name,'avatar_url',avatar_url) from public.profiles where id=payment.seller_id),
    'my_role',case when p_profile_id=payment.buyer_id then 'buyer' else 'seller' end,'chat_id',safe_chat,
    'milestone',case when milestone.id is null then null else jsonb_build_object('id',milestone.id,'title',milestone.title,'status',milestone.status,'amount',milestone.amount) end,
    'buyer_confirmed',buyer_done,'seller_confirmed',seller_done,'role_review_required',payment.role_review_required,
    'authorization',jsonb_build_object('expires_at',payment.authorization_expires_at,'last_checked_at',payment.provider_checked_at,
      'provider_status',payment.provider_status,'attention_required',payment.attention_required or(payment.status='requires_capture' and coalesce(payment.authorization_expires_at<=now(),false))),
    'stripe_canceled_at',payment.stripe_canceled_at,'cancel_pending',payment.cancel_claim_id is not null and payment.stripe_canceled_at is null,
    'cancellation',cancellation,
    'authorization_state',case when payment.status in('completed','refunded','disputed') then 'settled'
      when payment.status='requires_capture' and authorized and payment.stripe_canceled_at is null and (payment.provider_status is null or payment.provider_status='requires_capture') then 'authorized' else 'unverified' end,
    'capture_pending',pending_capture,'complaint',complaint,
    'disputes',coalesce((select jsonb_agg(jsonb_build_object('id',id,'status',status,'is_bank_dispute',stripe_dispute_id is not null,
      'created_at',coalesce(created_at,'epoch'::timestamptz),'resolved_at',resolved_at) order by created_at,id) from public.disputes where payment_id=payment.id),'[]'::jsonb),
    'refund',(select jsonb_build_object('succeeded_amount',coalesce(sum(amount) filter(where status='succeeded'),0),
      'pending_amount',coalesce(sum(amount) filter(where status in('pending','requires_action')),0),
      'failed',coalesce(bool_or(status in('failed','canceled')),false)) from public.transactions where payment_id=payment.id and type='refund'),
    'review',review_value,
    'actions',jsonb_build_object(
      'can_request_cancel',cancelable and(active_request.id is null or active_request.status in('rejected','withdrawn')),
      'can_accept_cancel',cancelable and coalesce(active_request.status='proposed' and active_request.requested_by<>p_profile_id,false),
      'can_reject_cancel',cancelable and coalesce(active_request.status='proposed' and active_request.requested_by<>p_profile_id,false),
      'can_withdraw_cancel',cancelable and coalesce(active_request.status='proposed' and active_request.requested_by=p_profile_id,false),
      'can_reconcile',payment.stripe_payment_intent is not null,
      'can_confirm',not lifecycle_blocked and payment.status='requires_capture' and authorized and not payment.role_review_required and not open_dispute and not pending_capture
        and not(case when p_profile_id=payment.buyer_id then buyer_done else seller_done end),
      'can_capture',not lifecycle_blocked and payment.status='requires_capture' and authorized and not payment.role_review_required and not open_dispute and buyer_done and seller_done,
      'can_complain',payment.cancel_claim_id is null and payment.stripe_canceled_at is null and p_profile_id=payment.buyer_id and (payment.status='completed' or(payment.status='requires_capture' and authorized)) and not open_dispute and not pending_capture,
      'can_review',p_profile_id=payment.buyer_id and payment.status='completed' and not payment.role_review_required and review_value is null));
end $$;

create or replace function public.confirm_order(p_payment_id uuid,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare profile_id uuid; payment public.payments%rowtype; view_value jsonb;
begin
  profile_id:=needs_private.order_profile(p_user_id);
  select * into payment from public.payments where id=p_payment_id for update;
  if not found or profile_id not in(payment.buyer_id,payment.seller_id) then raise exception 'Order not found' using errcode='42501'; end if;
  view_value:=needs_private.order_json(payment.id,profile_id);
  if needs_private.order_lifecycle_blocked(payment.id) or payment.status<>'requires_capture' or payment.role_review_required or view_value->>'authorization_state'<>'authorized'
    or payment.capture_claim_id is not null or exists(select 1 from public.disputes where payment_id=payment.id and status='open') then
    raise exception 'This order cannot be confirmed in its current state' using errcode='23514';
  end if;
  -- Payment is the canonical new-write location; historical milestone flags
  -- remain readable through OR. No payment -> milestone lock inversion.
  update public.payments set buyer_confirmed=coalesce(buyer_confirmed,false) or profile_id=buyer_id,
    seller_confirmed=coalesce(seller_confirmed,false) or profile_id=seller_id where id=payment.id;
  return needs_private.order_json(payment.id,profile_id);
end $$;

create or replace function public.claim_order_capture(p_payment_id uuid,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare profile_id uuid; payment public.payments%rowtype; view_value jsonb;
begin
  profile_id:=needs_private.order_profile(p_user_id);
  select * into payment from public.payments where id=p_payment_id for update;
  if not found or profile_id not in(payment.buyer_id,payment.seller_id) then raise exception 'Order not found' using errcode='42501'; end if;
  if payment.role_review_required then raise exception 'This older payment needs administrator review' using errcode='23514'; end if;
  if payment.status in('completed','refunded','disputed') then
    return jsonb_build_object('payment_id',payment.id,'intent_id',payment.stripe_payment_intent,'claim_id',payment.capture_claim_id,'status','completed');
  end if;
  if payment.status<>'requires_capture' or payment.stripe_payment_intent is null then raise exception 'This order cannot be captured' using errcode='23514'; end if;
  if needs_private.order_lifecycle_blocked(payment.id) then raise exception 'Authorization expired or cancellation is pending. Refresh this order' using errcode='23514'; end if;
  if payment.capture_claim_id is null then
    view_value:=needs_private.order_json(payment.id,profile_id);
    if not(view_value->'actions'->>'can_capture')::boolean then raise exception 'Both parties must confirm an authorized order without an open dispute' using errcode='23514'; end if;
    update public.payments set capture_claim_id=gen_random_uuid(),capture_claimed_at=clock_timestamp() where id=payment.id returning * into payment;
  end if;
  return jsonb_build_object('payment_id',payment.id,'intent_id',payment.stripe_payment_intent,'claim_id',payment.capture_claim_id,'status','claimed');
end $$;

create or replace function public.open_payment_complaint(p_payment_id uuid,p_buyer_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payment public.payments%rowtype; complaint_id uuid;
begin
  select * into payment from public.payments where id=p_payment_id for update;
  if not found or payment.buyer_id<>p_buyer_id then raise exception 'Payment not owned by buyer'; end if;
  if payment.status not in('requires_capture','completed') then raise exception 'Payment cannot accept a complaint'; end if;
  select id into complaint_id from public.disputes where payment_id=p_payment_id and stripe_dispute_id is null and status='open' order by created_at,id limit 1;
  if complaint_id is not null then return jsonb_build_object('dispute_id',complaint_id,'duplicate',true); end if;
  if payment.cancel_claim_id is not null or payment.stripe_canceled_at is not null then raise exception 'Payment cancellation is being reconciled' using errcode='23514'; end if;
  if payment.status='requires_capture' and payment.capture_claim_id is not null then raise exception 'Payment capture is being reconciled. Try again after its status updates'; end if;
  if payment.status='requires_capture' and not exists(select 1 from public.payment_audit_logs where payment_id=payment.id and action='payment_authorized') then
    raise exception 'Payment authorization has not been verified';
  end if;
  if exists(select 1 from public.disputes where payment_id=payment.id and status='open') then raise exception 'An open dispute already exists'; end if;
  insert into public.disputes(payment_id,status) values(payment.id,'open') returning id into complaint_id;
  insert into public.notifications(user_id,type,payload) values
    (payment.buyer_id,'dispute_opened',jsonb_build_object('payment_id',payment.id)),
    (payment.seller_id,'dispute_opened',jsonb_build_object('payment_id',payment.id));
  insert into public.payment_audit_logs(payment_id,action,actor_type,metadata)
    values(payment.id,'complaint_opened','user',jsonb_build_object('dispute_id',complaint_id,'buyer_id',p_buyer_id));
  return jsonb_build_object('dispute_id',complaint_id,'duplicate',false);
end $$;

create or replace function public.guard_payment_confirmation()
returns trigger language plpgsql security definer set search_path='' as $$
declare profile_id uuid; payment public.payments%rowtype; changed boolean;
begin
  if current_setting('role',true) in('none','postgres','service_role','supabase_admin') then return new; end if;
  profile_id:=needs_private.order_profile(auth.uid());
  if profile_id not in(old.buyer_id,old.seller_id) then raise exception 'Only payment participants may confirm' using errcode='42501'; end if;
  if (to_jsonb(new)-'buyer_confirmed'-'seller_confirmed') is distinct from(to_jsonb(old)-'buyer_confirmed'-'seller_confirmed') then
    raise exception 'Only your own confirmation may be changed' using errcode='42501';
  end if;
  if (new.buyer_confirmed is distinct from old.buyer_confirmed and profile_id<>old.buyer_id)
    or(new.seller_confirmed is distinct from old.seller_confirmed and profile_id<>old.seller_id) then
    raise exception 'Only your own confirmation may be changed' using errcode='42501';
  end if;
  changed:=new.buyer_confirmed is distinct from old.buyer_confirmed or new.seller_confirmed is distinct from old.seller_confirmed;
  if not changed then return new; end if;
  if(new.buyer_confirmed is distinct from old.buyer_confirmed and new.buyer_confirmed is distinct from true)
    or(new.seller_confirmed is distinct from old.seller_confirmed and new.seller_confirmed is distinct from true) then
    raise exception 'A confirmation cannot be withdrawn' using errcode='23514';
  end if;
  if tg_table_name='payments' then payment:=old;
  else
    -- A legacy UPDATE already holds its milestone row. Settlement locks payment
    -- before milestone, so fail/retry immediately instead of reversing that lock
    -- order and waiting in a deadlock with the financial webhook.
    select * into payment from public.payments where milestone_id=old.id and stripe_payment_intent=old.stripe_payment_intent
      and buyer_id=old.buyer_id and seller_id=old.seller_id and listing_id=old.listing_id for update nowait;
    if not found then raise exception 'A verified payment is required before confirmation' using errcode='23514'; end if;
  end if;
  if needs_private.order_lifecycle_blocked(payment.id) or payment.status<>'requires_capture' or payment.role_review_required or payment.capture_claim_id is not null
    or not exists(select 1 from public.payment_audit_logs where payment_id=payment.id and action='payment_authorized')
    or exists(select 1 from public.disputes where payment_id=payment.id and status='open') then
    raise exception 'This order cannot be confirmed in its current state' using errcode='23514';
  end if;
  return new;
end $$;

create or replace function public.resolve_order_capture(p_payment_id uuid,p_claim_id uuid,p_outcome text)
returns void language plpgsql security definer set search_path='' as $$
declare payment public.payments%rowtype;
begin
  if p_outcome not in('captured','not_captured') or p_outcome is null then raise exception 'Unknown capture outcome' using errcode='22023'; end if;
  select * into payment from public.payments where id=p_payment_id for update;
  if not found or p_claim_id is null then raise exception 'Capture claim does not match' using errcode='23514'; end if;
  -- The provider worker may already have resolved this reservation. A terminal
  -- acknowledgment changes nothing; it must not turn a successful race into an
  -- apparent capture failure or release a different live reservation.
  if payment.capture_claim_id is null and((p_outcome='captured' and payment.status in('completed','refunded','disputed'))
    or(p_outcome='not_captured' and payment.stripe_canceled_at is not null)) then return; end if;
  if payment.capture_claim_id is distinct from p_claim_id then raise exception 'Capture claim does not match' using errcode='23514'; end if;
  if p_outcome='not_captured' then
    update public.payments set capture_claim_id=null,capture_claimed_at=null where id=payment.id;
  end if;
end $$;

create function public.get_order_for_user(p_payment_id uuid,p_user_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select needs_private.order_json(p_payment_id,needs_private.order_profile(p_user_id))
$$;

-- Stripe refund amounts and ownership do not change. A delivery of an older
-- event cannot undo a later API snapshot or regress a successful refund to a
-- pending state; a genuinely later failed refund may reverse success.
create function needs_private.guard_refund_snapshot()
returns trigger language plpgsql security definer set search_path='' as $$
declare snapshot_time timestamptz; event_time numeric;
begin
  if old.stripe_refund_id is null then return new; end if;
  if new.stripe_refund_id is distinct from old.stripe_refund_id or new.payment_id is distinct from old.payment_id
    or new.type is distinct from old.type or new.amount is distinct from old.amount then
    raise exception 'Canonical refund identity and amount are immutable' using errcode='23514';
  end if;
  if old.status in('failed','canceled') or(old.status='succeeded' and new.status in('pending','requires_action')) then
    new.status:=old.status;
  end if;
  snapshot_time:=nullif(old.metadata->>'stripe_snapshot_read_started_at','')::timestamptz;
  event_time:=nullif(new.metadata->>'stripe_event_created','')::numeric;
  if snapshot_time is not null and event_time is not null
    and(new.metadata->>'stripe_snapshot_read_started_at') is not distinct from(old.metadata->>'stripe_snapshot_read_started_at')
    and to_timestamp(event_time::double precision)<snapshot_time then
    new.status:=old.status;
  end if;
  return new;
end $$;
create trigger guard_canonical_refund_snapshot before update on public.transactions
  for each row execute function needs_private.guard_refund_snapshot();

create function public.reconcile_order_refunds(p_payment_id uuid,p_intent_id text,p_read_started_at timestamptz,p_refunds jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payment public.payments%rowtype; prior public.transactions%rowtype; refund jsonb; changed boolean:=false;
  succeeded_total numeric; failure boolean:=false; recipient uuid; current_status text;
begin
  select * into payment from public.payments where id=p_payment_id for update;
  if not found or p_intent_id is distinct from payment.stripe_payment_intent or p_read_started_at is null
    or p_read_started_at>clock_timestamp()+interval '1 minute' or coalesce(jsonb_typeof(p_refunds),'')<>'array'
    or jsonb_array_length(p_refunds)>1000 then raise exception 'Invalid refund snapshot' using errcode='23514'; end if;
  if payment.refunds_read_started_at is not null and p_read_started_at<=payment.refunds_read_started_at then return jsonb_build_object('applied',false); end if;
  if payment.status not in('completed','refunded','disputed') or payment.stripe_canceled_at is not null then raise exception 'Only a settled payment can have refunds' using errcode='23514'; end if;
  if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(p_refunds)) then raise exception 'Duplicate refund in snapshot' using errcode='23514'; end if;
  if jsonb_array_length(p_refunds)>0 then
    update public.transactions set status='superseded' where payment_id=payment.id and type='refund' and stripe_refund_id is null and status='succeeded';
  end if;
  for refund in select value from jsonb_array_elements(p_refunds) loop
    if coalesce(refund->>'id','')!~'^re_[A-Za-z0-9_]+$' or coalesce(refund->>'status','') not in('pending','requires_action','succeeded','failed','canceled')
      or coalesce((refund->>'amount')::numeric,0)<=0 or (refund->>'amount')::numeric<>trunc((refund->>'amount')::numeric)
      or (refund->>'amount')::numeric>payment.amount*100 or refund->>'currency' is distinct from payment.currency then raise exception 'Invalid canonical refund record' using errcode='23514'; end if;
    select * into prior from public.transactions where stripe_refund_id=refund->>'id' for update;
    if found then
      if prior.payment_id<>payment.id or prior.amount<>(refund->>'amount')::numeric/100 then raise exception 'Refund identity or amount does not match' using errcode='23514'; end if;
      if prior.status in('failed','canceled') or(prior.status='succeeded' and refund->>'status' in('pending','requires_action'))
        or coalesce((prior.metadata->>'stripe_event_created')::numeric,0)>extract(epoch from p_read_started_at) then continue; end if;
      current_status:=prior.status;
      update public.transactions set status=refund->>'status',metadata=coalesce(metadata,'{}')||jsonb_build_object('source','stripe_api',
        'stripe_snapshot_read_started_at',p_read_started_at,'failure_reason',refund->>'failure_reason') where id=prior.id returning status into current_status;
      changed:=changed or current_status<>prior.status;
    else
      insert into public.transactions(payment_id,type,amount,status,stripe_refund_id,metadata)
        values(payment.id,'refund',(refund->>'amount')::numeric/100,refund->>'status',refund->>'id',
          jsonb_build_object('source','stripe_api','stripe_snapshot_read_started_at',p_read_started_at,'failure_reason',refund->>'failure_reason'));
      changed:=true;
    end if;
    if refund->>'status' in('failed','canceled','requires_action') then
      failure:=true;
      foreach recipient in array array[payment.buyer_id,payment.seller_id] loop
        perform needs_private.notify_order(payment.id,recipient,'payment_refund_failed','refund_attention:'||(refund->>'id')||':'||(refund->>'status'));
      end loop;
    end if;
  end loop;
  select coalesce(sum(amount),0) into succeeded_total from public.transactions where payment_id=payment.id and type='refund' and status='succeeded';
  failure:=exists(select 1 from public.transactions where payment_id=payment.id and type='refund' and status in('failed','canceled','requires_action'));
  if succeeded_total>payment.amount then raise exception 'Refund total exceeds payment amount' using errcode='23514'; end if;
  -- Bank disputes retain their own lifecycle. Local complaints continue using
  -- the existing refund trigger/history rather than being silently deleted.
  if not exists(select 1 from public.disputes where payment_id=payment.id and stripe_dispute_id is not null and status in('open','lost')) then
    if succeeded_total>=payment.amount then
      update public.payments set status='refunded',refunded_at=coalesce(refunded_at,clock_timestamp()) where id=payment.id;
    elsif payment.status='refunded' then
      update public.payments set status='completed',refunded_at=null where id=payment.id;
      update public.disputes set status='open',resolved_at=null where payment_id=payment.id and stripe_dispute_id is null and status='refunded';
    end if;
  end if;
  update public.payments set refunds_read_started_at=p_read_started_at,attention_required=attention_required or failure where id=payment.id;
  if changed then
    insert into public.payment_audit_logs(payment_id,action,actor_type,metadata) values(payment.id,'refund_reconciled','system',
      jsonb_build_object('source','stripe_api','read_started_at',p_read_started_at,'successful_refund_total',succeeded_total,'requires_attention',failure));
  end if;
  return jsonb_build_object('applied',true,'successfulRefundTotal',succeeded_total);
end $$;

-- Late legacy webhook/refund delivery cannot turn a partial or FX bank loss
-- into an assertion that the complete purchase was refunded.
create function needs_private.guard_order_financial_history()
returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid;
begin
  if old.stripe_canceled_at is not null and new.status<>'failed' then raise exception 'A canceled provider intent cannot be resurrected' using errcode='23514'; end if;
  if new.status in('completed','refunded','disputed') then
    if needs_private.order_bank_loss_attention(old.id) then
      new.status:='disputed'; new.attention_required:=true;
      if old.status<>'refunded' then new.refunded_at:=old.refunded_at; end if;
      foreach recipient in array array[old.buyer_id,old.seller_id] loop
        perform needs_private.notify_order(old.id,recipient,'payment_attention_required','partial_or_currency_dispute_loss',
          jsonb_build_object('reason_code','partial_or_currency_dispute_loss'));
      end loop;
    elsif exists(select 1 from public.disputes where payment_id=old.id and stripe_dispute_id is not null and status='open') then
      new.status:='disputed';
    end if;
  end if;
  return new;
end $$;
create trigger guard_order_financial_history before update of status on public.payments
  for each row execute function needs_private.guard_order_financial_history();

create function public.reconcile_order_disputes(p_payment_id uuid,p_intent_id text,p_read_started_at timestamptz,p_disputes jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payment public.payments%rowtype; prior public.disputes%rowtype; dispute jsonb; target_status text;
  dispute_id uuid; recipient uuid; changed boolean; successful_refunds numeric;
begin
  select * into payment from public.payments where id=p_payment_id for update;
  if not found or p_intent_id is distinct from payment.stripe_payment_intent or p_read_started_at is null
    or p_read_started_at>clock_timestamp()+interval '1 minute' or coalesce(jsonb_typeof(p_disputes),'')<>'array'
    or jsonb_array_length(p_disputes)>100 then raise exception 'Invalid bank dispute snapshot' using errcode='23514'; end if;
  if payment.disputes_read_started_at is not null and p_read_started_at<=payment.disputes_read_started_at then return jsonb_build_object('applied',false); end if;
  if payment.status not in('completed','refunded','disputed') or payment.stripe_canceled_at is not null then raise exception 'Only a settled payment can have bank disputes' using errcode='23514'; end if;
  if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(p_disputes)) then raise exception 'Duplicate bank dispute in snapshot' using errcode='23514'; end if;
  for dispute in select value from jsonb_array_elements(p_disputes) loop
    if coalesce(dispute->>'id','')!~'^[A-Za-z0-9_]{1,255}$'
      or coalesce(dispute->>'status','') not in('needs_response','under_review','warning_needs_response','warning_under_review','warning_closed','prevented','won','lost')
      or coalesce((dispute->>'amount')::numeric,0)<=0 or (dispute->>'amount')::numeric<>trunc((dispute->>'amount')::numeric)
      or (dispute->>'amount')::numeric>999999999999 or coalesce(dispute->>'currency','')!~'^[a-z]{3}$' then raise exception 'Invalid canonical bank dispute' using errcode='23514'; end if;
    if exists(select 1 from public.disputes where stripe_dispute_id=dispute->>'id' and payment_id<>payment.id) then raise exception 'Bank dispute belongs to another payment' using errcode='23514'; end if;
    target_status:=case dispute->>'status' when 'won' then 'won' when 'lost' then 'lost' when 'warning_closed' then 'resolved' when 'prevented' then 'resolved' else 'open' end;
    select * into prior from public.disputes where payment_id=payment.id and stripe_dispute_id=dispute->>'id' order by created_at,id limit 1 for update;
    changed:=false;
    if prior.id is null then
      insert into public.disputes(payment_id,stripe_dispute_id,reason,status,amount,currency,resolved_at)
        values(payment.id,dispute->>'id',coalesce(dispute->>'reason','unknown'),target_status,(dispute->>'amount')::numeric/100,dispute->>'currency',
          case when target_status<>'open' then clock_timestamp() else null end) returning id into dispute_id;
      changed:=true;
    elsif prior.status not in('won','lost','resolved','refunded','rejected') and prior.status<>target_status then
      update public.disputes set status=target_status,resolved_at=case when target_status<>'open' then clock_timestamp() else null end where id=prior.id;
      dispute_id:=prior.id; changed:=true;
    end if;
    -- Historical webhook versions assumed the complete purchase amount. The
    -- bound provider record supplies the actual amount and its own currency.
    update public.disputes set amount=(dispute->>'amount')::numeric/100,currency=dispute->>'currency'
      where payment_id=payment.id and stripe_dispute_id=dispute->>'id';
    if changed then
      insert into public.payment_audit_logs(payment_id,action,actor_type,metadata) values(payment.id,
        case when target_status='open' then 'dispute_opened' else 'dispute_resolved' end,'system',
        jsonb_build_object('source','stripe_api','read_started_at',p_read_started_at,'stripe_dispute_id',dispute->>'id','dispute_id',dispute_id,'provider_status',dispute->>'status'));
      foreach recipient in array array[payment.buyer_id,payment.seller_id] loop
        perform needs_private.notify_order(payment.id,recipient,case when target_status='open' then 'dispute_opened' else 'dispute_resolved' end,
          'bank_dispute:'||(dispute->>'id')||':'||target_status,jsonb_build_object('dispute_id',dispute_id));
      end loop;
    end if;
  end loop;
  select coalesce(sum(amount),0) into successful_refunds from public.transactions where payment_id=payment.id and type='refund' and status='succeeded';
  if exists(select 1 from public.disputes where payment_id=payment.id and stripe_dispute_id is not null and status='open') then
    update public.payments set status='disputed',disputed_at=coalesce(disputed_at,clock_timestamp()) where id=payment.id;
  elsif exists(select 1 from public.disputes where payment_id=payment.id and stripe_dispute_id is not null and status='lost') or successful_refunds>=payment.amount then
    update public.payments set status='refunded',refunded_at=coalesce(refunded_at,clock_timestamp()) where id=payment.id;
  elsif payment.status='disputed' then
    update public.payments set status='completed' where id=payment.id;
  end if;
  update public.payments set disputes_read_started_at=p_read_started_at where id=payment.id;
  return jsonb_build_object('applied',true);
end $$;

revoke all on function public.reconcile_order_disputes(uuid,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.reconcile_order_disputes(uuid,text,timestamptz,jsonb) to service_role;
revoke all on function needs_private.order_bank_loss_attention(uuid),needs_private.guard_order_financial_history() from public,anon,authenticated;
revoke all on function needs_private.notify_order(uuid,uuid,text,text,jsonb),needs_private.order_lifecycle_blocked(uuid),needs_private.order_authorization_notifications(uuid),needs_private.lock_order_provider(uuid),needs_private.assert_order_cancelable(uuid),needs_private.guard_refund_snapshot() from public,anon,authenticated;
revoke all on function public.request_order_cancellation(uuid,uuid,uuid,text),public.respond_order_cancellation(uuid,uuid,uuid,text),public.claim_order_cancellation(uuid,uuid,uuid),public.claim_admin_order_cancellation(uuid,uuid,text),public.reconcile_order_provider(uuid,text,text,bigint,text,bigint,bigint,bigint,timestamptz,timestamptz,uuid),public.claim_order_reconciliation(integer,integer),public.finish_order_reconciliation(uuid,uuid,text),public.get_order_for_user(uuid,uuid),public.reconcile_order_refunds(uuid,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.request_order_cancellation(uuid,uuid,uuid,text),public.respond_order_cancellation(uuid,uuid,uuid,text),public.claim_order_cancellation(uuid,uuid,uuid),public.claim_admin_order_cancellation(uuid,uuid,text),public.reconcile_order_provider(uuid,text,text,bigint,text,bigint,bigint,bigint,timestamptz,timestamptz,uuid),public.claim_order_reconciliation(integer,integer),public.finish_order_reconciliation(uuid,uuid,text),public.get_order_for_user(uuid,uuid),public.reconcile_order_refunds(uuid,text,timestamptz,jsonb) to service_role;

-- Preserve webhook compatibility with authoritative refund snapshots.
create or replace function public.process_stripe_refund_event(
  p_event jsonb, p_payment_intent text, p_refunds jsonb, p_request_id text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  event_id text := p_event->>'id'; event_created bigint := coalesce((p_event->>'created')::bigint, 0);
  prior public.webhook_events%rowtype; payment public.payments%rowtype;
  actual_refund_status text; prior_refund public.transactions%rowtype; refund jsonb; result jsonb;
  succeeded_total numeric; changed boolean := false; has_failure boolean := false;
begin
  if coalesce(event_id,'') = '' or p_event->>'type' not in ('charge.refunded','refund.created','refund.updated','refund.failed')
    or coalesce(jsonb_typeof(p_refunds),'') <> 'array' then raise exception 'Invalid refund event'; end if;
  insert into public.webhook_events(id,source,event_type,payload) values(event_id,'stripe',p_event->>'type',p_event)
    on conflict(id) do nothing;
  select * into prior from public.webhook_events where id = event_id for update;
  if prior.processed_at is not null and prior.processing_error is null and prior.processing_result->>'action' = 'refund_reconciled' then
    return jsonb_build_object('duplicate',true,'action','already_processed');
  end if;
  select * into payment from public.payments where stripe_payment_intent = p_payment_intent for update;
  if not found then raise exception 'Payment not found for Stripe intent %',p_payment_intent; end if;

  if jsonb_array_length(p_refunds) > 0 then
    -- Preserve legacy ledger entries for audit, excluding them from the totals
    -- now represented by complete canonical records with real refund IDs.
    update public.transactions set status = 'superseded'
      where payment_id = payment.id and type = 'refund' and stripe_refund_id is null and status = 'succeeded';
  end if;
  for refund in select value from jsonb_array_elements(p_refunds) loop
    if coalesce(refund->>'id','') = '' or coalesce(refund->>'status','') not in ('pending','requires_action','succeeded','failed','canceled')
      or coalesce((refund->>'amount')::numeric,0) <= 0 or coalesce(refund->>'currency','') <> payment.currency then
      raise exception 'Invalid canonical refund record';
    end if;
    select * into prior_refund from public.transactions where stripe_refund_id = refund->>'id' for update;
    if found then
      if prior_refund.payment_id <> payment.id then raise exception 'Refund belongs to another payment'; end if;
      -- Failed/canceled refunds are terminal. An earlier HTTP request carrying
      -- a successful snapshot must not overwrite a later failure transaction.
      if prior_refund.status in ('failed','canceled') then continue; end if;
      if coalesce((prior_refund.metadata->>'stripe_event_created')::bigint,0) > event_created then continue; end if;
      if prior_refund.status = 'succeeded' and refund->>'status' = 'pending'
        and coalesce((prior_refund.metadata->>'stripe_event_created')::bigint,0) >= event_created then continue; end if;
      if prior_refund.status = refund->>'status' then
        update public.transactions set metadata = coalesce(metadata,'{}') || jsonb_build_object('stripe_event_created',event_created)
          where id=prior_refund.id;
        continue;
      end if;
      update public.transactions set status = refund->>'status', amount = (refund->>'amount')::numeric / 100,
        metadata = coalesce(metadata,'{}') || jsonb_build_object('stripe_event_id',event_id,'stripe_event_created',event_created,'failure_reason',refund->>'failure_reason')
        where id = prior_refund.id returning status into actual_refund_status;
      -- A newer API snapshot may have rejected this stale event transition.
      if actual_refund_status=prior_refund.status or actual_refund_status<>refund->>'status' then continue; end if;
    else
      insert into public.transactions(payment_id,type,amount,status,stripe_refund_id,metadata)
        values(payment.id,'refund',(refund->>'amount')::numeric/100,refund->>'status',refund->>'id',
          jsonb_build_object('stripe_event_id',event_id,'stripe_event_created',event_created,'failure_reason',refund->>'failure_reason'));
    end if;
    changed := true;
    if refund->>'status' in ('failed','canceled','requires_action') then has_failure := true; end if;
  end loop;
  select coalesce(sum(amount),0) into succeeded_total from public.transactions
    where payment_id = payment.id and type = 'refund' and status = 'succeeded';
  if exists(select 1 from public.disputes where payment_id=payment.id and stripe_dispute_id is not null and status='open') then
    update public.payments set status='disputed' where id=payment.id;
  elsif succeeded_total >= payment.amount then
    update public.payments set status = 'refunded',refunded_at = coalesce(refunded_at,now()) where id = payment.id;
  elsif payment.status = 'refunded' and not exists(select 1 from public.disputes where payment_id = payment.id and stripe_dispute_id is not null and status = 'lost') then
    update public.payments set status = case when exists(select 1 from public.disputes where payment_id = payment.id and stripe_dispute_id is not null and status = 'open') then 'disputed' else 'completed' end,
      refunded_at = null where id = payment.id;
    update public.disputes set status = 'open',resolved_at = null where payment_id = payment.id and stripe_dispute_id is null and status = 'refunded';
  end if;
  if changed then
    insert into public.payment_audit_logs(payment_id,action,actor_type,metadata)
      values(payment.id,'refund_reconciled','system',jsonb_build_object('stripe_event_id',event_id,'successful_refund_total',succeeded_total,'requires_attention',has_failure,'request_id',p_request_id));
    if has_failure then
      insert into public.notifications(user_id,type,payload) values
        (payment.buyer_id,'payment_refund_failed',jsonb_build_object('payment_id',payment.id)),
        (payment.seller_id,'payment_refund_failed',jsonb_build_object('payment_id',payment.id));
    end if;
  end if;
  result := jsonb_build_object('duplicate',false,'action','refund_reconciled','paymentId',payment.id,'successfulRefundTotal',succeeded_total);
  update public.webhook_events set processed_at=now(),processing_error=null,processing_result=result,payload=p_event,event_type=p_event->>'type' where id=event_id;
  return result;
end $$;

-- Same atomic webhook processor; preserve actual bank-dispute amount/currency
-- and recognize Stripe prevented disputes as terminal non-loss resolution.
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
