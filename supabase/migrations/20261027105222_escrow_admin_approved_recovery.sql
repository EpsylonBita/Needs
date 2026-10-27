-- Admin approval authorizes recovery of an original seller transfer after a
-- verified full bank loss. This is never a second refund to the customer.
begin;

alter table public.payments add column refund_claim_id uuid, add column refund_claimed_at timestamptz;

create table public.payment_recoveries (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.payments(id) on delete restrict,
  approved_by uuid not null references auth.users(id) on delete restrict,
  reason text not null check(char_length(btrim(reason)) between 5 and 1000),
  preview_version text not null check(preview_version ~ '^[a-f0-9]{64}$'),
  stripe_platform_id text not null,
  livemode boolean not null,
  stripe_intent_id text not null,
  stripe_charge_id text not null,
  stripe_dispute_id text not null unique,
  stripe_transfer_id text not null unique,
  stripe_account_id text not null,
  stripe_fee_id text,
  gross_amount_minor bigint not null check(gross_amount_minor>0),
  fee_amount_minor bigint not null check(fee_amount_minor>=0 and fee_amount_minor<=gross_amount_minor),
  currency text not null check(currency='eur'),
  status text not null default 'pending' check(status in('pending','completed','review_required')),
  approved_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  provider_checked_at timestamptz not null,
  stripe_reversal_id text unique,
  last_error_code text,
  attempt_count integer not null default 0 check(attempt_count>=0),
  check((status='completed')=(completed_at is not null)),
  check(status<>'completed' or stripe_reversal_id is not null),
  check((fee_amount_minor=0)=(stripe_fee_id is null))
);
create table public.payment_recovery_ledger (
  id uuid primary key default gen_random_uuid(),
  recovery_id uuid not null unique references public.payment_recoveries(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  stripe_reversal_id text not null unique,
  gross_amount_minor bigint not null check(gross_amount_minor>0),
  fee_returned_minor bigint not null check(fee_returned_minor>=0 and fee_returned_minor<=gross_amount_minor),
  currency text not null check(currency='eur'),
  verified_at timestamptz not null default clock_timestamp()
);
create index payment_recoveries_approved_by on public.payment_recoveries(approved_by);
create index payment_recovery_ledger_payment on public.payment_recovery_ledger(payment_id);
alter table public.payment_recoveries enable row level security;
alter table public.payment_recovery_ledger enable row level security;
revoke all on public.payment_recoveries,public.payment_recovery_ledger from public,anon,authenticated;
grant select,insert,update,delete on public.payment_recoveries,public.payment_recovery_ledger to service_role;

create function public.claim_payment_recovery(p_payment_id uuid,p_admin_user_id uuid,p_preview_version text,p_reason text,p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payment public.payments%rowtype; recovery public.payment_recoveries%rowtype; bank public.disputes%rowtype;
begin
  select * into payment from public.payments where id=p_payment_id for update;
  if not found or not exists(select 1 from auth.users where id=p_admin_user_id) then raise exception 'Payment or administrator not found' using errcode='42501'; end if;
  if p_preview_version is null or p_preview_version!~'^[a-f0-9]{64}$' or p_reason is null or char_length(btrim(p_reason)) not between 5 and 1000 then
    raise exception 'Recovery approval is incomplete' using errcode='22023'; end if;
  select * into recovery from public.payment_recoveries where payment_id=payment.id;
  if found then
    if recovery.preview_version<>p_preview_version then raise exception 'Recovery approval changed' using errcode='40001'; end if;
    return to_jsonb(recovery);
  end if;
  if payment.refund_claim_id is not null or payment.capture_claim_id is not null or payment.cancel_claim_id is not null or payment.stripe_canceled_at is not null
    or exists(select 1 from public.transactions where payment_id=payment.id and type='refund') then
    raise exception 'Refund or settlement history requires review' using errcode='23514'; end if;
  if (select count(*) from public.disputes where payment_id=payment.id)<>1 then raise exception 'Multiple or missing dispute history requires review' using errcode='23514'; end if;
  select * into bank from public.disputes where payment_id=payment.id;
  if bank.stripe_dispute_id is null or bank.status<>'lost' or bank.amount is distinct from payment.amount or bank.currency is distinct from payment.currency then
    raise exception 'A single full same-currency bank loss is required' using errcode='23514'; end if;
  if payment.currency<>'eur' or payment.status<>'refunded' or p_snapshot->>'intentId' is distinct from payment.stripe_payment_intent
    or p_snapshot->>'disputeId' is distinct from bank.stripe_dispute_id or p_snapshot->>'currency' is distinct from payment.currency
    or (p_snapshot->>'grossAmountMinor')::bigint is distinct from (payment.amount*100)::bigint
    or (p_snapshot->>'feeAmountMinor')::bigint is distinct from (coalesce(payment.platform_fee,0)*100)::bigint
    or p_snapshot->>'version' is distinct from p_preview_version or p_snapshot->>'disputeStatus' is distinct from 'lost'
    or jsonb_typeof(p_snapshot->'livemode') is distinct from 'boolean'
    or (p_snapshot->>'checkedAt')::timestamptz is null
    or (p_snapshot->>'checkedAt')::timestamptz<clock_timestamp()-interval '2 minutes'
    or (p_snapshot->>'checkedAt')::timestamptz>clock_timestamp()+interval '30 seconds' then
    raise exception 'Current provider facts do not match recovery approval' using errcode='23514'; end if;
  if coalesce(p_snapshot->>'platformId','')!~'^acct_[A-Za-z0-9]+$' or coalesce(p_snapshot->>'accountId','')!~'^acct_[A-Za-z0-9]+$'
    or coalesce(p_snapshot->>'chargeId','')!~'^ch_[A-Za-z0-9]+$' or coalesce(p_snapshot->>'transferId','')!~'^tr_[A-Za-z0-9]+$' then
    raise exception 'Original provider identities are required' using errcode='23514'; end if;
  insert into public.payment_recoveries(payment_id,approved_by,reason,preview_version,stripe_platform_id,livemode,stripe_intent_id,stripe_charge_id,
    stripe_dispute_id,stripe_transfer_id,stripe_account_id,stripe_fee_id,gross_amount_minor,fee_amount_minor,currency,provider_checked_at)
  values(payment.id,p_admin_user_id,btrim(p_reason),p_preview_version,p_snapshot->>'platformId',(p_snapshot->>'livemode')::boolean,
    p_snapshot->>'intentId',p_snapshot->>'chargeId',p_snapshot->>'disputeId',p_snapshot->>'transferId',p_snapshot->>'accountId',nullif(p_snapshot->>'feeId',''),
    (p_snapshot->>'grossAmountMinor')::bigint,(p_snapshot->>'feeAmountMinor')::bigint,payment.currency,(p_snapshot->>'checkedAt')::timestamptz)
  returning * into recovery;
  update public.payments set reconciliation_next_at=clock_timestamp() where id=payment.id;
  insert into public.payment_audit_logs(payment_id,action,actor_type,metadata) values(payment.id,'seller_recovery_approved','admin',
    jsonb_build_object('recovery_id',recovery.id,'admin_user_id',p_admin_user_id,'reason',recovery.reason,'gross_amount_minor',recovery.gross_amount_minor,
      'fee_returned_minor',recovery.fee_amount_minor,'stripe_dispute_id',recovery.stripe_dispute_id));
  return to_jsonb(recovery);
end $$;

-- The same payment row lock serializes normal refunds against recovery approval.
-- An uncertain refund keeps this reservation; idempotent retries use it again.
create function public.reserve_admin_payment_refund(p_payment_id uuid,p_admin_user_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare payment public.payments%rowtype;
begin
  select * into payment from public.payments where id=p_payment_id for update;
  if not found or not exists(select 1 from auth.users where id=p_admin_user_id) then raise exception 'Payment or administrator not found' using errcode='42501'; end if;
  if exists(select 1 from public.payment_recoveries where payment_id=payment.id)
    or exists(select 1 from public.disputes where payment_id=payment.id and stripe_dispute_id is not null and status in('open','lost')) then
    raise exception 'Bank dispute recovery and refunds cannot overlap' using errcode='23514'; end if;
  if payment.status<>'completed' or payment.capture_claim_id is not null or payment.cancel_claim_id is not null then
    raise exception 'Only settled payments can be refunded' using errcode='23514'; end if;
  if payment.refund_claim_id is null then
    update public.payments set refund_claim_id=gen_random_uuid(),refund_claimed_at=clock_timestamp() where id=payment.id returning * into payment;
  end if;
  return payment.refund_claim_id;
end $$;

create function public.record_payment_recovery(p_recovery_id uuid,p_status text,p_reversal_id text default null,p_error_code text default null,p_checked_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare recovery public.payment_recoveries%rowtype; payment public.payments%rowtype; changed boolean;
begin
  select * into recovery from public.payment_recoveries where id=p_recovery_id;
  if not found then raise exception 'Recovery not found' using errcode='P0002'; end if;
  select * into payment from public.payments where id=recovery.payment_id for update;
  select * into recovery from public.payment_recoveries where id=p_recovery_id for update;
  if p_status is null or p_status not in('pending','completed','review_required') or (p_error_code is not null and p_error_code!~'^[a-z0-9_]{1,80}$')
    or p_checked_at is null or p_checked_at>clock_timestamp()+interval '30 seconds' then raise exception 'Invalid recovery result' using errcode='22023'; end if;
  if recovery.status='completed' then
    if p_status='completed' and recovery.stripe_reversal_id is distinct from p_reversal_id then raise exception 'Recovery reversal changed' using errcode='23514'; end if;
    if p_status='review_required' then update public.payments set attention_required=true where id=payment.id; end if;
    return to_jsonb(recovery);
  end if;
  -- A provider reversal accepted before a racing late win still belongs in the
  -- ledger. Recording that fact does not authorize any new transfer.
  if recovery.status='review_required' and p_status='pending' then return to_jsonb(recovery); end if;
  if p_checked_at<recovery.provider_checked_at and p_status<>'completed' then return to_jsonb(recovery); end if;
  if p_status='completed' and coalesce(p_reversal_id,'')!~'^trr_[A-Za-z0-9]+$' then raise exception 'Verified reversal identity is required' using errcode='23514'; end if;
  changed:=recovery.status<>p_status or recovery.last_error_code is distinct from p_error_code;
  update public.payment_recoveries set status=p_status,updated_at=clock_timestamp(),provider_checked_at=greatest(provider_checked_at,p_checked_at),
    completed_at=case when p_status='completed' then clock_timestamp() else null end,
    stripe_reversal_id=case when p_status='completed' then p_reversal_id else stripe_reversal_id end,
    last_error_code=p_error_code,attempt_count=attempt_count+1 where id=recovery.id returning * into recovery;
  if p_status='completed' then
    insert into public.payment_recovery_ledger(recovery_id,payment_id,stripe_reversal_id,gross_amount_minor,fee_returned_minor,currency)
      values(recovery.id,payment.id,p_reversal_id,recovery.gross_amount_minor,recovery.fee_amount_minor,recovery.currency);
  end if;
  if p_status<>'completed' or p_error_code is not null then update public.payments set attention_required=true where id=payment.id; end if;
  if changed or p_status='completed' then
    insert into public.payment_audit_logs(payment_id,action,actor_type,metadata) values(payment.id,'seller_recovery_'||p_status,'system',
      jsonb_build_object('recovery_id',recovery.id,'stripe_reversal_id',p_reversal_id,'error_code',p_error_code));
  end if;
  return to_jsonb(recovery);
end $$;

create function public.authorize_payment_recovery_attempt(p_recovery_id uuid,p_platform_id text,p_livemode boolean,p_lease_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare recovery public.payment_recoveries%rowtype; payment public.payments%rowtype;
begin
  select * into recovery from public.payment_recoveries where id=p_recovery_id;
  if not found then raise exception 'Recovery not found' using errcode='P0002'; end if;
  select * into payment from public.payments where id=recovery.payment_id for update;
  select * into recovery from public.payment_recoveries where id=p_recovery_id;
  if p_lease_id is not null and(payment.reconciliation_lease_id is distinct from p_lease_id or payment.reconciliation_lease_until is null or payment.reconciliation_lease_until<=clock_timestamp()) then
    return jsonb_build_object('allowed',false,'reason','lease_lost'); end if;
  if recovery.status='completed' then return jsonb_build_object('allowed',false,'reason','completed'); end if;
  if recovery.status<>'pending' or recovery.stripe_platform_id is distinct from p_platform_id or recovery.livemode is distinct from p_livemode
    or payment.refund_claim_id is not null or exists(select 1 from public.transactions where payment_id=payment.id and type='refund')
    or (select count(*) from public.disputes where payment_id=payment.id)<>1
    or not exists(select 1 from public.disputes where payment_id=payment.id and stripe_dispute_id=recovery.stripe_dispute_id and status='lost'
      and amount*100=recovery.gross_amount_minor and currency=recovery.currency) then
    return jsonb_build_object('allowed',false,'reason','state_changed'); end if;
  return jsonb_build_object('allowed',true);
end $$;

revoke all on function public.claim_payment_recovery(uuid,uuid,text,text,jsonb),public.reserve_admin_payment_refund(uuid,uuid),public.record_payment_recovery(uuid,text,text,text,timestamptz),public.authorize_payment_recovery_attempt(uuid,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.claim_payment_recovery(uuid,uuid,text,text,jsonb),public.reserve_admin_payment_refund(uuid,uuid),public.record_payment_recovery(uuid,text,text,text,timestamptz),public.authorize_payment_recovery_attempt(uuid,text,boolean,uuid) to service_role;
commit;
