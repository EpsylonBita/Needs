-- Account privacy self-service. These functions are server-only: routes verify
-- the session and recent authentication before exporting or recording a request.
-- A request NEVER deletes an auth user, cascades financial records or asserts a
-- legal retention period. Completion requires the approved retention procedure.
begin;
create schema if not exists needs_private;
revoke all on schema needs_private from public, anon;

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending' check(status in ('pending','reviewing','needs_information','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  response text check(char_length(response) <= 4000)
);
create unique index if not exists account_deletion_one_active on public.account_deletion_requests(user_id) where status <> 'cancelled';
create index if not exists account_deletion_queue on public.account_deletion_requests(created_at,id) where status <> 'cancelled';
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from public, anon, authenticated;
grant select,insert,update on public.account_deletion_requests to service_role;

create or replace function needs_private.account_privacy_blockers(p_user_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with own as(select id from public.profiles where user_id=p_user_id),
  participant_payments as(select p.* from public.payments p where p.buyer_id in(select id from own) or p.seller_id in(select id from own))
  select jsonb_build_object(
    'active_orders',(select count(*) from participant_payments where status not in('completed','refunded','failed','cancelled','canceled')),
    'open_disputes',(select count(*) from public.disputes d where d.payment_id in(select id from participant_payments) and d.status='open'),
    'pending_refunds',(select count(*) from public.transactions t where t.payment_id in(select id from participant_payments) and t.type='refund' and t.status in('pending','requires_action')),
    'active_milestones',(select count(*) from public.milestones m where (m.buyer_id in(select id from own) or m.seller_id in(select id from own)) and m.status not in('completed','failed','refunded','cancelled','canceled')),
    'financial_history',exists(select 1 from participant_payments) or exists(select 1 from public.milestones m where (m.buyer_id in(select id from own) or m.seller_id in(select id from own)) and m.stripe_payment_intent is not null)
  );
$$;

create or replace function public.get_account_deletion_status(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare request_value jsonb;
begin
  if p_user_id is null or not exists(select 1 from auth.users where id=p_user_id) then raise exception 'Account not found' using errcode='42501'; end if;
  select jsonb_build_object('id',id,'status',status,'created_at',created_at,'updated_at',updated_at,'reviewed_at',reviewed_at,'response',response)
    into request_value from public.account_deletion_requests where user_id=p_user_id order by created_at desc,id desc limit 1;
  return jsonb_build_object('request',request_value,'blockers',needs_private.account_privacy_blockers(p_user_id));
end $$;

create or replace function public.request_account_deletion(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_user_id is null or not exists(select 1 from auth.users where id=p_user_id) then raise exception 'Account not found' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  if not exists(select 1 from public.account_deletion_requests where user_id=p_user_id and status <> 'cancelled') then
    insert into public.account_deletion_requests(user_id) values(p_user_id);
  end if;
  return public.get_account_deletion_status(p_user_id);
end $$;

create or replace function public.cancel_account_deletion(p_user_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  update public.account_deletion_requests set status='cancelled',updated_at=now()
    where id=p_request_id and user_id=p_user_id and status <> 'cancelled';
  if not found then raise exception 'Active request not found' using errcode='42501'; end if;
  return public.get_account_deletion_status(p_user_id);
end $$;

create or replace function public.list_account_deletion_requests(p_before_created_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; next_value jsonb; ids uuid[]; last_id uuid;
begin
  if p_limit is null or p_limit not between 1 and 100 or (p_before_created_at is null)<>(p_before_id is null) then raise exception 'Invalid page' using errcode='22023'; end if;
  select array_agg(id order by created_at,id) into ids from(
    select id,created_at from public.account_deletion_requests where status <> 'cancelled'
      and(p_before_id is null or (created_at,id)>(p_before_created_at,p_before_id)) order by created_at,id limit p_limit+1
  ) page;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'user_id',r.user_id,'email',u.email,'status',r.status,
    'created_at',r.created_at,'updated_at',r.updated_at,'response',r.response,'blockers',needs_private.account_privacy_blockers(r.user_id)) order by r.created_at,r.id),'[]'::jsonb)
    into result from public.account_deletion_requests r join auth.users u on u.id=r.user_id where r.id=any(ids[1:p_limit]);
  if cardinality(ids)>p_limit then
    last_id:=ids[p_limit];
    select jsonb_build_object('created_at',created_at,'id',id) into next_value from public.account_deletion_requests where id=last_id;
  end if;
  return jsonb_build_object('rows',result,'next_cursor',next_value);
end $$;

create or replace function public.review_account_deletion_request(p_request_id uuid,p_admin_id uuid,p_status text,p_response text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_user uuid;
begin
  if p_admin_id is null or not exists(select 1 from auth.users where id=p_admin_id) then raise exception 'Reviewer missing' using errcode='42501'; end if;
  if p_status is null or p_status not in('reviewing','needs_information') or p_response is null or char_length(btrim(p_response)) not between 10 and 4000 then
    raise exception 'Choose a review state and write a response' using errcode='22023';
  end if;
  update public.account_deletion_requests set status=p_status,response=btrim(p_response),reviewed_by=p_admin_id,reviewed_at=now(),updated_at=now()
    where id=p_request_id and status <> 'cancelled' returning user_id into target_user;
  if target_user is null then raise exception 'Active request not found' using errcode='42501'; end if;
  return public.get_account_deletion_status(target_user);
end $$;

create or replace function public.export_account_data(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' set statement_timeout='15s' as $$
declare profile_id uuid; result jsonb;
begin
  if p_user_id is null or not exists(select 1 from auth.users where id=p_user_id) then raise exception 'Account not found' using errcode='42501'; end if;
  select id into profile_id from public.profiles where user_id=p_user_id;
  -- Deliberate allowlists: new database columns must never silently enter exports.
  result:=jsonb_build_object(
    'profile',(select jsonb_build_object('id',id,'display_name',display_name,'avatar_url',avatar_url,'cover_image',cover_image,'title',title,'bio',bio,'location',location,'reputation',reputation,'rating_count',rating_count,'created_at',created_at) from public.profiles where id=profile_id),
    'listings',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'title',l.title,'description',l.description,'price',l.price,'main_category',l.main_category,'sub_category',l.sub_category,'status',l.status,'address',l.address,'location_wkb',l.location::text,'contact_number',l.contact_number,'created_at',l.created_at,
      'images',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'url',i.url,'main',i.main)) from public.listing_images i where i.listing_id=l.id),'[]'::jsonb),
      'tags',coalesce((select jsonb_agg(t.tag) from public.listing_tags t where t.listing_id=l.id),'[]'::jsonb)) order by l.created_at,l.id) from public.listings l where l.seller_id=profile_id),'[]'::jsonb),
    'sent_messages',coalesce((select jsonb_agg(jsonb_build_object('id',id,'chat_id',chat_id,'content',content,'attachments',attachments,'reply_to',reply_to,'created_at',created_at) order by created_at,id) from public.messages where sender_id=profile_id),'[]'::jsonb),
    'chat_memberships',coalesce((select jsonb_agg(jsonb_build_object('chat_id',chat_id,'last_read_at',last_read_at,'left_at',left_at)) from public.chat_participants where user_id=profile_id),'[]'::jsonb),
    'notifications',coalesce((select jsonb_agg(jsonb_build_object('id',id,'type',type,'payload',payload,'read',read,'created_at',created_at) order by created_at,id) from public.notifications where user_id=profile_id),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'listing_id',p.listing_id,'role',case when p.buyer_id=profile_id then 'buyer' else 'seller' end,'amount',p.amount,'platform_fee',p.platform_fee,'currency',p.currency,'status',p.status,'created_at',p.created_at,'completed_at',p.completed_at,
      'transactions',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'type',t.type,'amount',t.amount,'status',t.status,'created_at',t.created_at)) from public.transactions t where t.payment_id=p.id),'[]'::jsonb),
      'disputes',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'status',d.status,'created_at',d.created_at,'reason',case when p.buyer_id=profile_id and d.stripe_dispute_id is null then d.reason else null end)) from public.disputes d where d.payment_id=p.id),'[]'::jsonb)) order by p.created_at,p.id) from public.payments p where p.buyer_id=profile_id or p.seller_id=profile_id),'[]'::jsonb),
    'milestones',coalesce((select jsonb_agg(jsonb_build_object('id',id,'listing_id',listing_id,'title',title,'amount',amount,'status',status,'created_at',created_at)) from public.milestones where buyer_id=profile_id or seller_id=profile_id),'[]'::jsonb),
    'authored_reviews',coalesce((select jsonb_agg(jsonb_build_object('id',id,'listing_id',listing_id,'rating',rating,'comment',comment,'created_at',created_at)) from public.reviews where reviewer_id=profile_id),'[]'::jsonb),
    'deletion_requests',coalesce((select jsonb_agg(jsonb_build_object('id',id,'status',status,'created_at',created_at,'updated_at',updated_at,'response',response)) from public.account_deletion_requests where user_id=p_user_id),'[]'::jsonb)
  );
  if octet_length(result::text)>8388608 then raise exception 'Export requires assisted delivery' using errcode='54000'; end if;
  return result;
end $$;

revoke all on function needs_private.account_privacy_blockers(uuid) from public,anon,authenticated;
revoke all on function public.get_account_deletion_status(uuid),public.request_account_deletion(uuid),public.cancel_account_deletion(uuid,uuid),public.list_account_deletion_requests(timestamptz,uuid,integer),public.review_account_deletion_request(uuid,uuid,text,text),public.export_account_data(uuid) from public,anon,authenticated;
grant execute on function public.get_account_deletion_status(uuid),public.request_account_deletion(uuid),public.cancel_account_deletion(uuid,uuid),public.list_account_deletion_requests(timestamptz,uuid,integer),public.review_account_deletion_request(uuid,uuid,text,text),public.export_account_data(uuid) to service_role;
commit;
