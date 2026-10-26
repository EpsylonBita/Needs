import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const buyer = '11111111-1111-4111-8111-111111111111'
const seller = '22222222-2222-4222-8222-222222222222'
const stranger = '33333333-3333-4333-8333-333333333333'
const buyerProfile = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const sellerProfile = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const strangerProfile = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const listing = '44444444-4444-4444-8444-444444444444'
const firstImage = '55555555-5555-4555-8555-555555555555'
const secondImage = '66666666-6666-4666-8666-666666666666'

async function asUser(userId, sql, params = [], role = 'authenticated') {
  await db.exec(`set role ${role}`)
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId || ''])
    return await db.query(sql, params)
  } finally { await db.exec('reset role') }
}

before(async () => {
  // A minimal local fixture of the legacy Supabase identity/schema/RLS contracts.
  // No live project, credentials, network or Storage API is involved.
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to anon, authenticated;
    create table profiles(id uuid primary key, user_id uuid unique not null);
    create table listings(id uuid primary key, seller_id uuid references profiles(id), title text, status text default 'active');
    create table chats(id uuid primary key default gen_random_uuid(), title text, type text, created_at timestamptz default now());
    create table chat_participants(chat_id uuid references chats(id), user_id uuid references profiles(id), primary key(chat_id,user_id));
    create table messages(id uuid primary key default gen_random_uuid(), chat_id uuid, sender_id uuid, content text);
    create table listing_images(id uuid primary key default gen_random_uuid(), listing_id uuid references listings(id), url text, main boolean default false);
    alter table profiles enable row level security;
    alter table listings enable row level security;
    alter table chats enable row level security;
    alter table chat_participants enable row level security;
    alter table listing_images enable row level security;
    create policy profiles_select on profiles for select using (true);
    create policy listings_select_active on listings for select using (status='active');
    create policy listings_update on listings for update to authenticated
      using (seller_id in (select id from profiles where user_id=auth.uid()))
      with check (seller_id in (select id from profiles where user_id=auth.uid()));
    create policy chats_select on chats for select using (exists (select 1 from chat_participants cp where cp.chat_id=chats.id and cp.user_id=auth.uid()));
    create policy chats_insert on chats for insert to authenticated with check (true);
    create policy chat_participants_select on chat_participants for select using (user_id in (select id from profiles where user_id=auth.uid()));
    create policy chat_participants_insert on chat_participants for insert to authenticated with check (user_id in (select id from profiles where user_id=auth.uid()));
    create policy images_select on listing_images for select using (exists (select 1 from listings l where l.id=listing_id and (l.status='active' or l.seller_id in (select id from profiles where user_id=auth.uid()))));
    create policy images_update on listing_images for update to authenticated
      using (exists (select 1 from listings l join profiles p on p.id=l.seller_id where l.id=listing_id and p.user_id=auth.uid()))
      with check (exists (select 1 from listings l join profiles p on p.id=l.seller_id where l.id=listing_id and p.user_id=auth.uid()));
    grant all on all tables in schema public to authenticated;
    grant select on profiles, listings, listing_images to anon;
    create schema storage;
    create table storage.buckets(id text primary key, name text not null, public boolean default false);
    create table storage.objects(name text primary key, bucket_id text);
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
    alter table storage.objects enable row level security;
    create policy "listing-images-insert-auth" on storage.objects for insert to authenticated with check (bucket_id='listing-images');
    grant usage on schema storage to authenticated;
    grant all on storage.objects to authenticated;
    insert into profiles values ('${buyerProfile}','${buyer}'),('${sellerProfile}','${seller}'),('${strangerProfile}','${stranger}');
    insert into listings values ('${listing}','${sellerProfile}','A real listing','active');
    insert into listing_images values
      ('${firstImage}','${listing}','https://example.invalid/storage/v1/object/public/listing-images/${seller}/${listing}/first.jpg',true),
      ('${secondImage}','${listing}','https://example.invalid/storage/v1/object/public/listing-images/${seller}/${listing}/second.jpg',true);
  `)
  const migration = await readFile(new URL('../../../supabase/migrations/20261013232103_chat_storage_repairs.sql', import.meta.url), 'utf8').catch(async () =>
    readFile(new URL('../../../../supabase/migrations/20261013232103_chat_storage_repairs.sql', import.meta.url), 'utf8'))
  await db.exec(migration)
})
after(async () => { await db.close() })

test('listing contacts are idempotent and atomically include the buyer and actual seller', async () => {
  const first = await asUser(buyer, 'select get_or_create_direct_chat(p_listing_id => $1) as id', [listing])
  const second = await asUser(buyer, 'select get_or_create_direct_chat(p_listing_id => $1) as id', [listing])
  assert.equal(first.rows[0].id, second.rows[0].id)
  const members = await db.query('select user_id from chat_participants where chat_id=$1 order by user_id', [first.rows[0].id])
  assert.deepEqual(members.rows.map(row => row.user_id), [buyerProfile, sellerProfile])
  assert.equal((await db.query('select count(*)::int as count from chats')).rows[0].count, 1)
})

test('chat RLS grants only participants access and prevents arbitrary self-enrollment', async () => {
  const id = (await asUser(buyer, 'select get_or_create_direct_chat(p_listing_id => $1) as id', [listing])).rows[0].id
  assert.equal((await asUser(buyer, 'select id from chats where id=$1', [id])).rows.length, 1)
  assert.equal((await asUser(seller, 'select id from chats where id=$1', [id])).rows.length, 1)
  assert.equal((await asUser(stranger, 'select id from chats where id=$1', [id])).rows.length, 0)
  await assert.rejects(asUser(stranger, 'insert into chat_participants values ($1,$2)', [id, strangerProfile]), /permission denied/)
})

test('chat creation rejects anonymous callers, self-contact and forged listing recipients', async () => {
  await assert.rejects(asUser(null, 'select get_or_create_direct_chat(p_listing_id => $1)', [listing], 'anon'), /permission denied/)
  await assert.rejects(asUser(null, 'select get_or_create_direct_chat(p_listing_id => $1)', [listing]), /Sign in/)
  await assert.rejects(asUser(seller, 'select get_or_create_direct_chat(p_listing_id => $1)', [listing]), /cannot contact yourself/)
  await assert.rejects(asUser(buyer, 'select get_or_create_direct_chat($1,$2)', [strangerProfile, listing]), /does not own/)
})

test('direct conversations reuse the same chat in both directions', async () => {
  const first = await asUser(buyer, 'select get_or_create_direct_chat(p_other_profile_id => $1) as id', [sellerProfile])
  const second = await asUser(seller, 'select get_or_create_direct_chat(p_other_profile_id => $1) as id', [buyerProfile])
  assert.equal(first.rows[0].id, second.rows[0].id)
})

test('image migration backfills paths and main-image changes are atomic and authorized', async () => {
  const paths = await db.query('select storage_path from listing_images where id=$1', [firstImage])
  assert.equal(paths.rows[0].storage_path, `${seller}/${listing}/first.jpg`)
  assert.equal((await db.query('select count(*)::int as count from listing_images where main')).rows[0].count, 1)
  await asUser(seller, 'select set_main_listing_image($1,$2)', [listing, secondImage])
  await assert.rejects(asUser(seller, 'select set_main_listing_image($1,$2)', [listing, strangerProfile]), /does not belong/)
  await assert.rejects(asUser(buyer, 'select set_main_listing_image($1,$2)', [listing, firstImage]), /do not own/)
  assert.deepEqual((await db.query('select id from listing_images where main')).rows, [{ id: secondImage }])
  await db.query("update listings set status='sold' where id=$1", [listing])
  await asUser(seller, 'select set_main_listing_image($1,$2)', [listing, firstImage])
  assert.deepEqual((await db.query('select id from listing_images where main')).rows, [{ id: firstImage }])
  await db.query("update listings set status='active' where id=$1", [listing])
})

test('storage policies allow owner cleanup and reject another user’s upload or deletion', async () => {
  const path = `${seller}/${listing}/new.jpg`
  await asUser(seller, "insert into storage.objects(name,bucket_id) values($1,'listing-images')", [path])
  await assert.rejects(asUser(buyer, "insert into storage.objects(name,bucket_id) values($1,'listing-images')", [`${buyer}/${listing}/intruder.jpg`]), /row-level security/)
  assert.equal((await asUser(buyer, 'delete from storage.objects where name=$1 returning name', [path])).rows.length, 0)
  assert.equal((await asUser(seller, 'delete from storage.objects where name=$1 returning name', [path])).rows.length, 1)
})

test('profile photo buckets and policies allow only the owner to upload or remove files', async () => {
  assert.deepEqual((await db.query('select id, public from storage.buckets order by id')).rows,
    [{ id: 'avatars', public: true }, { id: 'listing-images', public: true }])
  const path = `${seller}/avatar/photo.jpg`
  await asUser(seller, "insert into storage.objects(name,bucket_id) values($1,'avatars')", [path])
  await assert.rejects(asUser(buyer, "insert into storage.objects(name,bucket_id) values($1,'avatars')", [`${seller}/cover/forged.jpg`]), /row-level security/)
  assert.equal((await asUser(buyer, 'delete from storage.objects where name=$1 returning name', [path])).rows.length, 0)
  assert.equal((await asUser(seller, 'delete from storage.objects where name=$1 returning name', [path])).rows.length, 1)
})
