import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'

test('listing metadata and profile privileges preserve ownership', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.user_id', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      create table profiles (id uuid primary key default gen_random_uuid(), user_id uuid,
        display_name text, avatar_url text, title text, bio text, location text, cover_image text,
        role text default 'user', stripe_account_id text);
      create table listings (id uuid primary key, seller_id uuid, status text);
      create table listing_tags (listing_id uuid, tag text);
      alter table profiles enable row level security;
      alter table listings enable row level security;
      create policy profile_read on profiles for select using (true);
      create policy profile_insert on profiles for insert to authenticated with check (user_id=auth.uid());
      create policy profile_update on profiles for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
      create policy listing_read on listings for select using (status='active' or seller_id in (select id from profiles where user_id=auth.uid()));
      grant select on profiles, listings to anon;
      grant all on profiles, listings, listing_tags to authenticated;
      grant update(role) on profiles to authenticated;
      insert into profiles (id,user_id,display_name) values
        ('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Owner'),
        ('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Other');
      insert into listings values
        ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','active'),
        ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','suspended');
      insert into listing_tags values
        ('20000000-0000-0000-0000-000000000001','public'),
        ('20000000-0000-0000-0000-000000000002','hidden');
    `)
    await db.exec(await readFile(new URL('../../../supabase/migrations/20261013232626_listing_fields_and_tag_policies.sql', import.meta.url), 'utf8'))
    await db.exec('set role anon')
    assert.deepEqual((await db.query('select tag from listing_tags')).rows, [{ tag: 'public' }])
    await db.exec(`reset role; set role authenticated; set test.user_id='10000000-0000-0000-0000-000000000001'`)
    await db.exec(`insert into listing_tags values ('20000000-0000-0000-0000-000000000001','owner-tag')`)
    await assert.rejects(db.exec(`insert into listing_tags values ('20000000-0000-0000-0000-000000000002','forged')`))
    await assert.rejects(db.exec(`update profiles set role='admin' where user_id=auth.uid()`))
    await assert.rejects(db.exec(`insert into profiles(user_id,role) values (auth.uid(),'admin')`))
    await assert.rejects(db.exec(`update profiles set stripe_account_id='acct_attacker' where user_id=auth.uid()`))
    await db.exec(`update profiles set display_name='Updated' where user_id=auth.uid()`)
    assert.equal((await db.query(`select display_name from profiles where user_id=auth.uid()`)).rows[0].display_name, 'Updated')
  } finally { await db.close() }
})
