-- Request posts keep their publisher in listings.seller_id; financial rows store
-- the actual payer/provider. Deploy this migration before the new application.
-- Preserve historical parties, amounts, milestones and external Stripe objects.
begin;
alter table public.payments add column if not exists chat_id uuid references public.chats(id);
alter table public.payments add column if not exists role_review_required boolean not null default false;
alter table public.milestones add column if not exists chat_id uuid references public.chats(id);
-- Keep historical Stripe destinations intact. Do not capture a legacy request
-- authorization with the old reversed parties; an administrator must reconcile
-- it with Stripe before a correct new agreement can replace it.
update public.payments p set role_review_required = true
  from public.listings l where p.listing_id = l.id and p.status in ('requires_capture','requires_payment_method')
    and l.sub_category in ('Buy','I want')
    and (p.buyer_id <> l.seller_id or p.seller_id = l.seller_id);
drop index if exists public.payments_unique_open_intent;
create unique index payments_unique_open_intent on public.payments(buyer_id,seller_id,listing_id)
  where status in ('requires_capture','requires_payment_method') and milestone_id is null;

create or replace function public.resolve_listing_trade(p_listing_id uuid, p_buyer_id uuid, p_chat_id uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare target public.listings%rowtype; members uuid[]; provider uuid; is_request boolean;
begin
  select * into target from public.listings where id=p_listing_id for update;
  if not found or target.status <> 'active' then raise exception 'Listing not found or unavailable'; end if;
  if not ((target.main_category='Items' and target.sub_category in ('Buy','Sell','Free'))
       or (target.main_category='Services' and target.sub_category in ('I want','I will','I can'))) then
    raise exception 'Invalid listing category';
  end if;
  if target.sub_category='Free' or target.price is null or target.price <= 0
     or target.price::text in ('NaN','Infinity','-Infinity') then raise exception 'This listing does not require a payment'; end if;
  is_request := target.sub_category in ('Buy','I want');
  if p_buyer_id is null then raise exception 'A payer is required'; end if;
  if p_chat_id is not null then
    if not exists (select 1 from public.chats where id=p_chat_id and listing_id=p_listing_id and type='direct') then
      raise exception 'Choose a conversation for this listing';
    end if;
    select array_agg(user_id) into members from public.chat_participants where chat_id=p_chat_id;
    if cardinality(members) is distinct from 2 or not p_buyer_id=any(members) or not target.seller_id=any(members) then
      raise exception 'Invalid transaction participants';
    end if;
  elsif is_request then raise exception 'Choose the provider conversation for this request';
  end if;
  if is_request then
    if p_buyer_id <> target.seller_id then raise exception 'Only the requester can pay the provider'; end if;
    select member into provider from unnest(members) as member where member<>target.seller_id;
  else
    provider := target.seller_id;
    if p_buyer_id=provider then raise exception 'Cannot purchase your own listing'; end if;
  end if;
  return jsonb_build_object('seller_id',provider,'price',target.price);
end;
$$;
revoke all on function public.resolve_listing_trade(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.resolve_listing_trade(uuid,uuid,uuid) to service_role;
grant select on public.chats,public.chat_participants to service_role;
grant select,update on public.listings to service_role;

-- Replace old signatures rather than leave an ambiguous PostgREST overload.
drop function public.create_listing_payment(uuid,uuid,uuid,numeric,numeric,text);
drop function public.create_milestone_payment(uuid,uuid,uuid,text,numeric,numeric,text,uuid);
drop function public.create_milestone_proposal(uuid,uuid,text,numeric);
create or replace function public.create_listing_payment(
  p_listing_id uuid, p_buyer_id uuid, p_seller_id uuid,
  p_amount numeric, p_platform_fee numeric, p_intent_id text, p_chat_id uuid default null
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  listing_price numeric;
  trade jsonb;
  existing public.payments%rowtype;
  payment_id_value uuid;
begin
  trade := public.resolve_listing_trade(p_listing_id,p_buyer_id,p_chat_id);
  listing_price := (trade->>'price')::numeric;
  if p_seller_id is distinct from (trade->>'seller_id')::uuid then raise exception 'Provider does not match the agreement'; end if;
  select * into existing from public.payments where stripe_payment_intent = p_intent_id;
  if found then
    if existing.buyer_id <> p_buyer_id or existing.seller_id <> p_seller_id
       or existing.listing_id <> p_listing_id or existing.amount <> p_amount or existing.milestone_id is not null then
      raise exception 'Intent does not match this listing';
    end if;
    return jsonb_build_object('payment_id', existing.id);
  end if;
  if p_buyer_id = p_seller_id or p_amount <= 0 or p_amount <> listing_price or p_amount is null
     or p_platform_fee < 0 or p_platform_fee > p_amount then
    raise exception 'Invalid listing payment';
  end if;
  insert into public.payments(listing_id,buyer_id,seller_id,amount,platform_fee,stripe_payment_intent,status,currency,chat_id)
    values(p_listing_id,p_buyer_id,p_seller_id,p_amount,p_platform_fee,p_intent_id,'requires_capture','eur',p_chat_id)
    returning id into payment_id_value;
  insert into public.payment_audit_logs(payment_id,action,buyer_id,seller_id,listing_id,amount,platform_fee,metadata)
    values(payment_id_value,'payment_record_created',p_buyer_id,p_seller_id,p_listing_id,p_amount,p_platform_fee,jsonb_build_object('intent_id',p_intent_id));
  return jsonb_build_object('payment_id',payment_id_value);
end;
$$;
revoke all on function public.create_listing_payment(uuid,uuid,uuid,numeric,numeric,text,uuid) from public, anon, authenticated;
grant execute on function public.create_listing_payment(uuid,uuid,uuid,numeric,numeric,text,uuid) to service_role;

create or replace function public.create_milestone_payment(
  p_listing_id uuid, p_buyer_id uuid, p_seller_id uuid, p_title text,
  p_amount numeric, p_platform_fee numeric, p_intent_id text, p_milestone_id uuid default null, p_chat_id uuid default null
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  listing_price numeric;
  trade jsonb;
  existing public.payments%rowtype;
  total numeric;
  milestone_id_value uuid;
  payment_id_value uuid;
  proposal public.milestones%rowtype;
begin
  trade := public.resolve_listing_trade(p_listing_id,p_buyer_id,p_chat_id);
  listing_price := (trade->>'price')::numeric;
  if p_seller_id is distinct from (trade->>'seller_id')::uuid then raise exception 'Provider does not match the agreement'; end if;
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
       or proposal.status not in ('pending', 'failed')
       or (proposal.chat_id is not null and proposal.chat_id is distinct from p_chat_id) then
      raise exception 'Milestone proposal does not match this payment';
    end if;
  else
    select * into proposal from public.milestones where listing_id = p_listing_id and buyer_id = p_buyer_id
      and seller_id = p_seller_id and title = p_title and amount = p_amount
      and (chat_id is null or chat_id = p_chat_id) and stripe_payment_intent is null and status = 'pending' order by created_at, id limit 1 for update;
  end if;
  select coalesce(sum(amount), 0) into total from public.milestones
    where listing_id = p_listing_id and buyer_id = p_buyer_id and seller_id = p_seller_id and status <> 'failed'
      and (proposal.id is null or id <> proposal.id);
  if total + p_amount > listing_price then
    raise exception 'Total milestone amount would exceed listing price';
  end if;
  if proposal.id is null then
    insert into public.milestones(listing_id, buyer_id, seller_id, title, amount, stripe_payment_intent, status, currency, chat_id)
      values(p_listing_id, p_buyer_id, p_seller_id, p_title, p_amount, p_intent_id, 'pending', 'eur', p_chat_id)
      returning id into milestone_id_value;
  else
    milestone_id_value := proposal.id;
    update public.milestones set stripe_payment_intent = p_intent_id, status = 'pending', currency = 'eur', chat_id = coalesce(chat_id,p_chat_id),
      buyer_confirmed = false, seller_confirmed = false where id = proposal.id;
  end if;
  insert into public.payments(listing_id, buyer_id, seller_id, amount, platform_fee, stripe_payment_intent, status, buyer_confirmed, seller_confirmed, milestone_id, currency, chat_id)
    values(p_listing_id, p_buyer_id, p_seller_id, p_amount, p_platform_fee, p_intent_id, 'requires_capture', false, false, milestone_id_value, 'eur', p_chat_id)
    returning id into payment_id_value;
  insert into public.payment_audit_logs(payment_id, buyer_id, seller_id, listing_id, amount, platform_fee, action, metadata)
    values(payment_id_value, p_buyer_id, p_seller_id, p_listing_id, p_amount, p_platform_fee,
      'milestone_payment_created', jsonb_build_object('milestone_id', milestone_id_value, 'intent_id', p_intent_id));
  return jsonb_build_object('payment_id', payment_id_value, 'milestone_id', milestone_id_value);
end;
$$;

create or replace function public.create_milestone_proposal(
  p_listing_id uuid, p_buyer_id uuid, p_title text, p_amount numeric, p_chat_id uuid default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare trade jsonb; provider uuid; total numeric; proposal_id uuid;
begin
  trade := public.resolve_listing_trade(p_listing_id,p_buyer_id,p_chat_id);
  provider := (trade->>'seller_id')::uuid;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2)
     or p_title is null or length(btrim(p_title)) not between 1 and 200 then
    raise exception 'Invalid milestone title or amount';
  end if;
  select coalesce(sum(amount), 0) into total from public.milestones
    where listing_id = p_listing_id and buyer_id = p_buyer_id and seller_id = provider and status <> 'failed';
  if total + p_amount > (trade->>'price')::numeric then raise exception 'Total milestone amount would exceed listing price'; end if;
  insert into public.milestones(listing_id,buyer_id,seller_id,title,amount,currency,chat_id)
    values(p_listing_id,p_buyer_id,provider,btrim(p_title),p_amount,'eur',p_chat_id) returning id into proposal_id;
  return proposal_id;
end;
$$;
revoke all on function public.create_milestone_proposal(uuid,uuid,text,numeric,uuid) from public,anon,authenticated;
grant execute on function public.create_milestone_proposal(uuid,uuid,text,numeric,uuid) to service_role;

revoke all on function public.create_milestone_payment(uuid,uuid,uuid,text,numeric,numeric,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_milestone_payment(uuid,uuid,uuid,text,numeric,numeric,text,uuid,uuid) to service_role;
commit;
