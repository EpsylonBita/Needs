-- Legacy baseline: supabase/sql/001..029 (and the preceding payment repair).
-- Apply as the database owner. No application data or external files are deleted.

alter table public.chats add column if not exists listing_id uuid references public.listings(id) on delete set null;
alter table public.chats add column if not exists direct_key text;
create unique index if not exists chats_direct_key_unique on public.chats(direct_key) where direct_key is not null;

alter table public.chats enable row level security;
alter table public.chat_participants enable row level security;
drop policy if exists chats_select on public.chats;
drop policy if exists chats_insert on public.chats;
drop policy if exists chats_update on public.chats;
drop policy if exists chats_delete on public.chats;
drop policy if exists chat_participants_insert on public.chat_participants;

create policy chats_select on public.chats for select to authenticated using (
  exists (select 1 from public.chat_participants cp join public.profiles p on p.id = cp.user_id
          where cp.chat_id = chats.id and p.user_id = (select auth.uid()))
);
create policy chats_update on public.chats for update to authenticated using (
  exists (select 1 from public.chat_participants cp join public.profiles p on p.id = cp.user_id
          where cp.chat_id = chats.id and p.user_id = (select auth.uid()))
) with check (
  exists (select 1 from public.chat_participants cp join public.profiles p on p.id = cp.user_id
          where cp.chat_id = chats.id and p.user_id = (select auth.uid()))
);

-- Membership and routing keys are created only through the authorized RPC.
-- In particular, a user must not be able to join an arbitrary known chat ID.
revoke all on public.chats from anon, authenticated;
grant select on public.chats to authenticated;
grant update(title) on public.chats to authenticated;
revoke all on public.chat_participants from anon, authenticated;
grant select on public.chat_participants to authenticated;

create schema if not exists needs_private;
revoke all on schema needs_private from public, anon;
grant usage on schema needs_private to authenticated;

create or replace function needs_private.get_or_create_direct_chat(
  p_other_profile_id uuid default null,
  p_listing_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  caller_profile uuid;
  other_profile uuid;
  chat_key text;
  chat_title text;
  chat_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to use chat' using errcode = '42501'; end if;
  select p.id into caller_profile from public.profiles p where p.user_id = auth.uid();
  if caller_profile is null then raise exception 'Complete your profile before using chat'; end if;

  if p_listing_id is not null then
    select l.seller_id, l.title into other_profile, chat_title
    from public.listings l where l.id = p_listing_id and l.status = 'active';
    if other_profile is null then raise exception 'Listing not found or unavailable'; end if;
    if p_other_profile_id is not null and p_other_profile_id <> other_profile then
      raise exception 'The recipient does not own this listing' using errcode = '42501';
    end if;
    chat_key := 'listing:' || p_listing_id::text || ':' || caller_profile::text;
  else
    select p.id into other_profile from public.profiles p where p.id = p_other_profile_id;
    if other_profile is null then raise exception 'Recipient profile not found'; end if;
    chat_key := 'direct:' || least(caller_profile, other_profile)::text || ':' || greatest(caller_profile, other_profile)::text;
  end if;

  if caller_profile = other_profile then raise exception 'You cannot contact yourself'; end if;

  insert into public.chats(type, title, listing_id, direct_key)
  values ('direct', chat_title, p_listing_id, chat_key)
  on conflict (direct_key) where direct_key is not null
  do update set direct_key = excluded.direct_key
  returning id into chat_id;

  insert into public.chat_participants(chat_id, user_id)
  values (chat_id, caller_profile), (chat_id, other_profile)
  on conflict do nothing;
  return chat_id;
end;
$$;
revoke all on function needs_private.get_or_create_direct_chat(uuid, uuid) from public, anon;
grant execute on function needs_private.get_or_create_direct_chat(uuid, uuid) to authenticated;

-- Expose an invoker wrapper; the definer implementation stays outside the API schema.
create or replace function public.get_or_create_direct_chat(
  p_other_profile_id uuid default null,
  p_listing_id uuid default null
) returns uuid
language sql security invoker set search_path = '' as $$
  select needs_private.get_or_create_direct_chat(p_other_profile_id, p_listing_id);
$$;
revoke all on function public.get_or_create_direct_chat(uuid, uuid) from public, anon;
grant execute on function public.get_or_create_direct_chat(uuid, uuid) to authenticated;

-- Owners must be able to manage images on sold/suspended listings too.
drop policy if exists listings_select_own on public.listings;
create policy listings_select_own on public.listings for select to authenticated using (
  seller_id in (select id from public.profiles where user_id = (select auth.uid()))
);

alter table public.listing_images add column if not exists storage_path text;
update public.listing_images
set storage_path = substring(url from '/storage/v1/object/public/listing-images/([^?]+)')
where storage_path is null and url like '%/storage/v1/object/public/listing-images/%';

-- Keep one existing primary image per listing before enforcing the invariant.
with ranked as (
  select id, row_number() over (partition by listing_id order by id) as position
  from public.listing_images where main = true
)
update public.listing_images i set main = false from ranked r where i.id = r.id and r.position > 1;
create unique index if not exists listing_images_one_main on public.listing_images(listing_id) where main = true;

create or replace function public.set_main_listing_image(p_listing_id uuid, p_image_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  perform 1 from public.listings l join public.profiles p on p.id = l.seller_id
    where l.id = p_listing_id and p.user_id = auth.uid() for update of l;
  if not found then raise exception 'You do not own this listing' using errcode = '42501'; end if;
  perform 1 from public.listing_images where id = p_image_id and listing_id = p_listing_id;
  if not found then raise exception 'Image does not belong to this listing'; end if;
  update public.listing_images set main = false where listing_id = p_listing_id and main = true;
  update public.listing_images set main = true where id = p_image_id and listing_id = p_listing_id;
end;
$$;
revoke all on function public.set_main_listing_image(uuid, uuid) from public, anon;
grant execute on function public.set_main_listing_image(uuid, uuid) to authenticated;

-- Keep existing bucket settings; fresh/restored projects may lack these buckets.
insert into storage.buckets(id, name, public)
values ('avatars', 'avatars', true), ('listing-images', 'listing-images', true)
on conflict (id) do nothing;

-- Public bucket URLs remain readable. Mutating/listing objects requires ownership.
drop policy if exists "listing-images-insert-auth" on storage.objects;
drop policy if exists "listing-images-owner-insert" on storage.objects;
drop policy if exists "listing-images-owner-select" on storage.objects;
drop policy if exists "listing-images-owner-delete" on storage.objects;
create policy "listing-images-owner-insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'listing-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.listings l join public.profiles p on p.id = l.seller_id
              where l.id::text = (storage.foldername(name))[2] and p.user_id = (select auth.uid()))
);
create policy "listing-images-owner-select" on storage.objects for select to authenticated using (
  bucket_id = 'listing-images' and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy "listing-images-owner-delete" on storage.objects for delete to authenticated using (
  bucket_id = 'listing-images' and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- Profile photos use unique paths under auth.uid()/avatar or /cover. The
-- restored project had no Storage policies, including for these existing buckets.
drop policy if exists "avatars-insert-auth" on storage.objects;
drop policy if exists "avatars-owner-insert" on storage.objects;
drop policy if exists "avatars-owner-select" on storage.objects;
drop policy if exists "avatars-owner-delete" on storage.objects;
create policy "avatars-owner-insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy "avatars-owner-select" on storage.objects for select to authenticated using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy "avatars-owner-delete" on storage.objects for delete to authenticated using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- Enable chat events when the Supabase Realtime publication is available.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
