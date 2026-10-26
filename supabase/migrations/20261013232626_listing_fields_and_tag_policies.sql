-- Preserve submitted contact details and allow owners to save searchable tags.
alter table public.listings add column if not exists contact_number text;
alter table public.listing_tags enable row level security;

drop policy if exists listing_tags_read on public.listing_tags;
create policy listing_tags_read on public.listing_tags for select to anon, authenticated
using (exists (select 1 from public.listings l where l.id = listing_id));
drop policy if exists listing_tags_owner_insert on public.listing_tags;
create policy listing_tags_owner_insert on public.listing_tags for insert to authenticated
with check (exists (select 1 from public.listings l join public.profiles p on p.id = l.seller_id
  where l.id = listing_id and p.user_id = (select auth.uid())));
drop policy if exists listing_tags_owner_delete on public.listing_tags;
create policy listing_tags_owner_delete on public.listing_tags for delete to authenticated
using (exists (select 1 from public.listings l join public.profiles p on p.id = l.seller_id
  where l.id = listing_id and p.user_id = (select auth.uid())));
grant select on public.listing_tags to anon;
grant select, insert, delete on public.listing_tags to authenticated;

-- Profiles are user-editable, but roles and Stripe account ownership are not.
-- Remove the recursive role policy. Administrative writes use the server role.
drop policy if exists profiles_role_update on public.profiles;
revoke insert, update on public.profiles from authenticated;
revoke update (role) on public.profiles from authenticated;
grant insert (user_id, display_name, avatar_url, title, bio, location, cover_image)
  on public.profiles to authenticated;
grant update (display_name, avatar_url, title, bio, location, cover_image)
  on public.profiles to authenticated;
