import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const users = Array.from({ length: 3 }, () => randomUUID())
const profiles = Array.from({ length: 3 }, () => randomUUID())
const [publisher, responder] = profiles
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
const agreementRow = async id => (await db.query('select * from service_price_agreements where id=$1', [id])).rows[0]

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
  await db.exec(await read('sql/011_feature_flags.sql'))
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
  await db.exec(await read('migrations/20261014085831_payment_dispute_workflow.sql'))
  await db.exec(await read('migrations/20261019120100_request_offer_transactions.sql'))
  await db.exec(await read('migrations/20261019120200_review_eligibility.sql'))
  await db.exec(await read('migrations/20261019120300_listing_moderation.sql'))
  await db.exec('create schema if not exists needs_private')
  // Keep the actual pre-existing trade-term guards in the integrated fixture;
  // unrelated owner image/storage RPCs require PostGIS and are tested separately.
  const ownerEditing = await read('migrations/20261019180549_owner_listing_editing.sql')
  await db.exec(ownerEditing.slice(ownerEditing.indexOf('create or replace function needs_private.listing_edit_flags'), ownerEditing.indexOf('create or replace function needs_private.listing_owner_identity')))
  await db.exec(await read('migrations/20261019183527_participant_orders.sql'))
  await db.exec('grant select,update on public.milestones to authenticated')
  for (let index = 0; index < users.length; index++) {
    await db.query('insert into auth.users(id) values($1)', [users[index]])
    await db.query('insert into profiles(id,user_id) values($1,$2)', [profiles[index], users[index]])
  }
  await db.exec(await read(migration))
  await db.exec(await read(accessMigration))
  await db.exec(await read('migrations/20261026232843_escrow_authorization_lifecycle.sql'))
})
after(async () => { await db.close() })

let observation = Date.now() - 60_000
const observed = () => new Date(observation += 10).toISOString()
const future = hours => new Date(Date.now() + hours * 3_600_000).toISOString()
const authUser = profile => users[profiles.indexOf(profile)]
const getPayment = async id => (await db.query('select * from payments where id=$1', [id])).rows[0]
const view = (p, user = authUser(p.buyer)) => rpc('get_order_for_user($1,$2)', [p.id, user])
const confirmOrder = (p, user = authUser(p.buyer)) => rpc('confirm_order($1,$2)', [p.id, user])
const capture = (p, user = authUser(p.buyer)) => rpc('claim_order_capture($1,$2)', [p.id, user])
const cancelRequest = (p, user = authUser(p.buyer), expected = null, reason = 'We agreed to cancel the work') => rpc('request_order_cancellation($1,$2,$3,$4)', [p.id, user, expected, reason])
const cancelRespond = (p, request, action, user = authUser(p.seller)) => rpc('respond_order_cancellation($1,$2,$3,$4)', [p.id, user, request, action])
const cancelClaim = (p, request, user = authUser(p.buyer)) => rpc('claim_order_cancellation($1,$2,$3)', [p.id, user, request])
const complaint = p => rpc('open_payment_complaint($1,$2)', [p.id, p.buyer])
const count = async (sql, parameters = []) => Number((await db.query(sql, parameters)).rows[0].n)
async function snapshot(p, status = 'requires_capture', options = {}) {
  return rpc('reconcile_order_provider($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [
    p.id, options.intent ?? p.intent, status, options.amount ?? 4000, options.currency ?? 'eur',
    options.capturable ?? (status === 'requires_capture' ? 4000 : 0), options.received ?? (status === 'succeeded' ? 4000 : 0),
    options.fee ?? 200, Object.hasOwn(options, 'deadline') ? options.deadline : future(72), options.read ?? observed(), options.lease ?? null,
  ])
}
async function fixed({ milestone = false, authorize = true, agreement = false } = {}) {
  const fixture = agreement ? await accepted() : await fresh()
  const intent = stripeIntent()
  let id = randomUUID(), mid = null
  if (agreement) id = (await fund(fixture.agreement.id, fixture.buyer, intent)).payment_id
  else {
    if (milestone) {
      mid = randomUUID()
      await db.query(`insert into milestones(id,chat_id,listing_id,buyer_id,seller_id,title,amount,status,stripe_payment_intent)
        values($1,$2,$3,$4,$5,'Care visit',40,'pending',$6)`, [mid, fixture.chat, fixture.listing, fixture.buyer, fixture.seller, intent])
    }
    await db.query(`insert into payments(id,listing_id,buyer_id,seller_id,amount,platform_fee,stripe_payment_intent,status,currency,chat_id,milestone_id)
      values($1,$2,$3,$4,40,2,$5,'requires_capture','eur',$6,$7)`, [id, fixture.listing, fixture.buyer, fixture.seller, intent, fixture.chat, mid])
  }
  const p = { ...fixture, id, intent, mid }
  if (authorize) await snapshot(p)
  return p
}
async function both(p) { await confirmOrder(p); await confirmOrder(p, authUser(p.seller)) }
const refund = (id, status, amount = 4000) => ({ id, status, amount, currency: 'eur' })
const refunds = (p, rows, readTime = observed()) => rpc('reconcile_order_refunds($1,$2,$3,$4::jsonb)', [p.id, p.intent, readTime, JSON.stringify(rows)])
const webhook = (p, type, obj = {}) => rpc('process_stripe_webhook_event($1::jsonb,$2,$3)', [JSON.stringify({
  id: `evt_${randomUUID()}`, type, created: Math.floor(Date.now() / 1000), data: { object: { id: p.intent, amount: 4000, application_fee_amount: 200, amount_capturable: 4000, ...obj } },
}), p.intent, null])

test('actual migration is service-only and cancellation history has no browser grants', async () => {
  const p = await fixed()
  const functions = ['request_order_cancellation', 'respond_order_cancellation', 'claim_order_cancellation', 'claim_admin_order_cancellation', 'reconcile_order_provider', 'reconcile_order_refunds', 'reconcile_order_disputes', 'claim_order_reconciliation', 'finish_order_reconciliation', 'get_order_for_user']
  for (const name of functions) {
    const permissions = (await db.query(`select has_function_privilege('anon',oid,'EXECUTE') a,has_function_privilege('authenticated',oid,'EXECUTE') u,has_function_privilege('service_role',oid,'EXECUTE') s from pg_proc where proname=$1`, [name])).rows
    assert.equal(permissions.length, 1)
    assert.deepEqual(permissions[0], { a: false, u: false, s: true })
  }
  for (const role of ['anon', 'authenticated']) await assert.rejects(as(role, authUser(p.buyer), 'select * from order_cancellations'), /permission denied/)
  await assert.rejects(view(p, users[2]), /Order not found/)
  await assert.rejects(cancelRequest(p, users[2]), /Order not found/)
  assert.equal((await as('authenticated', authUser(p.buyer), 'select get_my_order($1,$2) result', [p.id, authUser(p.buyer)])).rows[0].result.id, p.id)
})

test('verified authorization persists the actual deadline and both parties are still required', async () => {
  const p = await fixed({ authorize: false })
  assert.equal((await view(p)).authorization_state, 'unverified')
  await assert.rejects(confirmOrder(p), /cannot be confirmed/)
  const deadline = future(30)
  await snapshot(p, 'requires_capture', { deadline })
  let result = await view(p)
  assert.equal(new Date(result.authorization.expires_at).getTime(), Date.parse(deadline))
  assert.equal(result.authorization.provider_status, 'requires_capture')
  assert.ok(result.authorization.last_checked_at)
  assert.equal(result.actions.can_capture, false)
  await confirmOrder(p)
  await assert.rejects(capture(p), /Both parties/)
  await confirmOrder(p, authUser(p.seller))
  assert.equal((await capture(p)).status, 'claimed')
  assert.equal((await getPayment(p.id)).status, 'requires_capture', 'a reservation never captures money automatically')
})

test('past deadlines block API and legacy browser confirmation/capture, including a prior capture retry', async () => {
  const p = await fixed({ milestone: true })
  await both(p)
  await capture(p)
  await snapshot(p, 'requires_capture', { deadline: future(-1) })
  assert.equal((await view(p)).actions.can_capture, false)
  await assert.rejects(capture(p), /expired/)
  const other = await fixed({ milestone: true })
  await snapshot(other, 'requires_capture', { deadline: future(-1) })
  await assert.rejects(confirmOrder(other), /cannot be confirmed/)
  await assert.rejects(as('authenticated', authUser(other.buyer), 'update payments set buyer_confirmed=true where id=$1', [other.id]), /cannot be confirmed/)
  await assert.rejects(as('authenticated', authUser(other.buyer), 'update milestones set buyer_confirmed=true where id=$1', [other.mid]), /cannot be confirmed/)
  assert.equal((await getPayment(other.id)).status, 'requires_capture', 'elapsed time alone does not pretend the provider canceled')
})

test('unknown deadlines remain unknown and trigger one attention notification per participant', async () => {
  const p = await fixed({ authorize: false })
  await snapshot(p, 'requires_capture', { deadline: null })
  await snapshot(p, 'requires_capture', { deadline: null })
  const result = await view(p)
  assert.equal(result.authorization.expires_at, null)
  assert.equal(result.authorization.attention_required, true)
  assert.equal(await count("select count(*) n from notifications where payload->>'payment_id'=$1 and type='payment_attention_required'", [p.id]), 2)
})

test('24h, 1h and expiry warnings are deterministic and repeated reconciliation does not spam', async () => {
  const p = await fixed()
  for (const hours of [23, 0.5, -1]) {
    const deadline = future(hours)
    await snapshot(p, 'requires_capture', { deadline })
    await snapshot(p, 'requires_capture', { deadline })
  }
  assert.equal(await count("select count(*) n from notifications where payload->>'payment_id'=$1 and type='payment_authorization_expiring'", [p.id]), 4)
  assert.equal(await count("select count(*) n from notifications where payload->>'payment_id'=$1 and type='payment_authorization_expired'", [p.id]), 2)
})

test('provider identity, currency, fee, financial totals and monotonic read starts are validated', async () => {
  const p = await fixed()
  for (const options of [{ intent: 'pi_wrong' }, { amount: 3999 }, { fee: 199 }, { currency: 'usd' }, { capturable: 3999 }, { received: 1 }]) {
    await assert.rejects(snapshot(p, 'requires_capture', options), /snapshot does not match|totals do not match/)
  }
  const read = observed()
  await snapshot(p, 'requires_capture', { read })
  assert.deepEqual(await snapshot(p, 'canceled', { read }), { applied: false })
  assert.equal((await getPayment(p.id)).stripe_canceled_at, null)
})

test('pending cancellation blocks an already confirmed capture and only the other party can accept', async () => {
  const p = await fixed()
  await both(p)
  const requested = await cancelRequest(p)
  assert.equal(requested.cancellation.status, 'proposed')
  assert.equal(requested.actions.can_capture, false)
  await assert.rejects(capture(p), /cancellation is pending/)
  await assert.rejects(cancelRespond(p, requested.cancellation.id, 'accept', authUser(p.buyer)), /other participant/)
  await assert.rejects(cancelRespond(p, requested.cancellation.id, 'accept', users[2]), /Order not found/)
  const accepted = await cancelRespond(p, requested.cancellation.id, 'accept')
  assert.equal(accepted.cancel_pending, true)
  const claim = await cancelClaim(p, requested.cancellation.id)
  assert.equal(claim.claim_id, (await cancelClaim(p, requested.cancellation.id)).claim_id)
  assert.equal((await cancelRespond(p, requested.cancellation.id, 'accept')).cancel_pending, true)
  await assert.rejects(complaint(p), /cancellation is being reconciled/)
  await assert.rejects(cancelRespond(p, requested.cancellation.id, 'withdraw', authUser(p.buyer)), /no longer pending/)
})

test('request IDs prevent stale acceptance and rejection/withdrawal restore confirmation eligibility', async () => {
  const p = await fixed()
  const first = (await cancelRequest(p)).cancellation.id
  await assert.rejects(cancelRespond(p, first, 'reject', authUser(p.buyer)), /other participant/)
  await assert.rejects(cancelRespond(p, first, 'withdraw'), /other participant/)
  await cancelRespond(p, first, 'reject')
  assert.equal((await view(p)).actions.can_confirm, true)
  await assert.rejects(cancelRequest(p), /Cancellation changed/)
  const second = (await cancelRequest(p, authUser(p.buyer), first)).cancellation.id
  await assert.rejects(cancelRespond(p, first, 'accept'), /Cancellation changed/)
  await cancelRespond(p, second, 'withdraw', authUser(p.buyer))
  assert.equal((await view(p)).actions.can_confirm, true)
  assert.equal(await count('select count(*) n from order_cancellations where payment_id=$1', [p.id]), 2)
})

test('capture-first excludes participant and admin cancellation without clearing the capture claim', async () => {
  const p = await fixed()
  await both(p)
  const claimed = await capture(p)
  await assert.rejects(cancelRequest(p), /capture is being reconciled/)
  await assert.rejects(rpc('claim_admin_order_cancellation($1,$2,$3)', [p.id, users[2], 'Release funds after review']), /capture is being reconciled/)
  assert.equal((await getPayment(p.id)).capture_claim_id, claimed.claim_id)
})

test('mutual cancellation can release an open local complaint without deleting/resolving it', async () => {
  const p = await fixed()
  const opened = await complaint(p)
  const request = (await cancelRequest(p)).cancellation.id
  await cancelRespond(p, request, 'accept')
  await snapshot(p, 'canceled')
  const result = await view(p)
  assert.equal(result.status, 'failed')
  assert.ok(result.stripe_canceled_at)
  assert.equal(result.cancel_pending, false)
  assert.equal(result.complaint.id, opened.dispute_id)
  assert.equal(result.complaint.status, 'open')
  assert.equal((await cancelClaim(p, request)).released, true)
  assert.equal(await count("select count(*) n from notifications where payload->>'payment_id'=$1 and type='payment_canceled'", [p.id]), 2)
})

test('settled money and bank disputes cannot obtain cancellation claims', async () => {
  for (const state of ['completed', 'refunded', 'disputed']) {
    const p = await fixed()
    await both(p)
    await db.query('update payments set status=$1 where id=$2', [state, p.id])
    await assert.rejects(cancelRequest(p), /cannot be canceled/)
    await assert.rejects(rpc('claim_admin_order_cancellation($1,$2,$3)', [p.id, users[2], 'Review release']), /cannot be canceled/)
  }
  const p = await fixed()
  await db.query("insert into disputes(payment_id,stripe_dispute_id,status) values($1,'du_fixture','open')", [p.id])
  await assert.rejects(cancelRequest(p), /cannot be canceled/)
})

test('admin cancellation requires a real auth identity and reason, preserves audit and retries one claim', async () => {
  const p = await fixed()
  await assert.rejects(rpc('claim_admin_order_cancellation($1,$2,$3)', [p.id, null, 'Reason']), /identity/)
  await assert.rejects(rpc('claim_admin_order_cancellation($1,$2,$3)', [p.id, randomUUID(), 'Reason']), /identity/)
  await assert.rejects(rpc('claim_admin_order_cancellation($1,$2,$3)', [p.id, users[2], ' ']), /reason/)
  const first = await rpc('claim_admin_order_cancellation($1,$2,$3)', [p.id, users[2], 'Customer support verified release'])
  const second = await rpc('claim_admin_order_cancellation($1,$2,$3)', [p.id, users[2], 'Customer support verified release'])
  assert.equal(first.claim_id, second.claim_id)
  assert.equal(await count("select count(*) n from payment_audit_logs where payment_id=$1 and action='admin_cancellation_claimed' and metadata->>'user_id'=$2", [p.id, users[2]]), 1)
})

test('confirmed provider cancellation retires agreement locks and permits fresh terms without losing history', async () => {
  const p = await fixed({ agreement: true })
  const request = (await cancelRequest(p)).cancellation.id
  await cancelRespond(p, request, 'accept')
  await snapshot(p, 'requires_payment_method')
  assert.ok((await getPayment(p.id)).cancel_claim_id, 'a pre-confirmation state cannot release an uncertain claim')
  assert.ok((await agreementRow(p.agreement.id)).checkout_started_at)
  await snapshot(p, 'canceled')
  assert.equal((await agreementRow(p.agreement.id)).checkout_started_at, null)
  await db.query("update listings set description='Fresh care terms at 12 euros per hour' where id=$1", [p.listing])
  const next = await propose(p, p.seller, 50, p.agreement.id)
  assert.equal(next.status, 'proposed')
  assert.equal((await agreementRow(p.agreement.id)).status, 'superseded')
  assert.ok((await getPayment(p.id)).stripe_canceled_at)
})

test('snapshot and success webhook arrival orders write one canonical charge, fee and participant notifications', async () => {
  for (const webhookFirst of [false, true]) {
    const p = await fixed({ milestone: true })
    await both(p)
    if (webhookFirst) await webhook(p, 'payment_intent.succeeded')
    await snapshot(p, 'succeeded')
    await snapshot(p, 'succeeded')
    if (!webhookFirst) await webhook(p, 'payment_intent.succeeded')
    const tx = (await db.query("select amount,fee from transactions where payment_id=$1 and type='charge' and status='succeeded'", [p.id])).rows
    assert.equal(tx.length, 1)
    assert.equal(Number(tx[0].amount), 40)
    assert.equal(Number(tx[0].fee), 2)
    assert.equal((await getPayment(p.id)).status, 'completed')
    assert.equal((await db.query('select status from milestones where id=$1', [p.mid])).rows[0].status, 'completed')
    assert.equal(await count("select count(*) n from notifications where payload->>'payment_id'=$1 and type in('payment_sent','payment_completed')", [p.id]), 2)
  }
})

test('provider snapshots cannot downgrade captured/refunded/disputed money or resurrect a canceled intent', async () => {
  for (const state of ['completed', 'refunded', 'disputed']) {
    const p = await fixed()
    await snapshot(p, 'succeeded')
    await db.query('update payments set status=$1 where id=$2', [state, p.id])
    assert.deepEqual(await snapshot(p, 'canceled'), { applied: false })
    assert.equal((await getPayment(p.id)).status, state)
  }
  const canceled = await fixed()
  await snapshot(canceled, 'canceled')
  assert.deepEqual(await snapshot(canceled), { applied: false })
  assert.equal((await getPayment(canceled.id)).status, 'failed')
})

test('reconciliation queue leases bounded rows, avoids duplicate claims and ignores stale lease finishes', async () => {
  await db.exec("update payments set reconciliation_next_at=now()+interval '1 day'")
  const a = await fixed(), b = await fixed()
  await db.query('update payments set reconciliation_next_at=now() where id=any($1::uuid[])', [[a.id, b.id]])
  const first = await rpc('claim_order_reconciliation($1,$2)', [1, 120])
  const second = await rpc('claim_order_reconciliation($1,$2)', [1, 120])
  assert.equal(first.length, 1); assert.equal(second.length, 1)
  assert.notEqual(first[0].payment_id, second[0].payment_id)
  assert.deepEqual(await rpc('claim_order_reconciliation($1,$2)', [1, 120]), [])
  const leased = first[0].payment_id === a.id ? a : b
  assert.deepEqual(await snapshot(leased, 'requires_capture', { lease: randomUUID() }), { applied: false })
  assert.equal(await rpc('finish_order_reconciliation($1,$2,$3)', [leased.id, randomUUID(), null]), false)
  assert.deepEqual(await snapshot(leased, 'requires_capture', { lease: first[0].lease_id }), { applied: true })
  assert.equal(await rpc('finish_order_reconciliation($1,$2,$3)', [leased.id, first[0].lease_id, null]), true)
  assert.equal((await getPayment(leased.id)).reconciliation_lease_id, null)
  await assert.rejects(rpc('claim_order_reconciliation($1,$2)', [101, 120]), /Invalid/)
})

test('worker failure/backoff retains financial claims and raises deduplicated attention after repeated failures', async () => {
  await db.exec("update payments set reconciliation_next_at=now()+interval '1 day'")
  const p = await fixed()
  const request = (await cancelRequest(p)).cancellation.id
  await cancelRespond(p, request, 'accept')
  const claim = (await getPayment(p.id)).cancel_claim_id
  for (let index = 0; index < 4; index++) {
    await db.query('update payments set reconciliation_next_at=now() where id=$1', [p.id])
    const [lease] = await rpc('claim_order_reconciliation($1,$2)', [1, 30])
    assert.equal(lease.payment_id, p.id)
    assert.equal(await rpc('finish_order_reconciliation($1,$2,$3)', [p.id, lease.lease_id, 'provider_timeout']), true)
  }
  const row = await getPayment(p.id)
  assert.equal(row.cancel_claim_id, claim)
  assert.equal(row.reconciliation_failures, 4)
  assert.equal(row.attention_required, true)
  assert.equal(await count("select count(*) n from notifications where payload->>'payment_id'=$1 and payload->>'reason_code'='reconciliation_failed'", [p.id]), 2)
})

test('canonical refund snapshot recovers missing webhooks once and never creates a fake Stripe event', async () => {
  const p = await fixed()
  await snapshot(p, 'succeeded')
  const before = await count('select count(*) n from webhook_events')
  const id = `re_${randomUUID().replaceAll('-', '')}`
  await refunds(p, [refund(id, 'succeeded')]); await refunds(p, [refund(id, 'succeeded')])
  assert.equal((await getPayment(p.id)).status, 'refunded')
  assert.equal(await count('select count(*) n from transactions where stripe_refund_id=$1', [id]), 1)
  assert.equal(await count('select count(*) n from webhook_events'), before)
})

test('refund observations are monotonic and reject invalid identity, duplicate or over-refund amounts', async () => {
  const p = await fixed(), other = await fixed()
  await snapshot(p, 'succeeded'); await snapshot(other, 'succeeded')
  const id = `re_${randomUUID().replaceAll('-', '')}`, read = observed()
  await refunds(p, [refund(id, 'pending', 2000)], read)
  assert.deepEqual(await refunds(p, [refund(id, 'succeeded', 2000)], read), { applied: false })
  await assert.rejects(refunds(other, [refund(id, 'pending', 2000)]), /identity or amount/)
  await assert.rejects(refunds(p, [refund(id, 'pending', 3000)]), /identity or amount/)
  await assert.rejects(refunds(p, [refund('re_dup', 'pending'), refund('re_dup', 'pending')]), /Duplicate/)
  await assert.rejects(refunds(p, [refund('re_excess', 'succeeded', 4001)]), /Invalid canonical/)
})

test('refund success cannot regress to pending but a later failed refund reverses totals and retains attention on refresh', async () => {
  const p = await fixed()
  await snapshot(p, 'succeeded')
  const id = `re_${randomUUID().replaceAll('-', '')}`
  await refunds(p, [refund(id, 'succeeded')])
  await refunds(p, [refund(id, 'pending')])
  assert.equal((await getPayment(p.id)).status, 'refunded')
  await refunds(p, [refund(id, 'failed')])
  assert.equal((await getPayment(p.id)).status, 'completed')
  assert.equal((await getPayment(p.id)).attention_required, true)
  await snapshot(p, 'succeeded'); await refunds(p, [refund(id, 'failed')])
  assert.equal((await getPayment(p.id)).attention_required, true)
  assert.equal(await count("select count(*) n from notifications where payload->>'payment_id'=$1 and type='payment_refund_failed'", [p.id]), 2)
})

test('refund reconciliation preserves bank-dispute state and stale webhook data cannot undo its snapshot', async () => {
  const p = await fixed()
  await snapshot(p, 'succeeded')
  await db.query("insert into disputes(payment_id,stripe_dispute_id,status) values($1,'du_refund_fixture','open')", [p.id])
  await db.query("update payments set status='disputed' where id=$1", [p.id])
  const id = `re_${randomUUID().replaceAll('-', '')}`
  await refunds(p, [refund(id, 'succeeded')])
  assert.equal((await getPayment(p.id)).status, 'disputed')
  const e = { id: `evt_${randomUUID()}`, type: 'refund.updated', created: Math.floor((Date.now() - 120000) / 1000) }
  await rpc('process_stripe_refund_event($1::jsonb,$2,$3::jsonb,$4)', [JSON.stringify(e), p.intent, JSON.stringify([refund(id, 'pending')]), null])
  assert.equal((await db.query('select status from transactions where stripe_refund_id=$1', [id])).rows[0].status, 'succeeded')
  assert.equal((await getPayment(p.id)).status, 'disputed')
})

test('irreversible provider success is recorded without inventing participant confirmations', async () => {
  const p = await fixed({ milestone: true })
  await snapshot(p, 'succeeded')
  const result = await view(p)
  assert.equal(result.status, 'completed')
  assert.equal(result.buyer_confirmed, false)
  assert.equal(result.seller_confirmed, false)
  assert.equal(result.authorization.attention_required, true)
  const milestone = (await db.query('select * from milestones where id=$1', [p.mid])).rows[0]
  assert.equal(milestone.status, 'completed')
  assert.equal(milestone.buyer_confirmed, false)
  assert.equal(milestone.seller_confirmed, false)
  assert.ok(milestone.provider_settled_at)
  assert.equal(await count("select count(*) n from notifications where payload->>'payment_id'=$1 and payload->>'reason_code'='settled_without_confirmations'", [p.id]), 2)
  const unfunded = await fixed({ milestone: true, authorize: false })
  for (const statement of ["update payments set provider_status='succeeded',provider_checked_at=now(),status='completed' where id=$1", 'update payments set cancel_claim_id=gen_random_uuid() where id=$1', 'update payments set authorization_expires_at=now() where id=$1']) {
    await assert.rejects(as('authenticated', authUser(unfunded.buyer), statement, [unfunded.id]), /Only your own confirmation/)
  }
  await assert.rejects(as('authenticated', authUser(unfunded.buyer), "update milestones set provider_settled_at=now(),status='completed' where id=$1", [unfunded.mid]), /Only your own confirmation/)
  await assert.rejects(capture(unfunded), /Both parties/)
})

test('expired reconciliation ownership cannot apply or finish and the next worker obtains a fresh lease', async () => {
  await db.exec("update payments set reconciliation_next_at=now()+interval '1 day'")
  const p = await fixed()
  await db.query('update payments set reconciliation_next_at=now() where id=$1', [p.id])
  const [old] = await rpc('claim_order_reconciliation($1,$2)', [1, 30])
  await db.query("update payments set reconciliation_lease_until=now()-interval '1 second' where id=$1", [p.id])
  assert.deepEqual(await snapshot(p, 'requires_capture', { lease: old.lease_id }), { applied: false })
  assert.equal(await rpc('finish_order_reconciliation($1,$2,$3)', [p.id, old.lease_id, null]), false)
  const [next] = await rpc('claim_order_reconciliation($1,$2)', [1, 30])
  assert.notEqual(next.lease_id, old.lease_id)
  assert.equal(await rpc('finish_order_reconciliation($1,$2,$3)', [p.id, old.lease_id, null]), false)
})

const disputeSnapshot = (p, disputes, read = observed()) => rpc('reconcile_order_disputes($1,$2,$3,$4::jsonb)', [p.id, p.intent, read, JSON.stringify(disputes)])
const bankDispute = (id, status) => ({ id, status, reason: 'fraudulent', amount: 4000, currency: 'eur' })
test('missing bank-dispute webhooks are recovered with monotonic snapshots and terminal history', async () => {
  const p = await fixed()
  await both(p); await snapshot(p, 'succeeded')
  const id = `du_${randomUUID().replaceAll('-', '')}`, time = observed()
  await disputeSnapshot(p, [bankDispute(id, 'needs_response')], time)
  assert.equal((await getPayment(p.id)).status, 'disputed')
  assert.deepEqual(await disputeSnapshot(p, [bankDispute(id, 'won')], time), { applied: false })
  await disputeSnapshot(p, [bankDispute(id, 'won')])
  assert.equal((await getPayment(p.id)).status, 'completed')
  await disputeSnapshot(p, [bankDispute(id, 'under_review')])
  assert.equal((await getPayment(p.id)).status, 'completed')
  const rows = (await db.query('select status from disputes where payment_id=$1 and stripe_dispute_id=$2', [p.id, id])).rows
  assert.deepEqual(rows, [{ status: 'won' }])
  assert.equal(await count("select count(*) n from notifications where payload->>'payment_id'=$1 and type in('dispute_opened','dispute_resolved')", [p.id]), 4)
})

test('closed-before-open dispute snapshots preserve losses and coexist with the actual webhook RPC', async () => {
  for (const status of ['lost', 'won', 'warning_closed', 'prevented']) {
    const p = await fixed()
    await both(p); await snapshot(p, 'succeeded')
    const id = `du_${randomUUID().replaceAll('-', '')}`
    await disputeSnapshot(p, [bankDispute(id, status)])
    await webhook(p, 'charge.dispute.created', { id, status: 'needs_response' })
    await webhook(p, 'charge.dispute.closed', { id, status })
    await disputeSnapshot(p, [bankDispute(id, 'needs_response')])
    assert.equal((await getPayment(p.id)).status, status === 'lost' ? 'refunded' : 'completed')
    assert.equal(await count('select count(*) n from disputes where stripe_dispute_id=$1', [id]), 1)
    assert.equal(await count("select count(*) n from notifications where payload->>'payment_id'=$1 and type='dispute_resolved'", [p.id]), 2)
  }
})

test('bank-dispute snapshots cannot alter other payments, local complaints or fully refunded outcomes', async () => {
  const p = await fixed(), other = await fixed()
  await both(p); await both(other)
  const local = await complaint(p)
  await snapshot(p, 'succeeded'); await snapshot(other, 'succeeded')
  const id = `du_${randomUUID().replaceAll('-', '')}`
  await disputeSnapshot(p, [bankDispute(id, 'needs_response')])
  await assert.rejects(disputeSnapshot(other, [bankDispute(id, 'needs_response')]), /another payment/)
  await assert.rejects(disputeSnapshot(p, [{ ...bankDispute('du_invalid', 'won'), currency: 'invalid' }]), /Invalid canonical/)
  assert.equal((await db.query('select status from disputes where id=$1', [local.dispute_id])).rows[0].status, 'open')
  await refunds(p, [refund(`re_${randomUUID().replaceAll('-', '')}`, 'succeeded')])
  assert.equal((await getPayment(p.id)).status, 'disputed')
  await disputeSnapshot(p, [bankDispute(id, 'won')])
  assert.equal((await getPayment(p.id)).status, 'refunded')
})

test('capture response racing provider reconciliation acknowledges terminal truth without releasing another live claim', async () => {
  for (const status of ['succeeded', 'canceled']) {
    const p = await fixed()
    await both(p)
    const claim = await capture(p)
    await snapshot(p, status)
    assert.equal((await getPayment(p.id)).capture_claim_id, null)
    await rpc('resolve_order_capture($1,$2,$3)', [p.id, claim.claim_id, status === 'succeeded' ? 'captured' : 'not_captured'])
    assert.equal((await getPayment(p.id)).status, status === 'succeeded' ? 'completed' : 'failed')
  }
  const active = await fixed()
  await both(active)
  const claim = await capture(active)
  await assert.rejects(rpc('resolve_order_capture($1,$2,$3)', [active.id, randomUUID(), 'not_captured']), /does not match/)
  assert.equal((await getPayment(active.id)).capture_claim_id, claim.claim_id)
})

test('partial and FX bank losses preserve their actual amount/currency and never pretend the full purchase was refunded', async () => {
  for (const [amount, currency] of [[2000, 'eur'], [4500, 'usd']]) {
    for (const webhookFirst of [false, true]) {
      const p = await fixed()
      await both(p); await snapshot(p, 'succeeded')
      const id = `du_${randomUUID().replaceAll('-', '')}`
      const record = { ...bankDispute(id, 'lost'), amount, currency }
      if (webhookFirst) await webhook(p, 'charge.dispute.closed', record)
      await disputeSnapshot(p, [record])
      if (!webhookFirst) await webhook(p, 'charge.dispute.closed', record)
      await snapshot(p, 'succeeded'); await refunds(p, [])
      const row = await getPayment(p.id)
      assert.equal(row.status, 'disputed')
      assert.equal(row.attention_required, true)
      const stored = (await db.query('select amount,currency,status from disputes where stripe_dispute_id=$1', [id])).rows[0]
      assert.equal(Number(stored.amount), amount / 100)
      assert.equal(stored.currency, currency)
      assert.equal(stored.status, 'lost')
      assert.equal(await count("select count(*) n from notifications where payload->>'payment_id'=$1 and payload->>'reason_code'='partial_or_currency_dispute_loss'", [p.id]), 2)
    }
  }
})

test('late API authorization and success webhook cannot resurrect a provider-canceled payment', async () => {
  const p = await fixed()
  const startedBeforeCancellation = observed()
  await webhook(p, 'payment_intent.canceled', { amount_capturable: 0 })
  assert.equal((await getPayment(p.id)).status, 'failed')
  assert.deepEqual(await snapshot(p, 'requires_capture', { read: startedBeforeCancellation }), { applied: false })
  assert.equal((await getPayment(p.id)).status, 'failed')
  await snapshot(p, 'canceled')
  await assert.rejects(webhook(p, 'payment_intent.succeeded'), /cannot be resurrected/)
  assert.ok((await getPayment(p.id)).stripe_canceled_at)
})
