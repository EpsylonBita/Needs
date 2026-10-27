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
  await db.exec(await read('migrations/20261027104647_escrow_dispute_canonical_corrections.sql'))
  await db.exec(await read('migrations/20261027105222_escrow_admin_approved_recovery.sql'))
  await db.exec(await read('migrations/20261027111542_escrow_recovery_settlement_currency.sql'))
  await db.exec(await read('migrations/20261027113829_payment_transaction_currencies.sql'))
  await db.exec(await read('migrations/20261027145521_escrow_capture_webhook_claim_resolution.sql'))
  await db.exec(await read('migrations/20261027145611_preserve_financial_review_attention.sql'))
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

async function recoverable() {
  const p = await fixed(); await both(p); await capture(p)
  await webhook(p, 'payment_intent.succeeded', { status: 'succeeded', capture_method: 'manual', currency: 'eur',
    amount_received: 4000, amount_capturable: 0, metadata: { listing_id: p.listing, buyer_profile_id: p.buyer, seller_profile_id: p.seller } })
  await snapshot(p, 'succeeded')
  assert.equal((await getPayment(p.id)).capture_claim_id, null)
  const disputeId = `du_${randomUUID().replaceAll('-', '')}`
  await rpc('reconcile_order_disputes($1,$2,$3,$4::jsonb)', [p.id, p.intent, observed(), JSON.stringify([{ id: disputeId, amount: 4000, currency: 'eur', status: 'lost' }])])
  return { ...p, disputeId }
}
const approval = p => ({ platformId: 'acct_platform', livemode: false, intentId: p.intent, chargeId: `ch_${p.id.replaceAll('-', '')}`,
  disputeId: p.disputeId, transferId: `tr_${p.id.replaceAll('-', '')}`, accountId: 'acct_originalSeller', feeId: `fee_${p.id.replaceAll('-', '')}`,
  destinationPaymentId: `py_${p.id.replaceAll('-', '')}`, originalAmountMinor: 4000, originalCurrency: 'eur', originalRequestedFeeMinor: 200,
  originalFeeAmountMinor: 200, originalFeeCurrency: 'eur',
  grossAmountMinor: 4000, feeAmountMinor: 200, currency: 'eur', disputeStatus: 'lost', checkedAt: new Date().toISOString(), version: 'a'.repeat(64) })
const approve = (p, snapshot = approval(p), version = snapshot.version) => rpc('claim_payment_recovery($1,$2,$3,$4,$5::jsonb)', [p.id, users[2], version, 'Administrator verified the full bank loss.', JSON.stringify(snapshot)])
const finishRecovery = (r, status, reversal = null, code = null, time = new Date().toISOString()) => rpc('record_payment_recovery($1,$2,$3,$4,$5,$6,$7,$8)',
  [r.id, status, reversal, code, time, status === 'completed' ? `fr_${r.id.replaceAll('-', '')}` : null,
    status === 'completed' ? r.fee_amount_minor : null, status === 'completed' ? r.currency : null])
const permit = (r, platform = r.stripe_platform_id, mode = r.livemode, lease = null) => rpc('authorize_payment_recovery_attempt($1,$2,$3,$4)', [r.id, platform, mode, lease])


const disputeSnapshot = (p, status) => rpc('reconcile_order_disputes($1,$2,$3,$4::jsonb)',
  [p.id, p.intent, observed(), JSON.stringify([{ id: p.disputeId, amount: 4000, currency: 'eur', status }])])
async function workerRead(p, bankStatus = 'won') {
  await snapshot(p, 'succeeded')
  await disputeSnapshot(p, bankStatus)
  await refunds(p, [])
}
const recoveryLedger = async p => (await db.query('select * from payment_recovery_ledger where payment_id=$1', [p.id])).rows
const attentionNotices = p => count("select count(*) n from notifications where payload->>'payment_id'=$1 and payload->>'reason_code'='bank_dispute_late_win_settlement_review'", [p.id])

test('late bank win keeps financial review attention after repeated worker reads without a recovery', async () => {
  const p = await recoverable()
  await disputeSnapshot(p, 'won')
  assert.equal((await getPayment(p.id)).attention_required, true)
  for (let i = 0; i < 3; i++) {
    await workerRead(p)
    const payment = await getPayment(p.id)
    assert.equal(payment.attention_required, true, 'Canonical success must not silently resolve a late-win financial review.')
    assert.equal(payment.status, 'completed'); assert.equal(payment.refunded_at, null)
  }
  assert.equal(await attentionNotices(p), 2)
  assert.equal(await count("select count(*) n from transactions where payment_id=$1 and type='refund'", [p.id]), 0)
})

test('completed seller recovery and late-win ledger remain unchanged during repeated canonical reads', async () => {
  const p = await recoverable(), claim = await approve(p)
  await finishRecovery(claim, 'completed', `trr_${p.id.replaceAll('-', '')}`)
  const before = await recoveryLedger(p)
  await disputeSnapshot(p, 'won')
  for (let i = 0; i < 3; i++) {
    await workerRead(p)
    assert.equal((await getPayment(p.id)).attention_required, true)
  }
  assert.deepEqual(await recoveryLedger(p), before)
  assert.equal(await attentionNotices(p), 2)
  assert.equal((await permit(claim)).allowed, false)
  assert.equal(await count("select count(*) n from transactions where payment_id=$1 and type='refund'", [p.id]), 0)
  // An out-of-order lost response after the established correction cannot
  // downgrade the decision or dismiss the required settlement review.
  await workerRead(p, 'lost')
  assert.equal((await db.query('select status from disputes where payment_id=$1', [p.id])).rows[0].status, 'won')
  assert.equal((await getPayment(p.id)).attention_required, true)
  assert.deepEqual(await recoveryLedger(p), before)
})

test('provider-accepted reversal racing a bank win stays flagged before the correction webhook arrives', async () => {
  const p = await recoverable(), claim = await approve(p)
  await finishRecovery(claim, 'completed', `trr_${p.id.replaceAll('-', '')}`, 'late_win_after_recovery')
  await workerRead(p, 'lost')
  assert.equal((await getPayment(p.id)).attention_required, true)
  assert.equal((await recoveryLedger(p)).length, 1)
})

test('review-required recovery stays visible after workers stop retrying it', async () => {
  const p = await recoverable(), claim = await approve(p)
  await finishRecovery(claim, 'review_required', null, 'amount_mismatch')
  await workerRead(p, 'lost'); await workerRead(p, 'lost')
  assert.equal((await getPayment(p.id)).attention_required, true)
  assert.equal((await permit(claim)).allowed, false)
  assert.equal((await recoveryLedger(p)).length, 0)
})

test('settled ordinary payments still clear transient attention and an ordinary bank win adds no review', async () => {
  const p = await fixed(); await both(p); await snapshot(p, 'succeeded')
  await db.query('update payments set attention_required=true where id=$1', [p.id])
  await snapshot(p, 'succeeded')
  assert.equal((await getPayment(p.id)).attention_required, false)
  p.disputeId = `du_${randomUUID().replaceAll('-', '')}`
  await disputeSnapshot(p, 'won'); await workerRead(p)
  assert.equal((await getPayment(p.id)).attention_required, false)
  assert.equal(await attentionNotices(p), 0)
})


test('backfill restores previously cleared financial reviews without changing ledger or transient flags', async () => {
  const p = await recoverable(), claim = await approve(p)
  await finishRecovery(claim, 'completed', `trr_${p.id.replaceAll('-', '')}`)
  await disputeSnapshot(p, 'won')
  const before = await recoveryLedger(p)
  await db.query('update payments set attention_required=false where id=$1', [p.id])
  const ordinary = await fixed(); await both(ordinary); await snapshot(ordinary, 'succeeded')
  await db.exec(await read('migrations/20261027145611_preserve_financial_review_attention.sql'))
  assert.equal((await getPayment(p.id)).attention_required, true)
  assert.equal((await getPayment(ordinary.id)).attention_required, false)
  assert.deepEqual(await recoveryLedger(p), before)
  assert.equal(await attentionNotices(p), 2)
})

test('durable review lookup creates no browser-accessible privileged API', async () => {
  const helper = (await db.query(`select has_function_privilege('anon',oid,'EXECUTE') anon,
    has_function_privilege('authenticated',oid,'EXECUTE') authenticated,prosecdef
    from pg_proc where proname='order_financial_review_required'`)).rows
  assert.deepEqual(helper, [{ anon: false, authenticated: false, prosecdef: false }])
  const provider = (await db.query(`select has_function_privilege('anon',oid,'EXECUTE') anon,
    has_function_privilege('authenticated',oid,'EXECUTE') authenticated,
    has_function_privilege('service_role',oid,'EXECUTE') service_role
    from pg_proc where proname='reconcile_order_provider'`)).rows
  assert.deepEqual(provider, [{ anon: false, authenticated: false, service_role: true }])
})
