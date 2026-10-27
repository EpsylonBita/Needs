-- Preserve original charge/fee units independently from actual seller settlement.
-- No exchange rate is calculated: destination payment and fee refund are verified
-- from the exact provider objects bound to the approved original transfer.
begin;
alter table public.payment_recoveries drop constraint payment_recoveries_currency_check;
alter table public.payment_recoveries add constraint payment_recoveries_currency_check check(currency in('eur','usd','gbp'));
alter table public.payment_recovery_ledger drop constraint payment_recovery_ledger_currency_check;
alter table public.payment_recovery_ledger add constraint payment_recovery_ledger_currency_check check(currency in('eur','usd','gbp'));
alter table public.payment_recoveries
  add column stripe_destination_payment_id text,
  add column original_amount_minor bigint,
  add column original_currency text,
  add column original_requested_fee_minor bigint,
  add column original_fee_amount_minor bigint,
  add column original_fee_currency text,
  add column stripe_fee_refund_id text unique,
  add column fee_refund_amount_minor bigint,
  add column fee_refund_currency text;
alter table public.payment_recovery_ledger
  add column original_amount_minor bigint,
  add column original_currency text,
  add column original_fee_amount_minor bigint,
  add column original_fee_currency text,
  add column stripe_destination_payment_id text,
  add column stripe_fee_refund_id text unique,
  add column fee_refund_amount_minor bigint,
  add column fee_refund_currency text;
-- The previous implementation allowed only identical charge/transfer/fee units.
-- Those original values are known; a destination-payment ID is not. Never invent it.
update public.payment_recoveries set original_amount_minor=gross_amount_minor,original_currency=currency,
  original_requested_fee_minor=fee_amount_minor,original_fee_amount_minor=case when stripe_fee_id is not null then fee_amount_minor end,
  original_fee_currency=case when stripe_fee_id is not null then currency end;
update public.payment_recovery_ledger l set original_amount_minor=r.original_amount_minor,original_currency=r.original_currency,
  original_fee_amount_minor=r.original_fee_amount_minor,original_fee_currency=r.original_fee_currency
  from public.payment_recoveries r where r.id=l.recovery_id;
insert into public.payment_audit_logs(payment_id,action,actor_type,metadata)
  select payment_id,'seller_recovery_review_required','system',jsonb_build_object('recovery_id',id,'error_code','legacy_settlement_unverified')
  from public.payment_recoveries where status='pending';
update public.payments set attention_required=true where id in(select payment_id from public.payment_recoveries where status='pending');
update public.payment_recoveries set status='review_required',last_error_code='legacy_settlement_unverified',updated_at=clock_timestamp() where status='pending';
alter table public.payment_recoveries
  alter column original_amount_minor set not null,alter column original_currency set not null,alter column original_requested_fee_minor set not null,
  add constraint recovery_original_amounts check(original_amount_minor>0 and original_currency='eur' and original_requested_fee_minor>=0 and original_requested_fee_minor<=original_amount_minor),
  add constraint recovery_original_fee check((stripe_fee_id is null and original_fee_amount_minor is null and original_fee_currency is null and original_requested_fee_minor=0)
    or(stripe_fee_id is not null and original_fee_amount_minor is not null and original_fee_amount_minor>0
      and original_fee_currency is not null and original_fee_currency ~ '^[a-z]{3}$' and original_requested_fee_minor>0));
alter table public.payment_recovery_ledger alter column original_amount_minor set not null,alter column original_currency set not null;
comment on column public.payment_recoveries.gross_amount_minor is 'Exact original destination-transfer gross in currency; never the customer charge amount after FX.';
comment on column public.payment_recoveries.fee_amount_minor is 'Original destination payment application_fee_amount in the same settlement currency.';
comment on column public.payment_recoveries.original_amount_minor is 'Original customer PaymentIntent amount in original_currency; bank dispute must exactly match.';
comment on column public.payment_recoveries.original_requested_fee_minor is 'Original PaymentIntent application_fee_amount in original_currency.';
comment on column public.payment_recoveries.original_fee_amount_minor is 'Original ApplicationFee.amount in original_fee_currency; may differ from destination settlement units.';
comment on column public.payment_recoveries.fee_refund_amount_minor is 'Actual FeeRefund.amount in fee_refund_currency, independently bound to the original fee and destination settlement.';

create or replace function public.claim_payment_recovery(p_payment_id uuid,p_admin_user_id uuid,p_preview_version text,p_reason text,p_snapshot jsonb)
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
    or p_snapshot->>'disputeId' is distinct from bank.stripe_dispute_id or p_snapshot->>'originalCurrency' is distinct from payment.currency
    or (p_snapshot->>'originalAmountMinor')::bigint is distinct from (payment.amount*100)::bigint
    or (p_snapshot->>'originalRequestedFeeMinor')::bigint is distinct from (coalesce(payment.platform_fee,0)*100)::bigint
    or p_snapshot->>'version' is distinct from p_preview_version or p_snapshot->>'disputeStatus' is distinct from 'lost'
    or jsonb_typeof(p_snapshot->'livemode') is distinct from 'boolean'
    or (p_snapshot->>'checkedAt')::timestamptz is null
    or (p_snapshot->>'checkedAt')::timestamptz<clock_timestamp()-interval '2 minutes'
    or (p_snapshot->>'checkedAt')::timestamptz>clock_timestamp()+interval '30 seconds' then
    raise exception 'Current provider facts do not match recovery approval' using errcode='23514'; end if;
  if coalesce(p_snapshot->>'platformId','')!~'^acct_[A-Za-z0-9]+$' or coalesce(p_snapshot->>'accountId','')!~'^acct_[A-Za-z0-9]+$'
    or coalesce(p_snapshot->>'chargeId','')!~'^ch_[A-Za-z0-9]+$' or coalesce(p_snapshot->>'transferId','')!~'^tr_[A-Za-z0-9]+$'
    or coalesce(p_snapshot->>'destinationPaymentId','')!~'^(py|ch)_[A-Za-z0-9]+$'
    or coalesce(p_snapshot->>'currency','') not in('eur','usd','gbp')
    or coalesce((p_snapshot->>'grossAmountMinor')::bigint,0)<=0
    or coalesce((p_snapshot->>'feeAmountMinor')::bigint,-1)<0
    or (p_snapshot->>'feeAmountMinor')::bigint>(p_snapshot->>'grossAmountMinor')::bigint then
    raise exception 'Original provider identities are required' using errcode='23514'; end if;
  insert into public.payment_recoveries(payment_id,approved_by,reason,preview_version,stripe_platform_id,livemode,stripe_intent_id,stripe_charge_id,
    stripe_dispute_id,stripe_transfer_id,stripe_account_id,stripe_fee_id,gross_amount_minor,fee_amount_minor,currency,provider_checked_at,
    stripe_destination_payment_id,original_amount_minor,original_currency,original_requested_fee_minor,original_fee_amount_minor,original_fee_currency)
  values(payment.id,p_admin_user_id,btrim(p_reason),p_preview_version,p_snapshot->>'platformId',(p_snapshot->>'livemode')::boolean,
    p_snapshot->>'intentId',p_snapshot->>'chargeId',p_snapshot->>'disputeId',p_snapshot->>'transferId',p_snapshot->>'accountId',nullif(p_snapshot->>'feeId',''),
    (p_snapshot->>'grossAmountMinor')::bigint,(p_snapshot->>'feeAmountMinor')::bigint,p_snapshot->>'currency',(p_snapshot->>'checkedAt')::timestamptz,
    p_snapshot->>'destinationPaymentId',(p_snapshot->>'originalAmountMinor')::bigint,payment.currency,(p_snapshot->>'originalRequestedFeeMinor')::bigint,
    (p_snapshot->>'originalFeeAmountMinor')::bigint,p_snapshot->>'originalFeeCurrency')
  returning * into recovery;
  update public.payments set reconciliation_next_at=clock_timestamp() where id=payment.id;
  insert into public.payment_audit_logs(payment_id,action,actor_type,metadata) values(payment.id,'seller_recovery_approved','admin',
    jsonb_build_object('recovery_id',recovery.id,'admin_user_id',p_admin_user_id,'reason',recovery.reason,'gross_amount_minor',recovery.gross_amount_minor,
      'fee_returned_minor',recovery.fee_amount_minor,'settlement_currency',recovery.currency,'original_amount_minor',recovery.original_amount_minor,
      'original_currency',recovery.original_currency,'stripe_dispute_id',recovery.stripe_dispute_id));
  return to_jsonb(recovery);
end $$;


drop function public.record_payment_recovery(uuid,text,text,text,timestamptz);
create function public.record_payment_recovery(p_recovery_id uuid,p_status text,p_reversal_id text default null,p_error_code text default null,p_checked_at timestamptz default null,
  p_fee_refund_id text default null,p_fee_refund_amount_minor bigint default null,p_fee_refund_currency text default null)
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
    if p_status='completed' and(recovery.stripe_reversal_id is distinct from p_reversal_id or recovery.stripe_fee_refund_id is distinct from p_fee_refund_id) then raise exception 'Recovery reversal changed' using errcode='23514'; end if;
    if p_status='review_required' then update public.payments set attention_required=true where id=payment.id; end if;
    return to_jsonb(recovery);
  end if;
  -- A provider reversal accepted before a racing late win still belongs in the
  -- ledger. Recording that fact does not authorize any new transfer.
  if recovery.status='review_required' and p_status='pending' then return to_jsonb(recovery); end if;
  if p_checked_at<recovery.provider_checked_at and p_status<>'completed' then return to_jsonb(recovery); end if;
  if p_status='completed' and coalesce(p_reversal_id,'')!~'^trr_[A-Za-z0-9]+$' then raise exception 'Verified reversal identity is required' using errcode='23514'; end if;
  if p_status='completed' and(
    (recovery.fee_amount_minor>0 and(coalesce(p_fee_refund_id,'')!~'^fr_[A-Za-z0-9]+$' or p_fee_refund_amount_minor is distinct from recovery.fee_amount_minor or p_fee_refund_currency is distinct from recovery.currency))
    or(recovery.fee_amount_minor=0 and(p_fee_refund_id is not null or p_fee_refund_amount_minor is not null or p_fee_refund_currency is not null))) then
    raise exception 'Verified fee refund does not match the original settlement' using errcode='23514'; end if;
  changed:=recovery.status<>p_status or recovery.last_error_code is distinct from p_error_code;
  update public.payment_recoveries set status=p_status,updated_at=clock_timestamp(),provider_checked_at=greatest(provider_checked_at,p_checked_at),
    completed_at=case when p_status='completed' then clock_timestamp() else null end,
    stripe_reversal_id=case when p_status='completed' then p_reversal_id else stripe_reversal_id end,
    stripe_fee_refund_id=case when p_status='completed' then p_fee_refund_id else stripe_fee_refund_id end,
    fee_refund_amount_minor=case when p_status='completed' then p_fee_refund_amount_minor else fee_refund_amount_minor end,
    fee_refund_currency=case when p_status='completed' then p_fee_refund_currency else fee_refund_currency end,
    last_error_code=p_error_code,attempt_count=attempt_count+1 where id=recovery.id returning * into recovery;
  if p_status='completed' then
    insert into public.payment_recovery_ledger(recovery_id,payment_id,stripe_reversal_id,gross_amount_minor,fee_returned_minor,currency,
      original_amount_minor,original_currency,original_fee_amount_minor,original_fee_currency,stripe_destination_payment_id,stripe_fee_refund_id,fee_refund_amount_minor,fee_refund_currency)
      values(recovery.id,payment.id,p_reversal_id,recovery.gross_amount_minor,recovery.fee_amount_minor,recovery.currency,recovery.original_amount_minor,recovery.original_currency,recovery.original_fee_amount_minor,recovery.original_fee_currency,
      recovery.stripe_destination_payment_id,p_fee_refund_id,p_fee_refund_amount_minor,p_fee_refund_currency);
  end if;
  if p_status<>'completed' or p_error_code is not null then update public.payments set attention_required=true where id=payment.id; end if;
  if changed or p_status='completed' then
    insert into public.payment_audit_logs(payment_id,action,actor_type,metadata) values(payment.id,'seller_recovery_'||p_status,'system',
      jsonb_build_object('recovery_id',recovery.id,'stripe_reversal_id',p_reversal_id,'stripe_fee_refund_id',p_fee_refund_id,'fee_refund_amount_minor',p_fee_refund_amount_minor,
        'fee_refund_currency',p_fee_refund_currency,'error_code',p_error_code));
  end if;
  return to_jsonb(recovery);
end $$;


create or replace function public.authorize_payment_recovery_attempt(p_recovery_id uuid,p_platform_id text,p_livemode boolean,p_lease_id uuid default null)
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
  if recovery.stripe_destination_payment_id is null or recovery.status<>'pending' or recovery.stripe_platform_id is distinct from p_platform_id or recovery.livemode is distinct from p_livemode
    or payment.refund_claim_id is not null or exists(select 1 from public.transactions where payment_id=payment.id and type='refund')
    or (select count(*) from public.disputes where payment_id=payment.id)<>1
    or not exists(select 1 from public.disputes where payment_id=payment.id and stripe_dispute_id=recovery.stripe_dispute_id and status='lost'
      and amount*100=recovery.original_amount_minor and currency=recovery.original_currency) then
    return jsonb_build_object('allowed',false,'reason','state_changed'); end if;
  return jsonb_build_object('allowed',true);
end $$;


revoke all on function public.record_payment_recovery(uuid,text,text,text,timestamptz,text,bigint,text) from public,anon,authenticated;
grant execute on function public.record_payment_recovery(uuid,text,text,text,timestamptz,text,bigint,text) to service_role;
commit;
