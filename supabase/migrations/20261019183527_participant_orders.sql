-- My Orders is a participant projection of real payments, including funded
-- milestones. It does not create orders from conversations or free listings.
begin;
create schema if not exists needs_private;
revoke all on schema needs_private from public, anon;

alter table public.payments add column if not exists capture_claim_id uuid;
alter table public.payments add column if not exists capture_claimed_at timestamptz;
create index if not exists payments_buyer_order_cursor on public.payments(buyer_id,(coalesce(created_at,'epoch'::timestamptz)) desc,id desc);
create index if not exists payments_seller_order_cursor on public.payments(seller_id,(coalesce(created_at,'epoch'::timestamptz)) desc,id desc);
create index if not exists payment_authorization_evidence on public.payment_audit_logs(payment_id)
  where action='payment_authorized';
create index if not exists disputes_payment_state on public.disputes(payment_id,status);

create or replace function needs_private.order_profile(p_user_id uuid)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare result uuid;
begin
  if p_user_id is null then raise exception 'Sign in to view your orders' using errcode='42501'; end if;
  select id into result from public.profiles where user_id=p_user_id;
  if result is null then raise exception 'Profile not found' using errcode='42501'; end if;
  return result;
end $$;

create or replace function needs_private.order_json(p_payment_id uuid,p_profile_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  payment public.payments%rowtype; milestone public.milestones%rowtype;
  buyer_done boolean; seller_done boolean; authorized boolean; open_dispute boolean;
  pending_capture boolean; complaint jsonb; review_value jsonb; safe_chat uuid;
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
    'authorization_state',case when payment.status in('completed','refunded','disputed') then 'settled'
      when payment.status='requires_capture' and authorized then 'authorized' else 'unverified' end,
    'capture_pending',pending_capture,'complaint',complaint,
    'disputes',coalesce((select jsonb_agg(jsonb_build_object('id',id,'status',status,'is_bank_dispute',stripe_dispute_id is not null,
      'created_at',coalesce(created_at,'epoch'::timestamptz),'resolved_at',resolved_at) order by created_at,id) from public.disputes where payment_id=payment.id),'[]'::jsonb),
    'refund',(select jsonb_build_object('succeeded_amount',coalesce(sum(amount) filter(where status='succeeded'),0),
      'pending_amount',coalesce(sum(amount) filter(where status in('pending','requires_action')),0),
      'failed',coalesce(bool_or(status in('failed','canceled')),false)) from public.transactions where payment_id=payment.id and type='refund'),
    'review',review_value,
    'actions',jsonb_build_object(
      'can_confirm',payment.status='requires_capture' and authorized and not payment.role_review_required and not open_dispute and not pending_capture
        and not(case when p_profile_id=payment.buyer_id then buyer_done else seller_done end),
      'can_capture',payment.status='requires_capture' and authorized and not payment.role_review_required and not open_dispute and buyer_done and seller_done,
      'can_complain',p_profile_id=payment.buyer_id and (payment.status='completed' or(payment.status='requires_capture' and authorized)) and not open_dispute and not pending_capture,
      'can_review',p_profile_id=payment.buyer_id and payment.status='completed' and not payment.role_review_required and review_value is null));
end $$;

create or replace function public.get_my_order(p_payment_id uuid,p_expected_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or p_expected_user_id is distinct from auth.uid() then
    raise exception 'Your account changed. Refresh and try again' using errcode='42501';
  end if;
  return needs_private.order_json(p_payment_id,needs_private.order_profile(p_expected_user_id));
end $$;

create or replace function public.get_my_orders(p_expected_user_id uuid,p_before_created_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare profile_id uuid; selected_ids uuid[]; rows_value jsonb; cursor_value jsonb; last_id uuid;
begin
  if auth.uid() is null or p_expected_user_id is distinct from auth.uid() then
    raise exception 'Your account changed. Refresh and try again' using errcode='42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or (p_before_created_at is null)<>(p_before_id is null) then
    raise exception 'Invalid orders page' using errcode='22023';
  end if;
  profile_id:=needs_private.order_profile(p_expected_user_id);
  select array_agg(id order by ordered_at desc,id desc) into selected_ids from(
    select id,coalesce(created_at,'epoch'::timestamptz) ordered_at from public.payments
    where (buyer_id=profile_id or seller_id=profile_id)
      and(p_before_id is null or (coalesce(created_at,'epoch'::timestamptz),id)<(p_before_created_at,p_before_id))
    order by coalesce(created_at,'epoch'::timestamptz) desc,id desc limit p_limit+1
  ) page;
  select coalesce(jsonb_agg(needs_private.order_json(id,profile_id) order by ordinal),'[]'::jsonb) into rows_value
    from unnest(selected_ids[1:p_limit]) with ordinality ids(id,ordinal);
  if cardinality(selected_ids)>p_limit then
    last_id:=selected_ids[p_limit];
    select jsonb_build_object('created_at',coalesce(created_at,'epoch'::timestamptz),'id',id) into cursor_value from public.payments where id=last_id;
  end if;
  return jsonb_build_object('profile_id',profile_id,'payments_enabled',coalesce((select enabled from public.feature_flags where key='payments_enabled'),false),
    'rows',rows_value,'next_cursor',cursor_value);
end $$;

-- Server routes authenticate the expected account and gate new money actions
-- with the effective environment OR database flag before invoking these RPCs.
create or replace function public.confirm_order(p_payment_id uuid,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare profile_id uuid; payment public.payments%rowtype; view_value jsonb;
begin
  profile_id:=needs_private.order_profile(p_user_id);
  select * into payment from public.payments where id=p_payment_id for update;
  if not found or profile_id not in(payment.buyer_id,payment.seller_id) then raise exception 'Order not found' using errcode='42501'; end if;
  view_value:=needs_private.order_json(payment.id,profile_id);
  if payment.status<>'requires_capture' or payment.role_review_required or view_value->>'authorization_state'<>'authorized'
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
  if payment.capture_claim_id is null then
    view_value:=needs_private.order_json(payment.id,profile_id);
    if not(view_value->'actions'->>'can_capture')::boolean then raise exception 'Both parties must confirm an authorized order without an open dispute' using errcode='23514'; end if;
    update public.payments set capture_claim_id=gen_random_uuid(),capture_claimed_at=clock_timestamp() where id=payment.id returning * into payment;
  end if;
  return jsonb_build_object('payment_id',payment.id,'intent_id',payment.stripe_payment_intent,'claim_id',payment.capture_claim_id,'status','claimed');
end $$;

create or replace function public.resolve_order_capture(p_payment_id uuid,p_claim_id uuid,p_outcome text)
returns void language plpgsql security definer set search_path='' as $$
declare payment public.payments%rowtype;
begin
  if p_outcome not in('captured','not_captured') or p_outcome is null then raise exception 'Unknown capture outcome' using errcode='22023'; end if;
  select * into payment from public.payments where id=p_payment_id for update;
  if not found or p_claim_id is null or payment.capture_claim_id is distinct from p_claim_id then raise exception 'Capture claim does not match' using errcode='23514'; end if;
  -- Captured keeps the reservation until the webhook supplies financial truth.
  -- Only an irreversible provider cancellation proves not_captured is safe.
  -- Never release on a timeout, a mutable pre-confirmation state, or an unknown result.
  if p_outcome='not_captured' then
    update public.payments set capture_claim_id=null,capture_claimed_at=null where id=payment.id;
  end if;
end $$;

-- Preserve complaint history/notifications. Serialize new complaints and capture
-- reservation through the same payment row lock, so neither can pass the other.
create or replace function public.open_payment_complaint(p_payment_id uuid,p_buyer_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payment public.payments%rowtype; complaint_id uuid;
begin
  select * into payment from public.payments where id=p_payment_id for update;
  if not found or payment.buyer_id<>p_buyer_id then raise exception 'Payment not owned by buyer'; end if;
  if payment.status not in('requires_capture','completed') then raise exception 'Payment cannot accept a complaint'; end if;
  select id into complaint_id from public.disputes where payment_id=p_payment_id and stripe_dispute_id is null and status='open' order by created_at,id limit 1;
  if complaint_id is not null then return jsonb_build_object('dispute_id',complaint_id,'duplicate',true); end if;
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

-- Existing browser clients can still confirm their own side, but cannot undo
-- confirmation, confirm an unfunded/held/disputed order, or touch other columns.
-- current_setting('role') is the invoking database role even in this definer
-- trigger; JWT clients cannot SET ROLE to a privileged database role.
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
  if payment.status<>'requires_capture' or payment.role_review_required or payment.capture_claim_id is not null
    or not exists(select 1 from public.payment_audit_logs where payment_id=payment.id and action='payment_authorized')
    or exists(select 1 from public.disputes where payment_id=payment.id and status='open') then
    raise exception 'This order cannot be confirmed in its current state' using errcode='23514';
  end if;
  return new;
end $$;

revoke all on function needs_private.order_profile(uuid),needs_private.order_json(uuid,uuid) from public,anon,authenticated;
revoke all on function public.get_my_order(uuid,uuid),public.get_my_orders(uuid,timestamptz,uuid,integer) from public,anon,authenticated;
grant execute on function public.get_my_order(uuid,uuid),public.get_my_orders(uuid,timestamptz,uuid,integer) to authenticated;
revoke all on function public.confirm_order(uuid,uuid),public.claim_order_capture(uuid,uuid),public.resolve_order_capture(uuid,uuid,text),public.open_payment_complaint(uuid,uuid),public.guard_payment_confirmation() from public,anon,authenticated;
grant execute on function public.confirm_order(uuid,uuid),public.claim_order_capture(uuid,uuid),public.resolve_order_capture(uuid,uuid,text),public.open_payment_complaint(uuid,uuid) to service_role;
commit;
