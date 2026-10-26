-- Mutually accepted, chat-scoped service totals. Deploy before agreement APIs.
-- Fixed-price and milestone RPCs retain their existing contracts. Stripe objects
-- are created unconfirmed; their client secret is released only after persistence.
begin;

create schema if not exists needs_private;
grant usage on schema needs_private to service_role;

create table if not exists public.service_price_agreements (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete restrict,
  chat_id uuid not null references public.chats(id) on delete restrict,
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  seller_id uuid not null references public.profiles(id) on delete restrict,
  proposed_by uuid not null references public.profiles(id) on delete restrict,
  accepted_by uuid references public.profiles(id) on delete restrict,
  amount numeric not null check (amount::text not in ('NaN','Infinity','-Infinity') and amount between 0.50 and 999999.99 and amount=round(amount,2)),
  currency text not null default 'eur' check (currency='eur'),
  status text not null default 'proposed' check (status in ('proposed','accepted','rejected','withdrawn','superseded')),
  listing_snapshot jsonb not null check (jsonb_typeof(listing_snapshot)='object'),
  created_at timestamptz not null default clock_timestamp(),
  responded_at timestamptz,
  checkout_started_at timestamptz,
  check (buyer_id<>seller_id and proposed_by in (buyer_id,seller_id)),
  check (accepted_by is null or (accepted_by in (buyer_id,seller_id) and accepted_by<>proposed_by)),
  check (status<>'accepted' or accepted_by is not null),
  check (status<>'proposed' or accepted_by is null),
  check (checkout_started_at is null or status='accepted')
);
create unique index if not exists service_price_agreements_current_chat
  on public.service_price_agreements(chat_id) where status in ('proposed','accepted');
create index if not exists service_price_agreements_chat_history
  on public.service_price_agreements(chat_id,created_at desc,id desc);
alter table public.service_price_agreements enable row level security;
revoke all on public.service_price_agreements from public,anon,authenticated;
grant select on public.service_price_agreements to authenticated;
grant select,insert,update on public.service_price_agreements to service_role;
drop policy if exists service_price_agreements_participant_read on public.service_price_agreements;
create policy service_price_agreements_participant_read on public.service_price_agreements for select to authenticated
  using (exists(select 1 from public.profiles p where p.user_id=(select auth.uid()) and p.id in(buyer_id,seller_id)));

-- Preserve the existing friendly owner-delete error for unpaid proposals too;
-- their listing/chat context is retained even before a payment exists.
create or replace function public.protect_listing_history()
returns trigger language plpgsql security definer set search_path='' as $$
declare has_history boolean;
begin
  select exists(select 1 from public.payments where listing_id=old.id)
    or exists(select 1 from public.milestones where listing_id=old.id)
    or exists(select 1 from public.reviews where listing_id=old.id)
    or exists(select 1 from public.payment_audit_logs where listing_id=old.id)
    or exists(select 1 from public.service_price_agreements where listing_id=old.id)
    into has_history;
  if not has_history and to_regclass('public.orders') is not null then
    execute 'select exists(select 1 from public.orders where listing_id=$1)' into has_history using old.id;
  end if;
  if has_history then
    raise exception 'This listing has activity history and cannot be deleted. Pause it instead.' using errcode='23503';
  end if;
  return old;
end;
$$;
revoke all on function public.protect_listing_history() from public,anon,authenticated;
drop trigger if exists protect_listing_history on public.listings;
create trigger protect_listing_history before delete on public.listings for each row execute function public.protect_listing_history();

alter table public.payments add column if not exists agreement_id uuid references public.service_price_agreements(id) on delete restrict;
alter table public.payments add column if not exists stripe_canceled_at timestamptz;
-- A failed card attempt can retain a live Stripe client secret. Only a verified
-- cancellation marker, never status='failed', permits another payment attempt.
create unique index if not exists payments_service_agreement_active_attempt
  on public.payments(agreement_id) where agreement_id is not null and stripe_canceled_at is null;
create index if not exists payments_service_agreement_history on public.payments(agreement_id) where agreement_id is not null;
grant select,insert,update on public.payments,public.payment_audit_logs to service_role;
grant select,update on public.listings,public.chats to service_role;
grant select on public.profiles,public.chat_participants to service_role;

create or replace function needs_private.service_listing_snapshot(p_listing public.listings)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('title',p_listing.title,'description',p_listing.description,'price',p_listing.price,
    'main_category',p_listing.main_category,'sub_category',p_listing.sub_category,'seller_id',p_listing.seller_id);
$$;

-- Listing UPDATE and checkout creation both own the listing row before reading
-- payment state. Keep the exact accepted details stable while a client secret
-- can still fund its checkout; completed/refunded or verified-canceled attempts
-- no longer prevent a publisher from revising the advertisement.
create or replace function public.protect_service_agreement_listing_terms()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if needs_private.service_listing_snapshot(new) is not distinct from needs_private.service_listing_snapshot(old) then return new; end if;
  if exists(select 1 from public.payments where listing_id=old.id and agreement_id is not null
    and stripe_canceled_at is null and status not in('completed','refunded')) then
    raise exception 'This listing has an active agreed-price checkout. Its agreed details cannot change.' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_service_agreement_listing_terms() from public,anon,authenticated;
drop trigger if exists protect_service_agreement_listing_terms on public.listings;
create trigger protect_service_agreement_listing_terms before update on public.listings
  for each row execute function public.protect_service_agreement_listing_terms();

-- Every agreement mutation takes the same listing -> chat -> agreement locks.
-- Chat leave/rejoin operations also lock the chat, so membership is rechecked
-- after that lock rather than trusting an earlier API read.
create or replace function needs_private.service_agreement_context(p_listing_id uuid,p_chat_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare target public.listings%rowtype; members uuid[]; departed boolean; counterparty uuid; buyer uuid; seller uuid;
begin
  select * into target from public.listings where id=p_listing_id for update;
  if not found or target.status<>'active' then raise exception 'Service listing not found or unavailable'; end if;
  if target.main_category<>'Services' or target.sub_category not in('I want','I will','I can') then
    raise exception 'Choose an active service listing';
  end if;
  perform 1 from public.chats where id=p_chat_id and listing_id=p_listing_id and type='direct' for update;
  if not found then raise exception 'Choose a conversation for this listing'; end if;
  select array_agg(user_id),coalesce(bool_or(left_at is not null),false) into members,departed
    from public.chat_participants where chat_id=p_chat_id;
  if cardinality(members) is distinct from 2 or departed or p_actor_id is null
    or not p_actor_id=any(members) or not target.seller_id=any(members) then
    raise exception 'Only active participants can agree on a service price' using errcode='42501';
  end if;
  select member into counterparty from unnest(members) member where member<>target.seller_id;
  buyer:=case when target.sub_category='I want' then target.seller_id else counterparty end;
  seller:=case when target.sub_category='I want' then counterparty else target.seller_id end;
  return jsonb_build_object('buyer_id',buyer,'seller_id',seller,'listing_snapshot',needs_private.service_listing_snapshot(target));
end;
$$;

create or replace function needs_private.service_payment_result(p_payment public.payments)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('payment_id',p_payment.id,'agreement_id',p_payment.agreement_id,
    'listing_id',p_payment.listing_id,'chat_id',p_payment.chat_id,'buyer_id',p_payment.buyer_id,'seller_id',p_payment.seller_id,
    'amount',p_payment.amount,'platform_fee',p_payment.platform_fee,'currency',p_payment.currency,
    'stripe_payment_intent',p_payment.stripe_payment_intent,'stripe_canceled_at',p_payment.stripe_canceled_at);
$$;

create or replace function public.propose_service_price_agreement(
  p_listing_id uuid,p_chat_id uuid,p_actor_id uuid,p_amount numeric,p_expected_agreement_id uuid default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare context jsonb; previous public.service_price_agreements%rowtype; result public.service_price_agreements%rowtype;
begin
  if p_amount is null or p_amount::text in('NaN','Infinity','-Infinity') or p_amount<0.50 or p_amount>999999.99 or p_amount<>round(p_amount,2) then
    raise exception 'Enter a total from EUR 0.50 to EUR 999999.99 with at most two decimal places' using errcode='22023';
  end if;
  context:=needs_private.service_agreement_context(p_listing_id,p_chat_id,p_actor_id);
  select * into previous from public.service_price_agreements where chat_id=p_chat_id order by created_at desc,id desc limit 1 for update;
  if previous.id is distinct from p_expected_agreement_id then raise exception 'The agreement changed. Refresh and try again.'; end if;
  if previous.checkout_started_at is not null or exists(select 1 from public.payments where agreement_id=previous.id and stripe_canceled_at is null) then
    raise exception 'Checkout has already started for this agreement';
  end if;
  if exists(select 1 from public.payments where listing_id=p_listing_id
      and buyer_id=(context->>'buyer_id')::uuid and seller_id=(context->>'seller_id')::uuid and status<>'failed') then
    raise exception 'Resolve the existing payment before agreeing on another total';
  end if;
  update public.service_price_agreements set status='superseded',responded_at=clock_timestamp()
    where id=previous.id and status in('proposed','accepted');
  insert into public.service_price_agreements(listing_id,chat_id,buyer_id,seller_id,proposed_by,amount,listing_snapshot,created_at)
    values(p_listing_id,p_chat_id,(context->>'buyer_id')::uuid,(context->>'seller_id')::uuid,p_actor_id,p_amount,
      context->'listing_snapshot',greatest(clock_timestamp(),previous.created_at+interval '1 microsecond')) returning * into result;
  return to_jsonb(result);
end;
$$;

create or replace function public.respond_service_price_agreement(p_agreement_id uuid,p_actor_id uuid,p_action text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare agreement public.service_price_agreements%rowtype; context jsonb; current_id uuid;
begin
  if p_action is null or p_action not in('accept','reject','withdraw') then raise exception 'Invalid agreement action' using errcode='22023'; end if;
  select * into agreement from public.service_price_agreements where id=p_agreement_id;
  if not found then raise exception 'Agreement not found'; end if;
  context:=needs_private.service_agreement_context(agreement.listing_id,agreement.chat_id,p_actor_id);
  select * into agreement from public.service_price_agreements where id=p_agreement_id for update;
  select id into current_id from public.service_price_agreements where chat_id=agreement.chat_id order by created_at desc,id desc limit 1;
  if current_id is distinct from agreement.id then raise exception 'The agreement changed. Refresh and try again.'; end if;
  if p_actor_id not in(agreement.buyer_id,agreement.seller_id) then
    raise exception 'Only active participants can agree on a service price' using errcode='42501';
  end if;
  if agreement.checkout_started_at is not null or exists(select 1 from public.payments where agreement_id=agreement.id and stripe_canceled_at is null) then
    raise exception 'Checkout has already started for this agreement';
  end if;
  if p_action='withdraw' then
    if agreement.status not in('proposed','accepted') then raise exception 'This proposal is no longer awaiting a response'; end if;
    if agreement.status='proposed' and p_actor_id<>agreement.proposed_by then
      raise exception 'Only the proposer can withdraw a pending proposal' using errcode='42501';
    end if;
    update public.service_price_agreements set status='withdrawn',responded_at=clock_timestamp() where id=agreement.id returning * into agreement;
  else
    if p_actor_id=agreement.proposed_by then
      raise exception 'Only the other participant can accept or reject this proposal' using errcode='42501';
    end if;
    if p_action='accept' and agreement.status='accepted' and agreement.accepted_by=p_actor_id then return to_jsonb(agreement); end if;
    if agreement.status<>'proposed' then raise exception 'This proposal is no longer awaiting a response'; end if;
    if p_action='accept' and (agreement.listing_snapshot is distinct from context->'listing_snapshot'
      or agreement.buyer_id is distinct from(context->>'buyer_id')::uuid or agreement.seller_id is distinct from(context->>'seller_id')::uuid) then
      raise exception 'The listing changed. Create and accept a new price proposal.';
    end if;
    update public.service_price_agreements set status=case when p_action='accept' then 'accepted' else 'rejected' end,
      accepted_by=case when p_action='accept' then p_actor_id else null end,responded_at=clock_timestamp()
      where id=agreement.id returning * into agreement;
  end if;
  return to_jsonb(agreement);
end;
$$;

create or replace function public.create_agreed_service_payment(p_agreement_id uuid,p_buyer_id uuid,p_intent_id text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare agreement public.service_price_agreements%rowtype; context jsonb; existing public.payments%rowtype; result public.payments%rowtype; current_id uuid;
begin
  if p_intent_id is null or p_intent_id!~'^pi_[A-Za-z0-9_]+$' or length(p_intent_id)>255 then raise exception 'Invalid payment intent' using errcode='22023'; end if;
  select * into agreement from public.service_price_agreements where id=p_agreement_id;
  if not found then raise exception 'Agreement not found'; end if;
  context:=needs_private.service_agreement_context(agreement.listing_id,agreement.chat_id,p_buyer_id);
  select * into agreement from public.service_price_agreements where id=p_agreement_id for update;
  if p_buyer_id is distinct from agreement.buyer_id or p_buyer_id is distinct from(context->>'buyer_id')::uuid then
    raise exception 'Only the buyer can pay this agreement' using errcode='42501';
  end if;
  select * into existing from public.payments where stripe_payment_intent=p_intent_id for update;
  if found then
    if existing.agreement_id is distinct from agreement.id or existing.buyer_id is distinct from agreement.buyer_id
      or existing.seller_id is distinct from agreement.seller_id or existing.listing_id is distinct from agreement.listing_id
      or existing.chat_id is distinct from agreement.chat_id or existing.amount is distinct from agreement.amount
      or existing.currency<>'eur' or existing.milestone_id is not null then
      raise exception 'The payment intent does not match this agreement';
    end if;
    return needs_private.service_payment_result(existing);
  end if;
  select id into current_id from public.service_price_agreements where chat_id=agreement.chat_id order by created_at desc,id desc limit 1;
  if agreement.status<>'accepted' or current_id is distinct from agreement.id then raise exception 'Accept the current total before payment'; end if;
  if agreement.listing_snapshot is distinct from context->'listing_snapshot'
    or agreement.seller_id is distinct from(context->>'seller_id')::uuid then
    raise exception 'The listing changed. Create and accept a new price proposal.';
  end if;
  if exists(select 1 from public.payments where agreement_id=agreement.id and stripe_canceled_at is null) then
    raise exception 'This agreement already has a payment. Resume it instead.';
  end if;
  if exists(select 1 from public.payments where listing_id=agreement.listing_id and buyer_id=agreement.buyer_id
    and seller_id=agreement.seller_id and status<>'failed') then
    raise exception 'Resolve the existing payment before agreeing on another total';
  end if;
  -- Match the legacy initial status. Only a verified payment_authorized audit
  -- event enables delivery confirmation/capture; creating a row does not.
  insert into public.payments(listing_id,buyer_id,seller_id,amount,platform_fee,stripe_payment_intent,status,currency,chat_id,agreement_id)
    values(agreement.listing_id,agreement.buyer_id,agreement.seller_id,agreement.amount,round(agreement.amount*0.05,2),
      p_intent_id,'requires_capture','eur',agreement.chat_id,agreement.id) returning * into result;
  update public.service_price_agreements set checkout_started_at=coalesce(checkout_started_at,clock_timestamp()) where id=agreement.id;
  insert into public.payment_audit_logs(payment_id,action,buyer_id,seller_id,listing_id,amount,platform_fee,metadata)
    values(result.id,'service_agreement_payment_created',result.buyer_id,result.seller_id,result.listing_id,result.amount,result.platform_fee,
      jsonb_build_object('agreement_id',agreement.id,'chat_id',agreement.chat_id,'intent_id',p_intent_id));
  return needs_private.service_payment_result(result);
end;
$$;

-- This trusted RPC must be called ONLY after retrieving the exact Stripe intent
-- and verifying status='canceled'. A declined card or network timeout is not cancellation.
create or replace function public.retire_service_agreement_payment(p_agreement_id uuid,p_buyer_id uuid,p_intent_id text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare agreement public.service_price_agreements%rowtype; payment public.payments%rowtype;
begin
  select * into agreement from public.service_price_agreements where id=p_agreement_id;
  if not found then raise exception 'Agreement not found'; end if;
  -- Retirement is financial cleanup, so leaving/pausing a conversation must not
  -- stop the server from recording an already verified external cancellation.
  perform 1 from public.listings where id=agreement.listing_id for update;
  perform 1 from public.chats where id=agreement.chat_id for update;
  select * into agreement from public.service_price_agreements where id=p_agreement_id for update;
  if p_buyer_id is distinct from agreement.buyer_id then raise exception 'Only the buyer can pay this agreement' using errcode='42501'; end if;
  select * into payment from public.payments where agreement_id=agreement.id and stripe_payment_intent=p_intent_id for update;
  if not found or payment.buyer_id<>agreement.buyer_id or payment.seller_id<>agreement.seller_id
    or payment.listing_id<>agreement.listing_id or payment.chat_id is distinct from agreement.chat_id then
    raise exception 'Payment not found for this agreement';
  end if;
  if payment.status in('completed','refunded','disputed') then raise exception 'Only an uncompleted payment can be retired'; end if;
  if payment.stripe_canceled_at is null then
    update public.payments set stripe_canceled_at=clock_timestamp(),status='failed',failed_at=coalesce(failed_at,clock_timestamp())
      where id=payment.id returning * into payment;
    insert into public.payment_audit_logs(payment_id,action,buyer_id,seller_id,listing_id,amount,platform_fee,metadata)
      values(payment.id,'service_agreement_intent_canceled',payment.buyer_id,payment.seller_id,payment.listing_id,payment.amount,payment.platform_fee,
        jsonb_build_object('agreement_id',agreement.id,'intent_id',p_intent_id));
  end if;
  if not exists(select 1 from public.payments where agreement_id=agreement.id and stripe_canceled_at is null) then
    update public.service_price_agreements set checkout_started_at=null where id=agreement.id;
  end if;
  return needs_private.service_payment_result(payment);
end;
$$;

revoke all on function needs_private.service_listing_snapshot(public.listings),needs_private.service_agreement_context(uuid,uuid,uuid),needs_private.service_payment_result(public.payments) from public,anon,authenticated;
grant execute on function needs_private.service_listing_snapshot(public.listings),needs_private.service_agreement_context(uuid,uuid,uuid),needs_private.service_payment_result(public.payments) to service_role;
revoke all on function public.propose_service_price_agreement(uuid,uuid,uuid,numeric,uuid),public.respond_service_price_agreement(uuid,uuid,text),public.create_agreed_service_payment(uuid,uuid,text),public.retire_service_agreement_payment(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.propose_service_price_agreement(uuid,uuid,uuid,numeric,uuid),public.respond_service_price_agreement(uuid,uuid,text),public.create_agreed_service_payment(uuid,uuid,text),public.retire_service_agreement_payment(uuid,uuid,text) to service_role;

commit;
