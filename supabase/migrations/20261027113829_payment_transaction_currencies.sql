begin;

-- Charges/refunds use the original payment's units. A destination transfer can
-- settle in another currency: only its exact persisted Stripe event is evidence.
-- No amount, fee or status is changed by this migration.
alter table public.transactions add column if not exists currency text
  check (currency is null or currency ~ '^[a-z]{3}$');

create or replace function needs_private.set_transaction_currency()
returns trigger language plpgsql security definer set search_path='' as $$
declare resolved_currency text;
begin
  if new.type in ('charge','refund') then
    select lower(p.currency) into resolved_currency from public.payments p where p.id=new.payment_id;
  elsif new.type='transfer' then
    select e.payload#>>'{data,object,currency}' into resolved_currency
      from public.webhook_events e join public.payments p on p.id=new.payment_id
      where e.id=new.metadata->>'stripe_event_id' and e.source='stripe'
        and e.event_type in ('transfer.created','transfer.failed')
        and e.payload->>'id'=e.id and e.payload->>'type'=e.event_type
        and e.payload#>>'{data,object,id}'=coalesce(nullif(new.metadata->>'stripe_object_id',''),nullif(new.metadata->>'stripe_transfer_id',''))
        and e.payload#>>'{data,object,id}' like 'tr_%'
        and new.metadata->>'stripe_payment_intent_id'=p.stripe_payment_intent
        and case when jsonb_typeof(e.payload#>'{data,object,amount}')='number'
          then (e.payload#>>'{data,object,amount}')::numeric else null end=new.amount*100;
  end if;
  new.currency:=case when resolved_currency ~ '^[a-z]{3}$' then resolved_currency else null end;
  return new;
end $$;
revoke all on function needs_private.set_transaction_currency() from public,anon,authenticated,service_role;

drop trigger if exists set_transaction_currency on public.transactions;
create trigger set_transaction_currency before insert or update of payment_id,type,amount,metadata,currency on public.transactions
  for each row execute function needs_private.set_transaction_currency();

-- Run the same evidence check for legacy rows. Missing/mismatched transfer
-- evidence deliberately remains NULL instead of inheriting the payment currency.
update public.transactions set currency=null where currency is null;
comment on column public.transactions.currency is 'Currency of this transaction amount; NULL when legacy transfer evidence is unavailable. Never infer a transfer currency from its parent payment.';

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
      'transactions',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'type',t.type,'amount',t.amount,'currency',t.currency,'status',t.status,'created_at',t.created_at)) from public.transactions t where t.payment_id=p.id),'[]'::jsonb),
      'disputes',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'status',d.status,'created_at',d.created_at,'reason',case when p.buyer_id=profile_id and d.stripe_dispute_id is null then d.reason else null end)) from public.disputes d where d.payment_id=p.id),'[]'::jsonb)) order by p.created_at,p.id) from public.payments p where p.buyer_id=profile_id or p.seller_id=profile_id),'[]'::jsonb),
    'milestones',coalesce((select jsonb_agg(jsonb_build_object('id',id,'listing_id',listing_id,'title',title,'amount',amount,'status',status,'created_at',created_at)) from public.milestones where buyer_id=profile_id or seller_id=profile_id),'[]'::jsonb),
    'authored_reviews',coalesce((select jsonb_agg(jsonb_build_object('id',id,'listing_id',listing_id,'rating',rating,'comment',comment,'created_at',created_at)) from public.reviews where reviewer_id=profile_id),'[]'::jsonb),
    'deletion_requests',coalesce((select jsonb_agg(jsonb_build_object('id',id,'status',status,'created_at',created_at,'updated_at',updated_at,'response',response)) from public.account_deletion_requests where user_id=p_user_id),'[]'::jsonb)
  );
  if octet_length(result::text)>8388608 then raise exception 'Export requires assisted delivery' using errcode='54000'; end if;
  return result;
end $$;
revoke all on function public.export_account_data(uuid) from public,anon,authenticated;
grant execute on function public.export_account_data(uuid) to service_role;
commit;
