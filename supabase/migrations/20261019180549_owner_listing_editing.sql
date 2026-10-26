-- Owner editing: explicit account binding, atomic metadata/tags, retained trade terms.
-- Deploy before the owner preview/edit/image pages. Existing history is never rewritten.
begin;

create or replace function needs_private.listing_edit_flags(p_listing_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare has_history boolean; locked_price boolean; has_orders boolean := false;
begin
  select exists(select 1 from public.payments where listing_id=p_listing_id)
    or exists(select 1 from public.milestones where listing_id=p_listing_id)
    or exists(select 1 from public.reviews where listing_id=p_listing_id) into has_history;
  if to_regclass('public.orders') is not null then
    execute 'select exists(select 1 from public.orders where listing_id=$1)' into has_orders using p_listing_id;
  end if;
  select exists(select 1 from public.payments where listing_id=p_listing_id and status in ('requires_capture','requires_payment_method'))
    or exists(select 1 from public.milestones where listing_id=p_listing_id and status <> 'failed') into locked_price;
  return jsonb_build_object('category_locked',has_history or has_orders,'price_locked',locked_price);
end;
$$;
revoke all on function needs_private.listing_edit_flags(uuid) from public,anon,authenticated;

create or replace function public.protect_listing_trade_terms()
returns trigger language plpgsql security definer set search_path = '' as $$
declare flags jsonb;
begin
  if tg_op='UPDATE' and new.price is not distinct from old.price
    and new.main_category is not distinct from old.main_category and new.sub_category is not distinct from old.sub_category then return new; end if;
  if not ((new.main_category='Items' and new.sub_category in ('Buy','Sell','Free'))
    or (new.main_category='Services' and new.sub_category in ('I want','I will','I can'))) then
    raise exception 'Choose a valid category and subcategory' using errcode='22023';
  end if;
  if new.price is null or new.price < 0 or new.price::text in ('NaN','Infinity','-Infinity')
    or (new.sub_category='Free' and new.price <> 0) then
    raise exception 'Choose a valid price; free listings must have a zero price' using errcode='22023';
  end if;
  if tg_op='UPDATE' then
    -- UPDATE already owns the listing row lock. The payment/proposal RPCs take
    -- that same lock before inserting history, so either ordering rechecks terms.
    flags := needs_private.listing_edit_flags(old.id);
    if (flags->>'category_locked')::boolean and
      (new.main_category is distinct from old.main_category or new.sub_category is distinct from old.sub_category
       or (new.price=0) is distinct from (old.price=0)) then
      raise exception 'This listing has transaction or review history. Keep its category and free/paid type, or create a new listing.' using errcode='23514';
    end if;
    if (flags->>'price_locked')::boolean and new.price is distinct from old.price then
      raise exception 'This listing has an open payment or milestone agreement. Its agreed price cannot change.' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.protect_listing_trade_terms() from public,anon,authenticated;
drop trigger if exists protect_listing_trade_terms on public.listings;
create trigger protect_listing_trade_terms before insert or update on public.listings
  for each row execute function public.protect_listing_trade_terms();

create or replace function needs_private.listing_owner_identity(p_expected_user_id uuid)
returns uuid language plpgsql stable security invoker set search_path = '' as $$
declare profile_id uuid;
begin
  if p_expected_user_id is null or auth.uid() is distinct from p_expected_user_id then
    raise exception 'Your account changed. Reload your listings and try again.' using errcode='42501';
  end if;
  select id into profile_id from public.profiles where user_id=auth.uid();
  if profile_id is null then raise exception 'Complete your profile before managing listings' using errcode='42501'; end if;
  return profile_id;
end;
$$;
create or replace function needs_private.lock_owned_listing(p_listing_id uuid,p_expected_user_id uuid,p_images boolean default false)
returns public.listings language plpgsql security invoker set search_path = '' as $$
declare owner_id uuid := needs_private.listing_owner_identity(p_expected_user_id); target public.listings;
begin
  select * into target from public.listings where id=p_listing_id and seller_id=owner_id for update;
  if not found then raise exception 'Listing not found or you do not own it' using errcode='42501'; end if;
  if p_images and target.moderation_suspended then
    raise exception 'Images cannot change while this listing is held for moderation' using errcode='42501';
  end if;
  return target;
end;
$$;
revoke all on function needs_private.listing_owner_identity(uuid),needs_private.lock_owned_listing(uuid,uuid,boolean) from public,anon;
grant execute on function needs_private.listing_owner_identity(uuid),needs_private.lock_owned_listing(uuid,uuid,boolean) to authenticated;

create or replace function needs_private.owned_listing_json(p_listing public.listings)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',p_listing.id,'seller_id',p_listing.seller_id,'title',p_listing.title,'description',p_listing.description,
    'price',p_listing.price,'main_category',p_listing.main_category,'sub_category',p_listing.sub_category,
    'status',p_listing.status,'owner_status',p_listing.owner_status,'moderation_suspended',p_listing.moderation_suspended,
    'created_at',p_listing.created_at,'address',p_listing.address,'contact_number',p_listing.contact_number,
    'coordinates',case when p_listing.location is null or public.st_isempty(p_listing.location::public.geometry) then null
      else jsonb_build_array(public.st_x(p_listing.location::public.geometry),public.st_y(p_listing.location::public.geometry)) end,
    'tags',coalesce((select jsonb_agg(tag order by tag) from (select distinct tag from public.listing_tags where listing_id=p_listing.id) t),'[]'::jsonb),
    'images',coalesce((select jsonb_agg(jsonb_build_object('id',id,'url',url,'main',coalesce(main,false),'storage_path',storage_path) order by main desc nulls last,id)
      from public.listing_images where listing_id=p_listing.id),'[]'::jsonb),'can_edit',true,'can_edit_images',not p_listing.moderation_suspended)
    || needs_private.listing_edit_flags(p_listing.id);
$$;
revoke all on function needs_private.owned_listing_json(public.listings) from public,anon,authenticated;

create or replace function public.get_my_listing(p_listing_id uuid,p_expected_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare owner_id uuid := needs_private.listing_owner_identity(p_expected_user_id); target public.listings;
begin
  select * into target from public.listings where id=p_listing_id and seller_id=owner_id;
  if not found then raise exception 'Listing not found or you do not own it' using errcode='42501'; end if;
  return needs_private.owned_listing_json(target);
end;
$$;
create or replace function public.get_my_listings(p_expected_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare owner_id uuid := needs_private.listing_owner_identity(p_expected_user_id);
begin
  return coalesce((select jsonb_agg(needs_private.owned_listing_json(l) order by l.created_at desc,l.id)
    from public.listings l where l.seller_id=owner_id),'[]'::jsonb);
end;
$$;

create or replace function public.update_my_listing(p_listing_id uuid,p_expected_user_id uuid,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare target public.listings; input_title text; input_description text; input_price numeric; input_tags text[];
  input_main text; input_sub text; input_contact text; coords jsonb; lng double precision; lat double precision;
begin
  target := needs_private.lock_owned_listing(p_listing_id,p_expected_user_id);
  if p_input is null or jsonb_typeof(p_input)<>'object' or exists(select 1 from jsonb_object_keys(p_input) k where k not in
    ('title','description','price','main_category','sub_category','address','coordinates','contact_number','tags')) then
    raise exception 'Unsupported listing fields' using errcode='22023';
  end if;
  if jsonb_typeof(p_input->'title') is distinct from 'string' or jsonb_typeof(p_input->'description') is distinct from 'string'
    or jsonb_typeof(p_input->'main_category') is distinct from 'string' or jsonb_typeof(p_input->'sub_category') is distinct from 'string'
    or jsonb_typeof(p_input->'price') is distinct from 'number' then raise exception 'Complete the required listing fields' using errcode='22023'; end if;
  input_title := btrim(p_input->>'title'); input_description := btrim(p_input->>'description'); input_price := (p_input->>'price')::numeric;
  input_main := p_input->>'main_category'; input_sub := p_input->>'sub_category'; input_contact := nullif(btrim(p_input->>'contact_number'),'');
  if char_length(input_title) not between 3 and 200 or char_length(input_description) not between 10 and 10000 then
    raise exception 'Use a title of 3–200 characters and a description of 10–10000 characters' using errcode='22023';
  end if;
  if input_price < 0 or input_price > 9999999999.99 or input_price <> round(input_price,2) or input_price::text in ('NaN','Infinity','-Infinity') then
    raise exception 'Enter a non-negative price with up to two decimal places' using errcode='22023';
  end if;
  if (p_input ? 'contact_number' and jsonb_typeof(p_input->'contact_number') not in ('string','null')) or char_length(input_contact)>50 then
    raise exception 'Contact number must contain at most 50 characters' using errcode='22023';
  end if;
  if p_input ? 'address' and jsonb_typeof(p_input->'address') not in ('object','null') then raise exception 'Address must be an object or empty' using errcode='22023'; end if;
  if p_input ? 'tags' and jsonb_typeof(p_input->'tags') <> 'array' then raise exception 'Tags must be an array' using errcode='22023'; end if;
  if jsonb_array_length(coalesce(p_input->'tags','[]'::jsonb))>20 or exists(select 1 from jsonb_array_elements(coalesce(p_input->'tags','[]'::jsonb)) tag
    where jsonb_typeof(tag)<>'string' or char_length(btrim(tag #>> '{}')) not between 1 and 50) then
    raise exception 'Use at most 20 tags, each between 1 and 50 characters' using errcode='22023';
  end if;
  select coalesce(array_agg(distinct btrim(tag)),'{}'::text[]) into input_tags from jsonb_array_elements_text(coalesce(p_input->'tags','[]'::jsonb)) tag;
  coords := p_input->'coordinates';
  if coords is not null and coords <> 'null'::jsonb then
    if jsonb_typeof(coords)<>'array' then raise exception 'Choose valid map coordinates' using errcode='22023'; end if;
    if jsonb_array_length(coords)<>2 or jsonb_typeof(coords->0)<>'number' or jsonb_typeof(coords->1)<>'number' then raise exception 'Choose valid map coordinates' using errcode='22023'; end if;
    lng := (coords->>0)::double precision; lat := (coords->>1)::double precision;
    if lng not between -180 and 180 or lat not between -90 and 90 then raise exception 'Choose valid map coordinates' using errcode='22023'; end if;
  end if;
  update public.listings set title=input_title,description=input_description,price=input_price,main_category=input_main,sub_category=input_sub,
    address=case when p_input ? 'address' then nullif(p_input->'address','null'::jsonb) else target.address end,
    location=case when lng is null then target.location else ('SRID=4326;POINT('||lng::text||' '||lat::text||')')::public.geography end,
    contact_number=input_contact where id=p_listing_id;
  delete from public.listing_tags where listing_id=p_listing_id;
  insert into public.listing_tags(listing_id,tag) select p_listing_id,unnest(input_tags);
  return public.get_my_listing(p_listing_id,p_expected_user_id);
end;
$$;

create or replace function public.update_my_listing_status(p_listing_id uuid,p_status text,p_expected_user_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare target public.listings;
begin
  target := needs_private.lock_owned_listing(p_listing_id,p_expected_user_id);
  if p_status is null or p_status not in ('active','sold','suspended') then raise exception 'Invalid listing status' using errcode='22023'; end if;
  if target.moderation_suspended then raise exception 'An administrator must release this listing before its status can change' using errcode='42501'; end if;
  update public.listings set status=p_status where id=p_listing_id;
  return public.get_my_listing(p_listing_id,p_expected_user_id);
end;
$$;
create or replace function public.delete_my_listing(p_listing_id uuid,p_expected_user_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform needs_private.lock_owned_listing(p_listing_id,p_expected_user_id);
  delete from public.listings where id=p_listing_id;
  return jsonb_build_object('id',p_listing_id);
end;
$$;

-- Images under administrative review must remain unchanged, including direct
-- metadata and Storage API requests that do not use our owner-edit RPCs.
drop policy if exists listing_images_edit_guard on public.listing_images;
create policy listing_images_edit_guard on public.listing_images as restrictive for all to authenticated
  using (exists(select 1 from public.listings l where l.id=listing_id))
  with check (exists(select 1 from public.listings l join public.profiles p on p.id=l.seller_id
    where l.id=listing_id and p.user_id=(select auth.uid()) and not l.moderation_suspended));
drop policy if exists listing_images_delete_hold_guard on public.listing_images;
create policy listing_images_delete_hold_guard on public.listing_images as restrictive for delete to authenticated
  using (exists(select 1 from public.listings l where l.id=listing_id and not l.moderation_suspended));
drop policy if exists listing_images_update_hold_guard on public.listing_images;
create policy listing_images_update_hold_guard on public.listing_images as restrictive for update to authenticated
  using (exists(select 1 from public.listings l where l.id=listing_id and not l.moderation_suspended));

create or replace function needs_private.can_write_listing_storage(p_name text,p_allow_orphan boolean default false)
returns boolean language sql stable security invoker set search_path = '' as $$
  select split_part(p_name,'/',1)=(select auth.uid())::text and (
    exists(select 1 from public.listings l join public.profiles p on p.id=l.seller_id
      where l.id::text=split_part(p_name,'/',2) and p.user_id=(select auth.uid()) and not l.moderation_suspended)
    or (p_allow_orphan and not exists(select 1 from public.listings l where l.id::text=split_part(p_name,'/',2))));
$$;
revoke all on function needs_private.can_write_listing_storage(text,boolean) from public,anon;
grant execute on function needs_private.can_write_listing_storage(text,boolean) to authenticated;
drop policy if exists listing_image_storage_insert_guard on storage.objects;
create policy listing_image_storage_insert_guard on storage.objects as restrictive for insert to authenticated
  with check(bucket_id<>'listing-images' or needs_private.can_write_listing_storage(name,false));
drop policy if exists listing_image_storage_update_guard on storage.objects;
create policy listing_image_storage_update_guard on storage.objects as restrictive for update to authenticated
  using(bucket_id<>'listing-images' or needs_private.can_write_listing_storage(name,false))
  with check(bucket_id<>'listing-images' or needs_private.can_write_listing_storage(name,false));
drop policy if exists listing_image_storage_delete_guard on storage.objects;
create policy listing_image_storage_delete_guard on storage.objects as restrictive for delete to authenticated
  using(bucket_id<>'listing-images' or needs_private.can_write_listing_storage(name,true));
update storage.buckets set file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp','image/gif']
  where id='listing-images';

create or replace function public.attach_listing_images(p_listing_id uuid,p_images jsonb,p_expected_user_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare image jsonb; path text; image_url text;
begin
  perform needs_private.lock_owned_listing(p_listing_id,p_expected_user_id,true);
  if p_images is null or jsonb_typeof(p_images)<>'array' then raise exception 'Images must be an array' using errcode='22023'; end if;
  if jsonb_array_length(p_images) not between 1 and 20 then raise exception 'Choose between 1 and 20 images per upload' using errcode='22023'; end if;
  for image in select value from jsonb_array_elements(p_images) loop
    path := image->>'storage_path'; image_url := image->>'url';
    if path is null or image_url is null or path !~ ('^'||auth.uid()::text||'/'||p_listing_id::text||'/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|gif)$')
      or image_url !~ '^https?://[^/?#]+/storage/v1/object/public/listing-images/'
      or right(image_url,length('/storage/v1/object/public/listing-images/'||path)) <> '/storage/v1/object/public/listing-images/'||path then
      raise exception 'Image path does not belong to this listing' using errcode='42501';
    end if;
    if not exists(select 1 from storage.objects where bucket_id='listing-images' and name=path) then raise exception 'Upload the image before attaching it' using errcode='22023'; end if;
    if not exists(select 1 from public.listing_images where listing_id=p_listing_id and storage_path=path) then
      insert into public.listing_images(listing_id,url,storage_path,main)
        values(p_listing_id,image_url,path,not exists(select 1 from public.listing_images where listing_id=p_listing_id and main));
    end if;
  end loop;
  return public.get_my_listing(p_listing_id,p_expected_user_id)->'images';
end;
$$;
create or replace function public.set_main_listing_image(p_listing_id uuid,p_image_id uuid,p_expected_user_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform needs_private.lock_owned_listing(p_listing_id,p_expected_user_id,true);
  if not exists(select 1 from public.listing_images where id=p_image_id and listing_id=p_listing_id) then raise exception 'Image does not belong to this listing' using errcode='42501'; end if;
  update public.listing_images set main=false where listing_id=p_listing_id and main;
  update public.listing_images set main=true where id=p_image_id and listing_id=p_listing_id;
  return public.get_my_listing(p_listing_id,p_expected_user_id)->'images';
end;
$$;
create or replace function public.delete_listing_image(p_listing_id uuid,p_image_id uuid,p_expected_user_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare target public.listing_images;
begin
  perform needs_private.lock_owned_listing(p_listing_id,p_expected_user_id,true);
  select * into target from public.listing_images where id=p_image_id and listing_id=p_listing_id;
  if not found then return jsonb_build_object('id',p_image_id,'storage_path',null); end if;
  delete from public.listing_images where id=p_image_id and listing_id=p_listing_id;
  if target.main then
    update public.listing_images set main=true where id=(select id from public.listing_images where listing_id=p_listing_id order by id limit 1);
  end if;
  return jsonb_build_object('id',p_image_id,'storage_path',target.storage_path);
end;
$$;

revoke all on function public.get_my_listing(uuid,uuid),public.get_my_listings(uuid),public.update_my_listing(uuid,uuid,jsonb),
  public.update_my_listing_status(uuid,text,uuid),public.delete_my_listing(uuid,uuid),public.attach_listing_images(uuid,jsonb,uuid),
  public.set_main_listing_image(uuid,uuid,uuid),public.delete_listing_image(uuid,uuid,uuid) from public,anon;
grant execute on function public.get_my_listing(uuid,uuid),public.get_my_listings(uuid),public.update_my_listing(uuid,uuid,jsonb),
  public.update_my_listing_status(uuid,text,uuid),public.delete_my_listing(uuid,uuid),public.attach_listing_images(uuid,jsonb,uuid),
  public.set_main_listing_image(uuid,uuid,uuid),public.delete_listing_image(uuid,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
