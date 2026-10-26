import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'

const owner = '10000000-0000-4000-8000-000000000001'
const other = '10000000-0000-4000-8000-000000000002'
const ownerProfile = '20000000-0000-4000-8000-000000000001'
const otherProfile = '20000000-0000-4000-8000-000000000002'
const load = path => readFile(new URL(`../../../supabase/${path}`, import.meta.url), 'utf8')
const migration = 'migrations/20261019164527_listing_history_and_notifications.sql'
const table = (source, name) => source.match(new RegExp(`create table if not exists ${name} \\([\\s\\S]*?\\n\\);`, 'i'))[0]

async function setup() {
  const db = new PGlite()
  const initial = await load('sql/001_init.sql')
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user_id', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    create table profiles(id uuid primary key, user_id uuid unique);
    insert into profiles values ('${ownerProfile}','${owner}'),('${otherProfile}','${other}');
    create table listings(id uuid primary key default gen_random_uuid(), seller_id uuid references profiles(id),
      title text default 'Listing', description text default 'Description', price numeric default 10,
      main_category text default 'Items', sub_category text default 'Sell',
      status text not null default 'active' check (status in ('active','sold','suspended')),
      location text, address jsonb, contact_number text);
    create table moderation_logs(id uuid default gen_random_uuid(), admin_email text not null,
      listing_id uuid references listings(id) on delete cascade, action text, admin_notes text);
    create table payment_audit_logs(id uuid default gen_random_uuid(), listing_id uuid references listings(id));
    alter table listings enable row level security;
    grant select on profiles to anon, authenticated;
    grant all on listings to authenticated;
    create policy listings_read on listings for select using (seller_id in (select id from profiles where user_id=auth.uid()));
    create publication supabase_realtime;
  `)
  for (const name of ['payments', 'transactions', 'disputes', 'reviews', 'notifications']) {
    await db.exec(table(initial, name))
  }
  await db.exec(table(await load('sql/009_milestones.sql'), 'milestones'))
  const policies = await load('sql/020_fix_rls_identity_model.sql')
  await db.exec(policies.split('-- Listings policies')[1].split('-- Listing images policies')[0])
  await db.exec(policies.split('-- Notifications policies')[1].split('-- Grant necessary permissions')[0])
  await db.exec(`
    alter table notifications enable row level security;
    grant all on notifications to anon, authenticated;
    grant all on payments, transactions, disputes, reviews, milestones, payment_audit_logs to service_role;
    alter table payments enable row level security;
    alter table reviews enable row level security;
    alter table milestones enable row level security;
    alter table payment_audit_logs enable row level security;
  `)
  await db.exec(await load('migrations/20261019120300_listing_moderation.sql'))
  return db
}

async function as(db, role, user, sql, params = []) {
  await db.exec(`set role ${role}`)
  try {
    await db.query("select set_config('test.user_id', $1, false)", [user || ''])
    return await db.query(sql, params)
  } finally { await db.exec('reset role') }
}

async function listing(db) {
  return (await db.query('insert into listings(seller_id) values ($1) returning id', [ownerProfile])).rows[0].id
}

async function history(db, kind, id) {
  if (kind === 'payments') {
    const payment = (await db.query("insert into payments(listing_id,buyer_id,seller_id,amount,platform_fee,status) values ($1,$2,$3,10,0.5,'completed') returning id", [id, otherProfile, ownerProfile])).rows[0].id
    await db.query("insert into transactions(payment_id,type,amount,status) values ($1,'charge',10,'succeeded')", [payment])
    await db.query("insert into disputes(payment_id,status) values ($1,'open')", [payment])
  } else if (kind === 'milestones') {
    await db.query("insert into milestones(listing_id,buyer_id,seller_id,title,amount) values ($1,$2,$3,'Unpaid proposal',10)", [id, otherProfile, ownerProfile])
  } else if (kind === 'reviews') {
    await db.query('insert into reviews(listing_id,seller_id,reviewer_id,rating) values ($1,$2,$3,4)', [id, ownerProfile, otherProfile])
  } else {
    await db.query(`insert into ${kind}(listing_id) values ($1)`, [id])
  }
}

test('listing history survives owner and server deletion attempts; an unused listing can still be deleted', async () => {
  const db = await setup()
  try {
    // Existing owner DELETE cascades without incidental audit/order constraints.
    const vulnerable = await listing(db)
    await history(db, 'payments', vulnerable)
    await as(db, 'authenticated', owner, 'delete from listings where id=$1', [vulnerable])
    assert.equal((await db.query('select count(*)::int as count from payments')).rows[0].count, 0)
    assert.equal((await db.query('select count(*)::int as count from transactions')).rows[0].count, 0)
    assert.equal((await db.query('select count(*)::int as count from disputes')).rows[0].count, 0)

    const fixtures = []
    for (const kind of ['payments', 'milestones', 'reviews', 'payment_audit_logs']) {
      const id = await listing(db)
      await history(db, kind, id)
      fixtures.push({ kind, id })
    }
    await db.exec(await load(migration))
    await db.exec(await load(migration)) // Reapplying must not duplicate the publication or policies.
    for (const { kind, id } of fixtures) {
      for (const [role, user] of [['authenticated', owner], ['service_role', null], ['postgres', null]]) {
        await assert.rejects(as(db, role, user, 'delete from listings where id=$1', [id]), /Pause it instead/)
      }
      assert.equal((await db.query(`select count(*)::int as count from ${kind} where listing_id=$1`, [id])).rows[0].count, 1)
      await as(db, 'authenticated', owner, "update listings set status='suspended' where id=$1", [id])
    }
    assert.equal((await db.query('select count(*)::int as count from transactions')).rows[0].count, 1)
    assert.equal((await db.query('select count(*)::int as count from disputes')).rows[0].count, 1)

    const unused = await listing(db)
    assert.equal((await as(db, 'authenticated', other, 'delete from listings where id=$1 returning id', [unused])).rows.length, 0)
    await as(db, 'authenticated', owner, 'delete from listings where id=$1', [unused])
    assert.equal((await db.query('select id from listings where id=$1', [unused])).rows.length, 0)

    const held = await listing(db)
    await db.query('update listings set moderation_suspended=true where id=$1', [held])
    await assert.rejects(as(db, 'authenticated', owner, 'delete from listings where id=$1', [held]), /held for moderation/)

    // Explicit RESTRICT FKs preserve history even if another trusted migration
    // temporarily disables our user trigger; referential checks also serialize races.
    await db.exec('alter table listings disable trigger protect_listing_history')
    for (const { kind, id } of fixtures.filter(row => ['payments', 'milestones', 'reviews'].includes(row.kind))) {
      await assert.rejects(db.query('delete from listings where id=$1', [id]), /foreign key constraint/)
      assert.equal((await db.query(`select count(*)::int as count from ${kind} where listing_id=$1`, [id])).rows[0].count, 1)
    }
  } finally { await db.close() }
})

test('legacy orders are retained when that optional table exists', async () => {
  const db = await setup()
  try {
    await db.exec('create table orders(id uuid default gen_random_uuid(), listing_id uuid references listings(id) on delete restrict)')
    const id = await listing(db)
    await history(db, 'orders', id)
    await db.exec(await load(migration))
    await assert.rejects(as(db, 'authenticated', owner, 'delete from listings where id=$1', [id]), /Pause it instead/)
    assert.equal((await db.query('select count(*)::int as count from orders')).rows[0].count, 1)
  } finally { await db.close() }
})

test('notifications publication is idempotent and recipients alone can read/update their notifications', async () => {
  const db = await setup()
  try {
    await db.exec(await load(migration))
    await db.exec(await load(migration))
    await db.query("insert into notifications(user_id,type) values ($1,'owner_notice'),($2,'other_notice')", [ownerProfile, otherProfile])
    assert.equal((await db.query("select count(*)::int as count from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications'")).rows[0].count, 1)
    assert.deepEqual((await as(db, 'authenticated', owner, 'select type from notifications')).rows, [{ type: 'owner_notice' }])
    assert.deepEqual((await as(db, 'authenticated', other, 'select type from notifications')).rows, [{ type: 'other_notice' }])
    assert.deepEqual((await as(db, 'anon', null, 'select type from notifications')).rows, [])
    assert.equal((await as(db, 'authenticated', owner, 'update notifications set read=true returning id')).rows.length, 1)
    assert.equal((await db.query('select read from notifications where user_id=$1', [otherProfile])).rows[0].read, false)
    await assert.rejects(as(db, 'authenticated', owner, 'update notifications set user_id=$1 where user_id=$2', [otherProfile, ownerProfile]), /row-level security/)
    // A future broad permissive SELECT must not bypass the recipient restriction.
    await db.exec('create policy legacy_broad_read on notifications for select using (true)')
    assert.deepEqual((await as(db, 'authenticated', owner, 'select type from notifications')).rows, [{ type: 'owner_notice' }])
    assert.deepEqual((await as(db, 'anon', null, 'select type from notifications')).rows, [])
  } finally { await db.close() }
})
