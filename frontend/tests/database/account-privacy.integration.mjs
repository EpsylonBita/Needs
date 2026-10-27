import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
const db = new PGlite()
const users = Array.from({ length: 3 }, () => randomUUID())
const profiles = Array.from({ length: 3 }, () => randomUUID())
const listings = [randomUUID(), randomUUID()]
const payments = [randomUUID(), randomUUID()]
const chat = randomUUID()
const load = path => readFile(new URL(`../../../supabase/${path}`, import.meta.url), 'utf8')
const table = (source, name) => source.match(new RegExp(`create table if not exists ${name} \\([\\s\\S]*?\\n\\);`, 'i'))[0]
async function rpc(name, args = [], role = 'service_role') {
  await db.exec(`set role ${role}`)
  try { return (await db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as value`, args)).rows[0].value }
  finally { await db.exec('reset role') }
}
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    grant usage on schema auth to authenticated,service_role;
    create schema needs_private; grant usage on schema needs_private to authenticated;`)
  const source = await load('sql/001_init.sql')
  for (const name of ['profiles', 'listings', 'listing_images', 'listing_tags', 'chats', 'chat_participants', 'messages', 'payments', 'transactions', 'disputes', 'reviews', 'notifications']) await db.exec(table(source, name).replace('geography(Point,4326)', 'text'))
  await db.exec(await load('sql/017_add_profile_columns.sql'))
  await db.exec(await load('sql/009_milestones.sql'))
  await db.exec(await load('sql/013_webhook_events.sql'))
  await db.exec(await load('sql/023_webhook_events_extended.sql'))
  await db.exec('alter table transactions add column metadata jsonb')
  await db.exec(`alter table profiles add column secret_field text; alter table payments add column currency text default 'eur'; alter table payments add column completed_at timestamptz;
    alter table disputes add column stripe_dispute_id text; alter table chat_participants add column left_at timestamptz;`)
  for (let i = 0; i < 3; i++) {
    await db.query('insert into auth.users(id,email)values($1,$2)', [users[i], `person${i}@example.invalid`])
    await db.query('insert into profiles(id,user_id,display_name,secret_field)values($1,$2,$3,$4)', [profiles[i], users[i], `Person ${i}`, `secret-${i}`])
  }
  await db.exec('alter table listings add column contact_number text')
  for (let i = 0; i < 2; i++) await db.query("insert into listings(id,seller_id,title,description,price,main_category,sub_category,location)values($1,$2,$3,'Description',20,'Items','Sell','POINT(23 37)')", [listings[i], profiles[i], i ? 'Other listing' : 'Own listing'])
  await db.query("insert into chats(id,type)values($1,'direct')", [chat])
  for (let i = 0; i < 2; i++) {
    await db.query('insert into chat_participants(chat_id,user_id)values($1,$2)', [chat, profiles[i]])
    await db.query('insert into messages(chat_id,sender_id,content)values($1,$2,$3)', [chat, profiles[i], i ? 'Other private message' : 'Own message'])
    await db.query("insert into notifications(user_id,type,payload)values($1,'test',$2)", [profiles[i], JSON.stringify({ text: i ? 'Other notice' : 'Own notice' })])
    await db.query("insert into payments(id,listing_id,buyer_id,seller_id,amount,platform_fee,status,stripe_payment_intent)values($1,$2,$3,$4,20,1,'requires_capture',$5)", [payments[i], listings[i], profiles[i], profiles[i + 1], `secret_intent_${i}`])
    await db.query("insert into transactions(payment_id,type,amount,status)values($1,'refund',5,'pending')", [payments[i]])
    await db.query("insert into disputes(payment_id,reason,status)values($1,$2,'open')", [payments[i], i ? 'Other complaint' : 'Own complaint'])
    await db.query("insert into reviews(listing_id,seller_id,reviewer_id,rating,comment)values($1,$2,$3,4,$4)", [listings[i], profiles[i + 1], profiles[i], i ? 'Other review' : 'Own review'])
  }
  const migration = await load('migrations/20261026141000_account_privacy_requests.sql')
  await db.exec(migration); await db.exec(migration)
  await db.exec(await load('migrations/20261027113829_payment_transaction_currencies.sql'))
})
after(() => db.close())

test('exports owned records and participant finances without private counterparty data or future secret columns', async () => {
  const value = await rpc('export_account_data', [users[0]])
  assert.equal(value.profile.display_name, 'Person 0')
  assert.equal(value.listings.length, 1); assert.equal(value.listings[0].title, 'Own listing')
  assert.equal(value.sent_messages.length, 1); assert.equal(value.sent_messages[0].content, 'Own message')
  assert.equal(value.payments.length, 1); assert.equal(value.payments[0].role, 'buyer')
  assert.equal(value.payments[0].transactions.length, 1)
  assert.equal(value.payments[0].transactions[0].currency, 'eur')
  assert.equal(value.payments[0].disputes[0].reason, 'Own complaint')
  assert.equal(value.authored_reviews.length, 1)
  assert.doesNotMatch(JSON.stringify(value), /Other private|Other listing|Other notice|Other complaint|Other review|secret-|secret_intent|person1@/)
  const provider = await rpc('export_account_data', [users[1]])
  assert.equal(provider.payments.find(row => row.id === payments[0]).disputes[0].reason, null)
})

test('export labels an FX transfer independently and keeps unknown legacy currency null', async () => {
  const eventId = `evt_${randomUUID()}`, transfer = `tr_${randomUUID()}`
  const event = { id: eventId, type: 'transfer.created', data: { object: { id: transfer, amount: 223, currency: 'usd' } } }
  await db.query("insert into webhook_events(id,source,event_type,payload) values($1,'stripe','transfer.created',$2::jsonb)", [eventId, JSON.stringify(event)])
  const recorded = (await db.query("insert into transactions(payment_id,type,amount,status,metadata) values($1,'transfer',2.23,'created',$2::jsonb) returning id", [payments[0], JSON.stringify({ stripe_event_id: eventId, stripe_object_id: transfer, stripe_payment_intent_id: 'secret_intent_0' })])).rows[0].id
  const legacy = (await db.query("insert into transactions(payment_id,type,amount,status) values($1,'transfer',3.45,'created') returning id", [payments[0]])).rows[0].id
  const exported = (await rpc('export_account_data', [users[0]])).payments[0]
  assert.equal(exported.currency, 'eur')
  assert.equal(exported.transactions.find(row => row.id === recorded).currency, 'usd')
  assert.equal(exported.transactions.find(row => row.id === recorded).amount, 2.23)
  assert.equal(exported.transactions.find(row => row.id === legacy).currency, null)
  assert.doesNotMatch(JSON.stringify(exported), /stripe_event_id|secret_intent_0/)
})

test('denies every RPC/table to untrusted clients and preserves other private-schema access grants', async () => {
  for (const role of ['anon', 'authenticated']) {
    for (const [name, args] of [
      ['export_account_data', [users[0]]], ['get_account_deletion_status', [users[0]]], ['request_account_deletion', [users[0]]],
      ['cancel_account_deletion', [users[0], randomUUID()]], ['list_account_deletion_requests', []],
      ['review_account_deletion_request', [randomUUID(), users[1], 'reviewing', 'Review response']],
    ]) await assert.rejects(rpc(name, args, role), /permission denied/)
    await db.exec(`set role ${role}`)
    try { await assert.rejects(db.query('select * from account_deletion_requests'), /permission denied/) }
    finally { await db.exec('reset role') }
  }
  assert.equal((await db.query("select has_schema_privilege('authenticated','needs_private','USAGE') as allowed")).rows[0].allowed, true)
})

test('records one durable request despite blockers and retries, retaining the account and finances', async () => {
  const first = await rpc('request_account_deletion', [users[0]])
  const retry = await rpc('request_account_deletion', [users[0]])
  assert.equal(first.request.id, retry.request.id)
  assert.equal(first.request.status, 'pending')
  assert.deepEqual(first.blockers, { active_orders: 1, open_disputes: 1, pending_refunds: 1, active_milestones: 0, financial_history: true })
  assert.equal((await db.query('select count(*)::int as count from account_deletion_requests where user_id=$1', [users[0]])).rows[0].count, 1)
  assert.equal((await db.query('select count(*)::int as count from auth.users')).rows[0].count, 3)
  assert.equal((await db.query('select count(*)::int as count from payments')).rows[0].count, 2)
  await assert.rejects(db.query('delete from auth.users where id=$1', [users[0]]), /foreign key/)
})

test('shows live blockers independently of permanent financial-history review', async () => {
  await db.query("update payments set status='completed' where id=$1", [payments[0]])
  await db.query("update disputes set status='resolved' where payment_id=$1", [payments[0]])
  await db.query("update transactions set status='succeeded' where payment_id=$1", [payments[0]])
  const value = await rpc('get_account_deletion_status', [users[0]])
  assert.equal(value.blockers.active_orders, 0); assert.equal(value.blockers.open_disputes, 0); assert.equal(value.blockers.pending_refunds, 0)
  assert.equal(value.blockers.financial_history, true)
  await db.query("insert into milestones(listing_id,buyer_id,seller_id,title,amount)values($1,$2,$3,'Pending delivery',10)", [listings[0], profiles[0], profiles[1]])
  assert.equal((await rpc('get_account_deletion_status', [users[0]])).blockers.active_milestones, 1)
})

test('owner cancellation and review refuse cross-account requests and never claim deletion is complete', async () => {
  const current = await rpc('request_account_deletion', [users[0]])
  await assert.rejects(rpc('cancel_account_deletion', [users[2], current.request.id]), /Active request not found/)
  await assert.rejects(rpc('review_account_deletion_request', [current.request.id, users[1], 'completed', 'All data is deleted']), /Choose a review state/)
  const reviewed = await rpc('review_account_deletion_request', [current.request.id, users[1], 'needs_information', 'Please resolve your pending order first.'])
  assert.equal(reviewed.request.status, 'needs_information')
  assert.equal(reviewed.request.response, 'Please resolve your pending order first.')
  const cancelled = await rpc('cancel_account_deletion', [users[0], current.request.id])
  assert.equal(cancelled.request.status, 'cancelled')
  await assert.rejects(rpc('review_account_deletion_request', [current.request.id, users[1], 'reviewing', 'We are reviewing this request']), /Active request not found/)
  const again = await rpc('request_account_deletion', [users[0]])
  assert.notEqual(again.request.id, current.request.id)
})

test('admin queue uses bounded stable pages and includes current retention flags', async () => {
  await rpc('request_account_deletion', [users[1]]); await rpc('request_account_deletion', [users[2]])
  const first = await rpc('list_account_deletion_requests', [null, null, 1])
  assert.equal(first.rows.length, 1); assert.ok(first.next_cursor)
  const second = await rpc('list_account_deletion_requests', [first.next_cursor.created_at, first.next_cursor.id, 1])
  assert.equal(second.rows.length, 1); assert.notEqual(first.rows[0].id, second.rows[0].id)
  await assert.rejects(rpc('list_account_deletion_requests', [null, null, 101]), /Invalid page/)
  await assert.rejects(rpc('list_account_deletion_requests', [null, randomUUID(), 20]), /Invalid page/)
})
