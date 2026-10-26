import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'

const owner = '10000000-0000-4000-8000-000000000001'
const other = '10000000-0000-4000-8000-000000000002'
const profile = '20000000-0000-4000-8000-000000000001'
const active = '30000000-0000-4000-8000-000000000001'
const legacy = '30000000-0000-4000-8000-000000000002'
const load = path => readFile(new URL(`../../../supabase/${path}`, import.meta.url), 'utf8')

test('real owner policies cannot bypass an administrative hold, while ordinary pause/resume still works', async () => {
  const db = new PGlite()
  async function as(role, user, sql, params = []) {
    await db.exec(`set role ${role}`)
    try {
      await db.query("select set_config('test.user_id', $1, false)", [user || ''])
      return await db.query(sql, params)
    } finally { await db.exec('reset role') }
  }
  const ownerQuery = (sql, params) => as('authenticated', owner, sql, params)
  const admin = (id, suspended, note = '') => as('service_role', null,
    "select moderate_listing($1, $2, 'admin@example.invalid', $3) as result", [id, suspended, note])
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user_id', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated, service_role;
      create table profiles(id uuid primary key, user_id uuid unique);
      create table listings(id uuid primary key default gen_random_uuid(), seller_id uuid references profiles(id),
        title text default 'Listing', description text default 'Description', price numeric default 10,
        main_category text default 'Items', sub_category text default 'Sell',
        status text not null default 'active' check (status in ('active','sold','suspended')),
        location text, address jsonb, contact_number text);
      create table moderation_logs(id uuid default gen_random_uuid(), admin_email text not null,
        listing_id uuid references listings(id) on delete cascade, action text, admin_notes text check(admin_notes <> 'reject-audit'));
      alter table listings enable row level security;
      alter table moderation_logs enable row level security;
      grant select on profiles, listings to anon, authenticated;
      grant all on listings to authenticated;
      insert into profiles values ('${profile}','${owner}');
      insert into listings(id,seller_id,status) values ('${active}','${profile}','active'),('${legacy}','${profile}','suspended');
    `)
    // Use the repository's actual policies, not a hand-written stronger substitute.
    const policySource = await load('sql/020_fix_rls_identity_model.sql')
    await db.exec(policySource.split('-- Listings policies')[1].split('-- Listing images policies')[0])
    const initialPolicies = await load('sql/002_indexes_policies.sql')
    await db.exec(initialPolicies.match(/create policy listings_select_active[^;]+;/)[0])
    const storageRepair = await load('migrations/20261013232103_chat_storage_repairs.sql')
    await db.exec(storageRepair.match(/create policy listings_select_own[\s\S]*?;/)[0])
    // Demonstrate the existing vulnerability before applying the repair.
    await ownerQuery("update listings set status='active' where id=$1", [legacy])
    assert.equal((await ownerQuery('select status from listings where id=$1', [legacy])).rows[0].status, 'active')
    await db.query("update listings set status='suspended' where id=$1", [legacy])

    assert.equal((await db.query("select has_table_privilege('service_role', 'moderation_logs', 'INSERT') as allowed")).rows[0].allowed, false)
    await db.exec(await load('migrations/20261019120300_listing_moderation.sql'))
    assert.equal((await db.query("select has_table_privilege('service_role', 'moderation_logs', 'INSERT') as allowed")).rows[0].allowed, true)
    assert.deepEqual((await db.query('select status,owner_status,moderation_suspended from listings where id=$1', [legacy])).rows[0],
      { status: 'suspended', owner_status: 'suspended', moderation_suspended: true })
    await assert.rejects(ownerQuery("update listings set status='active' where id=$1", [legacy]), /administrator must release/)
    await assert.rejects(ownerQuery('update listings set moderation_suspended=false where id=$1', [legacy]), /permission denied/)
    await assert.rejects(ownerQuery("update listings set owner_status='active' where id=$1", [legacy]), /permission denied/)
    await assert.rejects(ownerQuery('delete from listings where id=$1', [legacy]), /held for moderation/)
    await assert.rejects(ownerQuery("insert into listings(id,seller_id,status) values ($1,$2,'active') on conflict(id) do update set status='active'", [legacy, profile]), /administrator must release/)
    await assert.rejects(ownerQuery("insert into listings(seller_id,moderation_suspended) values ($1,false)", [profile]), /permission denied/)
    await assert.rejects(ownerQuery("insert into listings(seller_id,owner_status) values ($1,'active')", [profile]), /permission denied/)
    await assert.rejects(ownerQuery('update listings set id=gen_random_uuid() where id=$1', [legacy]), /permission denied/)
    await assert.rejects(ownerQuery("select moderate_listing($1,false,'forged','')", [legacy]), /permission denied/)
    assert.equal((await as('anon', null, 'select id from listings where id=$1', [legacy])).rows.length, 0)
    assert.equal((await as('authenticated', other, "update listings set status='sold' where id=$1 returning id", [active])).rows.length, 0)

    // Release of an ambiguous legacy suspension stays paused until owner action.
    await admin(legacy, false)
    assert.equal((await ownerQuery('select status from listings where id=$1', [legacy])).rows[0].status, 'suspended')
    await ownerQuery("update listings set status='active' where id=$1", [legacy])
    await ownerQuery("update listings set status='suspended' where id=$1", [active])
    await ownerQuery("update listings set status='active' where id=$1", [active])
    await admin(active, true)
    await admin(active, true)
    await assert.rejects(ownerQuery("update listings set status='active' where id=$1", [active]), /administrator must release/)
    await assert.rejects(ownerQuery("update listings set status='sold' where id=$1", [active]), /administrator must release/)
    await assert.rejects(ownerQuery('delete from listings where id=$1', [active]), /held for moderation/)
    await ownerQuery("update listings set title='Corrected description' where id=$1", [active])
    assert.equal((await as('anon', null, 'select id from listings where id=$1', [active])).rows.length, 0)
    await assert.rejects(admin(active, false, 'reject-audit'), /check constraint/)
    assert.equal((await db.query('select moderation_suspended from listings where id=$1', [active])).rows[0].moderation_suspended, true)
    await admin(active, false)
    assert.equal((await as('anon', null, 'select status from listings where id=$1', [active])).rows[0].status, 'active')
    await ownerQuery("update listings set status='sold' where id=$1", [active])
    await admin(active, true)
    await admin(active, false)
    assert.equal((await ownerQuery('select status from listings where id=$1', [active])).rows[0].status, 'sold')
    const audited = (await db.query('select action from moderation_logs where listing_id=$1', [active])).rows.map(row => row.action)
    assert.deepEqual(audited, ['suspend', 'suspend', 'unsuspend', 'suspend', 'unsuspend'])
    await ownerQuery('delete from listings where id=$1', [active])
    await ownerQuery('insert into listings(seller_id,status) values ($1,$2)', [profile, 'active'])
  } finally { await db.close() }
})
