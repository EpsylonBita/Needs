import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const users = Array.from({ length: 3 }, () => randomUUID())
const profiles = Array.from({ length: 3 }, () => randomUUID())
const [publisher, responder, outsider] = profiles
const migration = 'migrations/20261026213133_service_price_agreements.sql'
const accessMigration = 'migrations/20261026214557_service_agreement_api_access.sql'
const read = path => readFile(new URL(`../../../supabase/${path}`, import.meta.url), 'utf8')

function table(source, name) {
  const start = source.toLowerCase().indexOf(`create table if not exists ${name} (`)
  assert.notEqual(start, -1, `Missing actual baseline table ${name}`)
  return source.slice(start, source.indexOf(');', start) + 2)
}

async function as(role, user, sql, params = []) {
  await db.exec(`set role ${role}`)
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user || ''])
    return await db.query(sql, params)
  } finally {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub','',false)")
  }
}
const rpc = async (sql, params) => (await as('service_role', null, `select public.${sql} result`, params)).rows[0].result
const stripeIntent = () => `pi_${randomUUID().replaceAll('-', '')}`
const propose = (fixture, actor = publisher, amount = 40, expected = null) => rpc(
  'propose_service_price_agreement($1,$2,$3,$4::numeric,$5)', [fixture.listing, fixture.chat, actor, amount, expected],
)
const respond = (agreement, actor, action) => rpc('respond_service_price_agreement($1,$2,$3)', [agreement, actor, action])
const fund = (agreement, buyer, intent = stripeIntent()) => rpc('create_agreed_service_payment($1,$2,$3)', [agreement, buyer, intent])
const retire = (agreement, buyer, intent) => rpc('retire_service_agreement_payment($1,$2,$3)', [agreement, buyer, intent])
const agreementRow = async id => (await db.query('select * from service_price_agreements where id=$1', [id])).rows[0]
const paymentRow = async intent => (await db.query('select * from payments where stripe_payment_intent=$1', [intent])).rows[0]
const agreementCount = async listing => (await db.query('select count(*)::int n from service_price_agreements where listing_id=$1', [listing])).rows[0].n
const paymentCount = async listing => (await db.query('select count(*)::int n from payments where listing_id=$1', [listing])).rows[0].n

async function fresh({ subcategory = 'I can', category = 'Services', price = 10, status = 'active' } = {}) {
  const listing = randomUUID(), chat = randomUUID()
  await db.query(`insert into listings(id,seller_id,title,description,price,status,main_category,sub_category,location)
    values($1,$2,'Home care','Home care at 10 euros per hour',$3,$4,$5,$6,'fixture')`, [listing, publisher, price, status, category, subcategory])
  await db.query("insert into chats(id,type,listing_id) values($1,'direct',$2)", [chat, listing])
  await db.query('insert into chat_participants(chat_id,user_id) values($1,$2),($1,$3)', [chat, publisher, responder])
  const request = subcategory === 'I want'
  return { listing, chat, buyer: request ? publisher : responder, seller: request ? responder : publisher }
}

async function accepted(options = {}, amount = 40, proposer = publisher) {
  const fixture = await fresh(options)
  const proposal = await propose(fixture, proposer, amount)
  const other = proposer === publisher ? responder : publisher
  const agreement = await respond(proposal.id, other, 'accept')
  return { ...fixture, agreement }
}

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    grant usage on schema auth to authenticated,service_role;
  `)
  // Exercise the actual tables, indexes and policies. Only unrelated PostGIS
  // storage/index support is substituted in the local WASM PostgreSQL fixture.
  await db.exec((await read('sql/001_init.sql')).replace('create extension if not exists postgis;', '').replace('geography(Point,4326)', 'text'))
  await db.exec((await read('sql/002_indexes_policies.sql')).replace('create index if not exists listings_location_gix on listings using gist (location);', ''))
  await db.exec(await read('sql/020_fix_rls_identity_model.sql'))
  await db.exec(`alter table chats add column listing_id uuid references listings(id);
    alter table chat_participants add column left_at timestamptz;
    alter table listings add column contact_number text`)
  for (const name of ['007_moderation_logs.sql', '010_alter_moderation_logs.sql', '004_payment_confirmations.sql', '009_milestones.sql']) await db.exec(await read(`sql/${name}`))
  const security = await read('sql/021_fix_payment_security.sql')
  await db.exec(table(security, 'payment_audit_logs'))
  await db.exec(security.split('-- Add payment audit log table')[0])
  for (const name of ['013_webhook_events.sql', '023_webhook_events_extended.sql', '024_payments_intent_unique.sql', '025_payments_transactions_disputes_milestones_columns.sql', '027_payments_open_intent_unique.sql']) await db.exec(await read(`sql/${name}`))
  await db.exec(await read('migrations/20261013232046_webhook_event_atomic_processing.sql'))
  await db.exec(await read('migrations/20261019120100_request_offer_transactions.sql'))
  await db.exec(await read('migrations/20261019120200_review_eligibility.sql'))
  await db.exec(await read('migrations/20261019120300_listing_moderation.sql'))
  await db.exec('create schema if not exists needs_private')
  // Keep the actual pre-existing trade-term guards in the integrated fixture;
  // unrelated owner image/storage RPCs require PostGIS and are tested separately.
  const ownerEditing = await read('migrations/20261019180549_owner_listing_editing.sql')
  await db.exec(ownerEditing.slice(ownerEditing.indexOf('create or replace function needs_private.listing_edit_flags'), ownerEditing.indexOf('create or replace function needs_private.listing_owner_identity')))
  await db.exec(await read('migrations/20261019183527_participant_orders.sql'))
  for (let index = 0; index < users.length; index++) {
    await db.query('insert into auth.users(id) values($1)', [users[index]])
    await db.query('insert into profiles(id,user_id) values($1,$2)', [profiles[index], users[index]])
  }
  await db.exec(await read(migration))
  await db.exec(await read(accessMigration))
})
after(async () => { await db.close() })

test('either member can propose while listing direction independently fixes the actual payer/provider', async () => {
  for (const subcategory of ['I can', 'I will', 'I want']) {
    for (const proposer of [publisher, responder]) {
      const fixture = await fresh({ subcategory })
      const proposal = await propose(fixture, proposer, 40)
      assert.equal(proposal.listing_id, fixture.listing)
      assert.equal(proposal.chat_id, fixture.chat)
      assert.equal(proposal.buyer_id, fixture.buyer)
      assert.equal(proposal.seller_id, fixture.seller)
      assert.equal(proposal.proposed_by, proposer)
      assert.equal(proposal.accepted_by, null)
      assert.equal(proposal.status, 'proposed')
      assert.equal(Number(proposal.amount), 40)
      assert.equal(proposal.currency, 'eur')
      assert.deepEqual(proposal.listing_snapshot, {
        title: 'Home care', description: 'Home care at 10 euros per hour', price: 10,
        main_category: 'Services', sub_category: subcategory, seller_id: publisher,
      })
      assert.ok(proposal.created_at)
      assert.equal(proposal.responded_at, null)
      assert.equal(proposal.checkout_started_at, null)
    }
  }
})

test('acceptance requires the other participant and records the accepted total without changing the hourly listing', async () => {
  const fixture = await fresh()
  const proposal = await propose(fixture)
  await assert.rejects(respond(proposal.id, publisher, 'accept'))
  await assert.rejects(respond(proposal.id, outsider, 'accept'))
  await assert.rejects(respond(proposal.id, users[1], 'accept'), 'Auth UUID is not a profile UUID')
  assert.equal((await agreementRow(proposal.id)).status, 'proposed')
  const agreement = await respond(proposal.id, responder, 'accept')
  assert.equal(agreement.status, 'accepted')
  assert.equal(agreement.accepted_by, responder)
  assert.ok(agreement.responded_at)
  assert.equal(Number((await db.query('select price from listings where id=$1', [fixture.listing])).rows[0].price), 10)
})

test('only the recipient rejects, only the proposer withdraws pending terms, and either party can withdraw accepted terms', async () => {
  const rejectedFixture = await fresh()
  const rejected = await propose(rejectedFixture)
  await assert.rejects(respond(rejected.id, publisher, 'reject'))
  assert.equal((await respond(rejected.id, responder, 'reject')).status, 'rejected')
  await assert.rejects(respond(rejected.id, responder, 'accept'))
  const pending = await propose(await fresh())
  await assert.rejects(respond(pending.id, responder, 'withdraw'))
  assert.equal((await respond(pending.id, publisher, 'withdraw')).status, 'withdrawn')
  await assert.rejects(respond(pending.id, responder, 'accept'))
  for (const actor of [publisher, responder]) {
    const fixture = await accepted()
    await assert.rejects(respond(fixture.agreement.id, outsider, 'withdraw'))
    assert.equal((await respond(fixture.agreement.id, actor, 'withdraw')).status, 'withdrawn')
    await assert.rejects(fund(fixture.agreement.id, fixture.buyer))
  }
})

test('compare-and-swap rejects stale proposals, including terminal latest records', async () => {
  const fixture = await fresh()
  const first = await propose(fixture)
  await assert.rejects(propose(fixture, responder, 50))
  await assert.rejects(propose(fixture, responder, 50, randomUUID()))
  const second = await propose(fixture, responder, 50, first.id)
  assert.equal((await agreementRow(first.id)).status, 'superseded')
  await assert.rejects(respond(first.id, responder, 'accept'))
  await assert.rejects(propose(fixture, publisher, 60, first.id))
  assert.equal((await agreementRow(second.id)).status, 'proposed')
  await respond(second.id, publisher, 'reject')
  await assert.rejects(propose(fixture, publisher, 60))
  await assert.rejects(propose(fixture, publisher, 60, first.id))
  const third = await propose(fixture, publisher, 60, second.id)
  assert.equal(third.status, 'proposed')
  assert.equal(Number(third.amount), 60)
  assert.equal(await agreementCount(fixture.listing), 3)
})

test('failed replacement rolls back superseding the previous proposal', async () => {
  const fixture = await fresh()
  const first = await propose(fixture)
  await db.exec('alter table service_price_agreements add constraint injected_agreement_failure check (amount <> 41) not valid')
  try { await assert.rejects(propose(fixture, responder, 41, first.id)) }
  finally { await db.exec('alter table service_price_agreements drop constraint injected_agreement_failure') }
  assert.equal((await agreementRow(first.id)).status, 'proposed')
  assert.equal(await agreementCount(fixture.listing), 1)
  assert.equal((await propose(fixture, responder, 41, first.id)).status, 'proposed')
})

test('amount validation rejects invalid numeric values before storage and accepts exact boundary amounts', async () => {
  const fixture = await fresh()
  for (const amount of [null, -1, 0, 0.49, 0.501, 40.001, 1000000, 'NaN', 'Infinity', '-Infinity']) {
    await assert.rejects(propose(fixture, publisher, amount), `Reject unsafe amount ${amount}`)
  }
  assert.equal(await agreementCount(fixture.listing), 0)
  const minimum = await propose(fixture, publisher, '0.50')
  assert.equal(Number(minimum.amount), 0.5)
  const maximum = await propose(fixture, responder, '999999.99', minimum.id)
  assert.equal(Number(maximum.amount), 999999.99)
})

test('agreement creation requires an active service and exactly its two active direct-chat participants', async () => {
  for (const mutation of ['item', 'unavailable', 'group', 'missing-member', 'third-member', 'left-member', 'wrong-listing']) {
    const fixture = await fresh()
    if (mutation === 'item') await db.query("update listings set main_category='Items',sub_category='Sell' where id=$1", [fixture.listing])
    if (mutation === 'unavailable') await db.query("update listings set status='suspended' where id=$1", [fixture.listing])
    if (mutation === 'group') await db.query("update chats set type='group' where id=$1", [fixture.chat])
    if (mutation === 'missing-member') await db.query('delete from chat_participants where chat_id=$1 and user_id=$2', [fixture.chat, responder])
    if (mutation === 'third-member') await db.query('insert into chat_participants(chat_id,user_id) values($1,$2)', [fixture.chat, outsider])
    if (mutation === 'left-member') await db.query('update chat_participants set left_at=now() where chat_id=$1 and user_id=$2', [fixture.chat, responder])
    if (mutation === 'wrong-listing') await db.query('update chats set listing_id=$1 where id=$2', [(await fresh()).listing, fixture.chat])
    await assert.rejects(propose(fixture), `Reject ${mutation}`)
    assert.equal(await agreementCount(fixture.listing), 0)
  }
  const fixture = await fresh()
  await assert.rejects(propose(fixture, outsider))
  await assert.rejects(propose({ ...fixture, chat: null }))
  await assert.rejects(propose(fixture, users[0]))
  assert.equal(await agreementCount(fixture.listing), 0)
})

test('every snapshotted listing fact is checked before acceptance and before first payment', async () => {
  const mutations = [
    ['title', 'Changed service'], ['description', 'Different work at 20 euros per hour'], ['price', 20],
    ['main_category', 'Items'], ['sub_category', 'I want'], ['seller_id', outsider],
  ]
  for (const [column, value] of mutations) {
    const fixture = await fresh()
    const proposal = await propose(fixture)
    const change = id => db.query(`update listings set ${column}=$1${column === 'main_category' ? ",sub_category='Sell'" : ''} where id=$2`, [value, id])
    await change(fixture.listing)
    await assert.rejects(respond(proposal.id, responder, 'accept'), `Reject changed ${column} before acceptance`)
    assert.equal((await agreementRow(proposal.id)).status, 'proposed')
    const ready = await accepted()
    await change(ready.listing)
    await assert.rejects(fund(ready.agreement.id, ready.buyer), `Reject changed ${column} before funding`)
    assert.equal(await paymentCount(ready.listing), 0)
    assert.equal((await agreementRow(ready.agreement.id)).checkout_started_at, null)
  }
})

test('leaving a chat or suspending its listing prevents acceptance and first checkout', async () => {
  for (const stage of ['proposed', 'accepted']) {
    for (const invalidation of ['left', 'suspended']) {
      const fixture = await fresh()
      const agreement = await propose(fixture)
      if (stage === 'accepted') await respond(agreement.id, responder, 'accept')
      if (invalidation === 'left') await db.query('update chat_participants set left_at=now() where chat_id=$1 and user_id=$2', [fixture.chat, responder])
      else await db.query("update listings set status='suspended' where id=$1", [fixture.listing])
      await assert.rejects(stage === 'accepted' ? fund(agreement.id, fixture.buyer) : respond(agreement.id, responder, 'accept'))
      assert.equal(await paymentCount(fixture.listing), 0)
    }
  }
})

test('accepted totals fund in the correct direction with a frozen EUR amount and independently calculated five-percent fee', async () => {
  for (const subcategory of ['I can', 'I will', 'I want']) {
    const fixture = await accepted({ subcategory }, 12.5, responder)
    const intent = stripeIntent()
    await assert.rejects(fund(fixture.agreement.id, fixture.seller, intent))
    await assert.rejects(fund(fixture.agreement.id, outsider, intent))
    const result = await fund(fixture.agreement.id, fixture.buyer, intent)
    assert.ok(result.payment_id)
    assert.equal(result.agreement_id, fixture.agreement.id)
    assert.equal(Number(result.amount), 12.5)
    assert.equal(Number(result.platform_fee), 0.63)
    assert.equal(result.currency, 'eur')
    const payment = await paymentRow(intent)
    assert.equal(payment.id, result.payment_id)
    assert.equal(payment.agreement_id, fixture.agreement.id)
    assert.equal(payment.listing_id, fixture.listing)
    assert.equal(payment.chat_id, fixture.chat)
    assert.equal(payment.buyer_id, fixture.buyer)
    assert.equal(payment.seller_id, fixture.seller)
    assert.equal(Number(payment.amount), 12.5)
    assert.equal(Number(payment.platform_fee), 0.63)
    assert.equal(payment.currency, 'eur')
    assert.equal(payment.status, 'requires_capture')
    assert.equal(payment.buyer_confirmed, false)
    assert.equal(payment.seller_confirmed, false)
    assert.ok((await agreementRow(fixture.agreement.id)).checkout_started_at)
  }
})

test('pending, rejected, withdrawn and superseded agreements cannot create a payment', async () => {
  for (const state of ['proposed', 'rejected', 'withdrawn', 'superseded']) {
    const fixture = await fresh()
    const agreement = await propose(fixture)
    if (state === 'rejected') await respond(agreement.id, responder, 'reject')
    if (state === 'withdrawn') await respond(agreement.id, publisher, 'withdraw')
    if (state === 'superseded') await propose(fixture, responder, 50, agreement.id)
    await assert.rejects(fund(agreement.id, fixture.buyer), `Reject ${state} agreement`)
    assert.equal(await paymentCount(fixture.listing), 0)
  }
})

test('an intent is reusable only for its original agreement and payer, with no second charge after settlement', async () => {
  const fixture = await accepted()
  const other = await accepted()
  const intent = stripeIntent()
  const first = await fund(fixture.agreement.id, fixture.buyer, intent)
  assert.deepEqual(await fund(fixture.agreement.id, fixture.buyer, intent), first)
  await assert.rejects(fund(other.agreement.id, other.buyer, intent))
  await assert.rejects(fund(fixture.agreement.id, fixture.seller, intent))
  await assert.rejects(fund(fixture.agreement.id, fixture.buyer))
  for (const status of ['completed', 'refunded', 'disputed']) {
    await db.query('update payments set status=$1,buyer_confirmed=true,seller_confirmed=true where id=$2', [status, first.payment_id])
    assert.deepEqual(await fund(fixture.agreement.id, fixture.buyer, intent), first)
    await assert.rejects(fund(fixture.agreement.id, fixture.buyer), `No second intent after ${status}`)
    await assert.rejects(retire(fixture.agreement.id, fixture.buyer, intent), `Do not retire ${status}`)
    assert.equal((await paymentRow(intent)).stripe_canceled_at, null)
  }
  assert.equal(await paymentCount(fixture.listing), 1)
  assert.equal(await paymentCount(other.listing), 0)
})

test('checkout freezes terms against responses and replacement proposals', async () => {
  const fixture = await accepted()
  await fund(fixture.agreement.id, fixture.buyer)
  for (const actor of [publisher, responder]) {
    for (const action of ['accept', 'reject', 'withdraw']) await assert.rejects(respond(fixture.agreement.id, actor, action))
    await assert.rejects(propose(fixture, actor, 50, fixture.agreement.id))
  }
  assert.equal((await agreementRow(fixture.agreement.id)).status, 'accepted')
  assert.equal(await agreementCount(fixture.listing), 1)
})

test('unpaid proposal history rejects listing deletion with the existing pause guidance', async () => {
  const fixture = await fresh()
  const proposal = await propose(fixture)
  assert.equal(await paymentCount(fixture.listing), 0)
  await assert.rejects(db.query('delete from listings where id=$1', [fixture.listing]), error => {
    assert.equal(error.code, '23503')
    assert.equal(error.message, 'This listing has activity history and cannot be deleted. Pause it instead.')
    return true
  })
  assert.equal((await agreementRow(proposal.id)).listing_id, fixture.listing)
  await respond(proposal.id, publisher, 'withdraw')
  await assert.rejects(db.query('delete from listings where id=$1', [fixture.listing]), /Pause it instead/)
  await db.query("update listings set status='suspended' where id=$1", [fixture.listing])
  assert.equal((await db.query('select status from listings where id=$1', [fixture.listing])).rows[0].status, 'suspended')
})

test('failed status alone never permits a second intent; verified cancellation retirement enables one explicit retry', async () => {
  const fixture = await accepted()
  const intent = stripeIntent(), retryIntent = stripeIntent()
  const first = await fund(fixture.agreement.id, fixture.buyer, intent)
  await db.query("update payments set status='failed' where id=$1", [first.payment_id])
  await assert.rejects(fund(fixture.agreement.id, fixture.buyer, retryIntent))
  await assert.rejects(retire(fixture.agreement.id, fixture.seller, intent))
  await assert.rejects(retire(fixture.agreement.id, fixture.buyer, 'pi_wrong_intent'))
  const other = await accepted()
  await assert.rejects(retire(other.agreement.id, other.buyer, intent))
  assert.equal((await paymentRow(intent)).stripe_canceled_at, null)
  await retire(fixture.agreement.id, fixture.buyer, intent)
  const retired = await paymentRow(intent)
  assert.equal(retired.status, 'failed')
  assert.ok(retired.stripe_canceled_at)
  assert.equal((await agreementRow(fixture.agreement.id)).checkout_started_at, null)
  const retry = await fund(fixture.agreement.id, fixture.buyer, retryIntent)
  assert.notEqual(retry.payment_id, first.payment_id)
  assert.deepEqual(await fund(fixture.agreement.id, fixture.buyer, retryIntent), retry)
  await assert.rejects(fund(fixture.agreement.id, fixture.buyer))
  assert.equal((await paymentRow(retryIntent)).stripe_canceled_at, null)
  assert.equal(await paymentCount(fixture.listing), 2)
})

test('a downstream audit failure leaves neither a payment nor a frozen agreement, and the same attempt can retry', async () => {
  const fixture = await accepted()
  const intent = stripeIntent()
  await db.exec('alter table payment_audit_logs add constraint injected_payment_failure check (false) not valid')
  try { await assert.rejects(fund(fixture.agreement.id, fixture.buyer, intent)) }
  finally { await db.exec('alter table payment_audit_logs drop constraint injected_payment_failure') }
  assert.equal(await paymentCount(fixture.listing), 0)
  assert.equal((await agreementRow(fixture.agreement.id)).checkout_started_at, null)
  const result = await fund(fixture.agreement.id, fixture.buyer, intent)
  assert.ok(result.payment_id)
  assert.equal(await paymentCount(fixture.listing), 1)
  assert.equal((await db.query('select count(*)::int n from payment_audit_logs where payment_id=$1', [result.payment_id])).rows[0].n, 1)
})

test('browser roles cannot invoke financial agreement RPCs or rewrite proposal and acceptance fields', async () => {
  const fixture = await accepted()
  const signatures = [
    'propose_service_price_agreement(uuid,uuid,uuid,numeric,uuid)',
    'respond_service_price_agreement(uuid,uuid,text)',
    'create_agreed_service_payment(uuid,uuid,text)',
    'retire_service_agreement_payment(uuid,uuid,text)',
  ]
  for (const signature of signatures) {
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, `public.${signature}`])).rows[0].allowed, false)
    }
    assert.equal((await db.query("select has_function_privilege('service_role',$1,'EXECUTE') allowed", [`public.${signature}`])).rows[0].allowed, true)
  }
  assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.service_price_agreements'::regclass")).rows[0].relrowsecurity, true)
  for (const [role, user] of [['anon', null], ['authenticated', users[0]], ['authenticated', users[2]]]) {
    await assert.rejects(as(role, user, 'select public.respond_service_price_agreement($1,$2,$3)', [fixture.agreement.id, responder, 'accept']))
    await assert.rejects(as(role, user, 'update service_price_agreements set amount=1,accepted_by=$1 where id=$2', [outsider, fixture.agreement.id]))
    await assert.rejects(as(role, user, 'delete from service_price_agreements where id=$1', [fixture.agreement.id]))
  }
  const saved = await agreementRow(fixture.agreement.id)
  assert.equal(Number(saved.amount), 40)
  assert.equal(saved.accepted_by, responder)
  assert.equal(saved.status, 'accepted')
})

test('agreement reads are server-only, including for authenticated participants', async () => {
  const fixture = await accepted()
  for (const user of [users[0], users[1], users[2], publisher]) {
    await assert.rejects(as('authenticated', user, 'select id from service_price_agreements where id=$1', [fixture.agreement.id]), /permission denied/)
  }
  await assert.rejects(as('anon', null, 'select id from service_price_agreements where id=$1', [fixture.agreement.id]), /permission denied/)
  const server = await as('service_role', null, 'select id from service_price_agreements where id=$1', [fixture.agreement.id])
  assert.deepEqual(server.rows, [{ id: fixture.agreement.id }])
  assert.equal((await db.query("select count(*)::int n from pg_policies where schemaname='public' and tablename='service_price_agreements'")).rows[0].n, 1)
})

test('authenticated participants cannot rebind a payment or forge its Stripe cancellation marker', async () => {
  const fixture = await accepted()
  const other = await accepted()
  const intent = stripeIntent()
  const payment = await fund(fixture.agreement.id, fixture.buyer, intent)
  for (const user of [users[0], users[1]]) {
    await assert.rejects(as('authenticated', user, 'update payments set agreement_id=$1 where id=$2', [other.agreement.id, payment.payment_id]), /Only your own confirmation/)
    await assert.rejects(as('authenticated', user, 'update payments set agreement_id=null where id=$1', [payment.payment_id]), /Only your own confirmation/)
    await assert.rejects(as('authenticated', user, 'update payments set stripe_canceled_at=now() where id=$1', [payment.payment_id]), /Only your own confirmation/)
  }
  const unchanged = await paymentRow(intent)
  assert.equal(unchanged.agreement_id, fixture.agreement.id)
  assert.equal(unchanged.stripe_canceled_at, null)
  await assert.rejects(fund(fixture.agreement.id, fixture.buyer))
  assert.equal(await paymentCount(fixture.listing), 1)
})

test('price acceptance never substitutes for Stripe authorization or either delivery confirmation', async () => {
  const fixture = await accepted()
  const intent = stripeIntent()
  const payment = await fund(fixture.agreement.id, fixture.buyer, intent)
  await assert.rejects(as('authenticated', users[1], 'update payments set buyer_confirmed=true where id=$1', [payment.payment_id]), /cannot be confirmed/)
  await assert.rejects(as('authenticated', users[0], 'update payments set seller_confirmed=true where id=$1', [payment.payment_id]), /cannot be confirmed/)
  await rpc('process_stripe_webhook_event($1::jsonb,$2,$3)', [JSON.stringify({
    id: `evt_${randomUUID()}`, type: 'payment_intent.amount_capturable_updated',
    data: { object: { id: intent, amount: 4000, amount_capturable: 4000, currency: 'eur' } },
  }), intent, 'agreement-test'])
  await as('authenticated', users[1], 'update payments set buyer_confirmed=true where id=$1', [payment.payment_id])
  await as('authenticated', users[0], 'update payments set seller_confirmed=true where id=$1', [payment.payment_id])
  const verified = await paymentRow(intent)
  assert.equal(verified.buyer_confirmed, true)
  assert.equal(verified.seller_confirmed, true)
  assert.equal(verified.status, 'requires_capture')
})

test('all snapshotted listing fields stay locked during an unretired authorization, failure or dispute', async () => {
  const mutations = [
    ['title', 'Changed service'], ['description', 'Different work at 20 euros per hour'], ['price', 20],
    ['main_category', 'Items'], ['sub_category', 'I want'], ['seller_id', outsider],
  ]
  for (const status of ['requires_capture', 'failed', 'disputed']) {
    const fixture = await accepted()
    const intent = stripeIntent()
    const payment = await fund(fixture.agreement.id, fixture.buyer, intent)
    await db.query('update payments set status=$1 where id=$2', [status, payment.payment_id])
    for (const [column, value] of mutations) {
      await assert.rejects(db.query(`update listings set ${column}=$1 where id=$2`, [value, fixture.listing]), `${status} without verified cancellation locks ${column}`)
    }
    const listing = (await db.query('select title,description,price,main_category,sub_category,seller_id from listings where id=$1', [fixture.listing])).rows[0]
    assert.equal(listing.title, fixture.agreement.listing_snapshot.title)
    assert.equal(listing.description, fixture.agreement.listing_snapshot.description)
    assert.equal(Number(listing.price), 10)
    assert.equal(listing.main_category, 'Services')
    assert.equal(listing.sub_category, 'I can')
    assert.equal(listing.seller_id, publisher)
    assert.equal((await paymentRow(intent)).stripe_canceled_at, null)
  }
})

test('verified cancellation permits withdrawal, listing edits and a newly accepted total without rewriting history', async () => {
  const fixture = await accepted()
  const oldIntent = stripeIntent()
  const oldPayment = await fund(fixture.agreement.id, fixture.buyer, oldIntent)
  await db.query("update payments set status='failed' where id=$1", [oldPayment.payment_id])
  await assert.rejects(db.query('update listings set price=20 where id=$1', [fixture.listing]))
  await retire(fixture.agreement.id, fixture.buyer, oldIntent)
  assert.equal((await agreementRow(fixture.agreement.id)).checkout_started_at, null)
  const withdrawn = await respond(fixture.agreement.id, responder, 'withdraw')
  assert.equal(withdrawn.status, 'withdrawn')
  await db.query("update listings set title='Extended home care',description='Extended home care at 20 euros per hour',price=20 where id=$1", [fixture.listing])
  await assert.rejects(propose(fixture, publisher, 60))
  const replacement = await propose(fixture, publisher, 60, fixture.agreement.id)
  assert.notEqual(replacement.id, fixture.agreement.id)
  assert.equal(replacement.listing_snapshot.title, 'Extended home care')
  assert.equal(replacement.listing_snapshot.price, 20)
  await respond(replacement.id, responder, 'accept')
  const newIntent = stripeIntent()
  const newPayment = await fund(replacement.id, fixture.buyer, newIntent)
  assert.equal(Number(newPayment.amount), 60)
  assert.equal(Number(newPayment.platform_fee), 3)
  assert.notEqual(newPayment.payment_id, oldPayment.payment_id)
  const history = await agreementRow(fixture.agreement.id)
  assert.equal(Number(history.amount), 40)
  assert.deepEqual(history.listing_snapshot, fixture.agreement.listing_snapshot)
  assert.equal(Number((await paymentRow(oldIntent)).amount), 40)
  assert.equal((await paymentRow(oldIntent)).agreement_id, fixture.agreement.id)
  assert.equal((await paymentRow(newIntent)).agreement_id, replacement.id)
  assert.equal(await paymentCount(fixture.listing), 2)
})

test('settlement releases listing edits while the original agreed amount and snapshot remain historical', async () => {
  for (const status of ['completed', 'refunded']) {
    const fixture = await accepted()
    const payment = await fund(fixture.agreement.id, fixture.buyer)
    await db.query('update payments set status=$1,buyer_confirmed=true,seller_confirmed=true where id=$2', [status, payment.payment_id])
    await db.query("update listings set title='Updated service',description='Updated service details',price=30 where id=$1", [fixture.listing])
    const history = await agreementRow(fixture.agreement.id)
    assert.equal(Number(history.amount), 40)
    assert.deepEqual(history.listing_snapshot, fixture.agreement.listing_snapshot)
    assert.equal(Number((await db.query('select price from listings where id=$1', [fixture.listing])).rows[0].price), 30)
  }
})

test('reapplying both migrations preserves agreement/payment state and server-only access', async () => {
  const fixture = await accepted()
  const intent = stripeIntent()
  const payment = await fund(fixture.agreement.id, fixture.buyer, intent)
  const pendingFixture = await fresh()
  const pending = await propose(pendingFixture, responder, 55)
  const beforeAgreement = await agreementRow(fixture.agreement.id)
  const beforePayment = await paymentRow(intent)
  const beforePending = await agreementRow(pending.id)
  await db.exec(await read(migration))
  await db.exec(await read(accessMigration))
  await db.exec(await read(accessMigration))
  assert.deepEqual(await agreementRow(fixture.agreement.id), beforeAgreement)
  assert.deepEqual(await paymentRow(intent), beforePayment)
  assert.deepEqual(await agreementRow(pending.id), beforePending)
  assert.deepEqual(await fund(fixture.agreement.id, fixture.buyer, intent), payment)
  assert.equal(await paymentCount(fixture.listing), 1)
  const signatures = [
    'propose_service_price_agreement(uuid,uuid,uuid,numeric,uuid)',
    'respond_service_price_agreement(uuid,uuid,text)',
    'create_agreed_service_payment(uuid,uuid,text)',
    'retire_service_agreement_payment(uuid,uuid,text)',
  ]
  for (const signature of signatures) {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const permission = await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, `public.${signature}`])
      assert.equal(permission.rows[0].allowed, role === 'service_role')
    }
  }
  assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.service_price_agreements'::regclass")).rows[0].relrowsecurity, true)
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const permission = await db.query("select has_table_privilege($1,'public.service_price_agreements','SELECT') allowed", [role])
    assert.equal(permission.rows[0].allowed, role === 'service_role')
  }
  await assert.rejects(as('authenticated', users[2], 'select id from service_price_agreements where id=$1', [fixture.agreement.id]), /permission denied/)
})
