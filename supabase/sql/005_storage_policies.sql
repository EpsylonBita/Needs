insert into storage.buckets (id, name, public)
select 'avatars', 'avatars', true
where not exists (select 1 from storage.buckets where id = 'avatars');

insert into storage.buckets (id, name, public)
select 'listing-images', 'listing-images', true
where not exists (select 1 from storage.buckets where id = 'listing-images');

alter table storage.objects enable row level security;

create policy "avatars-insert-auth" on storage.objects
  for insert
  to authenticated
  with check ( bucket_id = 'avatars' );

create policy "listing-images-insert-auth" on storage.objects
  for insert
  to authenticated
  with check ( bucket_id = 'listing-images' );