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
  const p = await fixed(); await both(p); await snapshot(p, 'succeeded')
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

test('recovery tables and every financial RPC are inaccessible to browser roles', async () => {
  const p = await recoverable()
  for (const role of ['anon', 'authenticated']) {
    for (const table of ['payment_recoveries', 'payment_recovery_ledger']) await assert.rejects(as(role, users[0], `select * from ${table}`), /permission denied/)
    await assert.rejects(as(role, users[0], 'select claim_payment_recovery($1,$2,$3,$4,$5::jsonb)', [p.id, users[2], 'a'.repeat(64), 'Test approval', JSON.stringify(approval(p))]), /permission denied/)
  }
  for (const name of ['claim_payment_recovery', 'record_payment_recovery', 'authorize_payment_recovery_attempt', 'reserve_admin_payment_refund']) {
    const rows = (await db.query(`select has_function_privilege('anon',oid,'EXECUTE') a,has_function_privilege('authenticated',oid,'EXECUTE') u,has_function_privilege('service_role',oid,'EXECUTE') s from pg_proc where proname=$1`, [name])).rows
    assert.deepEqual(rows, [{ a: false, u: false, s: true }])
  }
})
test('one approval preserves original provider identities and idempotent authorization', async () => {
  const p = await recoverable(), first = await approve(p), second = await approve(p)
  assert.equal(first.id, second.id); assert.equal(first.status, 'pending')
  assert.equal(first.stripe_account_id, 'acct_originalSeller'); assert.equal(first.stripe_platform_id, 'acct_platform'); assert.equal(first.livemode, false)
  assert.equal(await count('select count(*) n from payment_recoveries where payment_id=$1', [p.id]), 1)
  assert.equal(await count("select count(*) n from payment_audit_logs where payment_id=$1 and action='seller_recovery_approved'", [p.id]), 1)
  await assert.rejects(approve(p, approval(p), 'b'.repeat(64)), /changed/)
  assert.equal((await permit(first)).allowed, true)
  assert.equal((await permit(first, 'acct_other')).allowed, false)
  assert.equal((await permit(first, 'acct_platform', true)).allowed, false)
})
test('approval rejects partial, FX, multiple histories and modified or old provider facts', async () => {
  for (const change of [{ originalAmountMinor: 3999 }, { originalRequestedFeeMinor: 201 }, { originalFeeAmountMinor: null }, { originalFeeCurrency: null }, { intentId: 'pi_other' }, { disputeStatus: 'won' }, { checkedAt: '2000-01-01T00:00:00Z' }, { originalCurrency: 'usd' }, { currency: 'jpy' }]) {
    const p = await recoverable(); await assert.rejects(approve(p, { ...approval(p), ...change }))
  }
  const partial = await recoverable()
  await db.query('update disputes set amount=10 where payment_id=$1', [partial.id])
  await assert.rejects(approve(partial), /same-currency/)
  const fx = await recoverable()
  await db.query("update disputes set currency='usd' where payment_id=$1", [fx.id]); await assert.rejects(approve(fx), /same-currency/)
  const multi = await recoverable()
  await db.query("insert into disputes(payment_id,status) values($1,'resolved')", [multi.id]); await assert.rejects(approve(multi), /Multiple/)
})
test('refund reservation and recovery approval exclude one another under the payment lock', async () => {
  const p = await recoverable(); await approve(p)
  await assert.rejects(rpc('reserve_admin_payment_refund($1,$2)', [p.id, users[2]]), /cannot overlap/)
  const other = await fixed(); await both(other); await snapshot(other, 'succeeded')
  const reservation = await rpc('reserve_admin_payment_refund($1,$2)', [other.id, users[2]])
  assert.ok(reservation); assert.equal(await rpc('reserve_admin_payment_refund($1,$2)', [other.id, users[2]]), reservation)
  other.disputeId = 'du_refundRace'
  await rpc('reconcile_order_disputes($1,$2,$3,$4::jsonb)', [other.id, other.intent, observed(), JSON.stringify([{ id: other.disputeId, amount: 4000, currency: 'eur', status: 'lost' }])])
  await assert.rejects(approve(other), /Refund or settlement/)
})

const capturedWebhook = (p, changes = {}, eventId = `evt_${randomUUID()}`) => rpc('process_stripe_webhook_event($1::jsonb,$2,$3)', [JSON.stringify({
  id: eventId, type: 'payment_intent.succeeded', created: Math.floor(Date.now() / 1000), data: { object: {
    id: p.intent, status: 'succeeded', capture_method: 'manual', amount: 4000, amount_received: 4000,
    amount_capturable: 0, application_fee_amount: 200, currency: 'eur',
    metadata: { listing_id: p.listing, buyer_profile_id: p.buyer, seller_profile_id: p.seller }, ...changes,
  } },
}), p.intent, null])

test('actual capture claim followed only by the success webhook permits refund and lost-dispute recovery', async () => {
  for (const milestone of [false, true]) {
    for (const next of ['refund', 'recovery']) {
      const p = await fixed({ milestone }); await both(p)
      const claim = await capture(p)
      await rpc('resolve_order_capture($1,$2,$3)', [p.id, claim.claim_id, 'captured'])
      assert.equal((await getPayment(p.id)).capture_claim_id, claim.claim_id, 'HTTP capture acknowledgment alone cannot release the reservation')
      const eventId = `evt_${randomUUID()}`
      await capturedWebhook(p, {}, eventId)
      assert.equal((await getPayment(p.id)).status, 'completed')
      assert.equal((await getPayment(p.id)).capture_claim_id, null)
      assert.equal((await getPayment(p.id)).capture_claimed_at, null)
      await rpc('resolve_order_capture($1,$2,$3)', [p.id, claim.claim_id, 'captured'])
      assert.equal((await capturedWebhook(p, {}, eventId)).duplicate, true)
      assert.equal(await count("select count(*) n from transactions where payment_id=$1 and type='charge' and status='succeeded'", [p.id]), 1)
      if (next === 'refund') {
        await complaint(p)
        assert.ok(await rpc('reserve_admin_payment_refund($1,$2)', [p.id, users[2]]))
      } else {
        p.disputeId = `du_${randomUUID().replaceAll('-', '')}`
        await rpc('reconcile_order_disputes($1,$2,$3,$4::jsonb)', [p.id, p.intent, observed(), JSON.stringify([{ id: p.disputeId, amount: 4000, currency: 'eur', status: 'lost' }])])
        assert.equal((await approve(p)).status, 'pending')
      }
    }
  }
})

test('mismatched success evidence cannot complete a payment, clear its capture claim or consume the webhook', async () => {
  const variants = [
    { id: 'pi_other' }, { status: 'requires_capture' }, { capture_method: 'automatic' },
    { amount: 3999 }, { amount_received: 3999 }, { application_fee_amount: 199 }, { currency: 'usd' },
    { metadata: {} }, { metadata: { listing_id: randomUUID(), buyer_profile_id: randomUUID(), seller_profile_id: randomUUID() } },
  ]
  for (const change of variants) {
    const p = await fixed({ milestone: true }); await both(p); const claim = await capture(p)
    const eventId = `evt_${randomUUID()}`
    await assert.rejects(capturedWebhook(p, change, eventId), /capture evidence/)
    const unchanged = await getPayment(p.id)
    assert.equal(unchanged.status, 'requires_capture'); assert.equal(unchanged.capture_claim_id, claim.claim_id)
    assert.equal(await count('select count(*) n from webhook_events where id=$1', [eventId]), 0)
    assert.equal(await count('select count(*) n from transactions where payment_id=$1', [p.id]), 0)
  }
})

test('a verified duplicate success repairs historical terminal capture claims without changing financial history', async () => {
  for (const status of ['completed', 'refunded', 'disputed']) {
    const p = await fixed({ milestone: true }); await both(p); const claim = await capture(p)
    const eventId = `evt_${randomUUID()}`
    await capturedWebhook(p, {}, eventId)
    if (status === 'refunded') await refunds(p, [refund(`re_${randomUUID().replaceAll('-', '')}`, 'succeeded')])
    if (status === 'disputed') await rpc('reconcile_order_disputes($1,$2,$3,$4::jsonb)', [p.id, p.intent, observed(), JSON.stringify([{ id: `du_${randomUUID().replaceAll('-', '')}`, amount: 4000, currency: 'eur', status: 'needs_response' }])])
    await db.query('update payments set capture_claim_id=$2,capture_claimed_at=now() where id=$1', [p.id, claim.claim_id])
    const beforeCount = await count('select count(*) n from transactions where payment_id=$1', [p.id])
    assert.equal((await capturedWebhook(p, {}, eventId)).duplicate, true)
    const row = await getPayment(p.id)
    assert.equal(row.status, status); assert.equal(row.capture_claim_id, null); assert.equal(row.capture_claimed_at, null)
    assert.equal(await count('select count(*) n from transactions where payment_id=$1', [p.id]), beforeCount)
  }
})
test('completed recovery records one separate ledger entry and never a customer refund', async () => {
  const p = await recoverable(), claim = await approve(p), reversal = `trr_${p.id.replaceAll('-', '')}`
  const first = await finishRecovery(claim, 'completed', reversal), again = await finishRecovery(claim, 'completed', reversal)
  assert.equal(first.id, again.id); assert.equal(first.status, 'completed'); assert.ok(first.completed_at)
  assert.equal(await count('select count(*) n from payment_recovery_ledger where payment_id=$1', [p.id]), 1)
  assert.equal(await count("select count(*) n from transactions where payment_id=$1 and type='refund'", [p.id]), 0)
  await assert.rejects(finishRecovery(claim, 'completed', 'trr_other'), /changed/)
})
test('failed provider attempts remain pending and audit once until a verified completion', async () => {
  const p = await recoverable(), claim = await approve(p)
  await finishRecovery(claim, 'pending', null, 'provider_reversal_pending'); await finishRecovery(claim, 'pending', null, 'provider_reversal_pending')
  assert.equal((await getPayment(p.id)).attention_required, true)
  assert.equal(await count("select count(*) n from payment_audit_logs where payment_id=$1 and action='seller_recovery_pending'", [p.id]), 1)
  assert.equal((await approve(p)).id, claim.id)
  assert.equal((await finishRecovery(claim, 'completed', `trr_${p.id.replaceAll('-', '')}`)).status, 'completed')
})
test('a late bank win blocks any new recovery attempt but a prior real reversal remains recordable', async () => {
  const p = await recoverable(), claim = await approve(p)
  await rpc('reconcile_order_disputes($1,$2,$3,$4::jsonb)', [p.id, p.intent, observed(), JSON.stringify([{ id: p.disputeId, amount: 4000, currency: 'eur', status: 'won' }])])
  assert.equal((await permit(claim)).allowed, false)
  await finishRecovery(claim, 'review_required', null, 'dispute_not_lost')
  assert.equal((await finishRecovery(claim, 'pending', null, 'provider_unavailable')).status, 'review_required')
  const completed = await finishRecovery(claim, 'completed', `trr_${p.id.replaceAll('-', '')}`, 'late_win_after_recovery')
  assert.equal(completed.status, 'completed'); assert.equal((await getPayment(p.id)).attention_required, true)
})
test('worker continuation requires its current unexpired payment lease', async () => {
  const p = await recoverable(), claim = await approve(p), lease = randomUUID()
  await db.query('update payments set reconciliation_lease_id=$2,reconciliation_lease_until=now()+interval \'3 minutes\' where id=$1', [p.id, lease])
  assert.equal((await permit(claim, 'acct_platform', false, lease)).allowed, true)
  assert.equal((await permit(claim, 'acct_platform', false, randomUUID())).reason, 'lease_lost')
  await db.query("update payments set reconciliation_lease_until=now()-interval '1 second' where id=$1", [p.id])
  assert.equal((await permit(claim, 'acct_platform', false, lease)).reason, 'lease_lost')
})

test('original EUR charge and fee stay separate from exact USD destination transfer and fee refund ledger', async () => {
  const p = await recoverable(), claim = await approve(p, { ...approval(p), grossAmountMinor: 4460, feeAmountMinor: 223, currency: 'usd' })
  assert.equal(claim.original_amount_minor, 4000); assert.equal(claim.original_currency, 'eur'); assert.equal(claim.original_fee_amount_minor, 200)
  assert.equal(claim.gross_amount_minor, 4460); assert.equal(claim.fee_amount_minor, 223); assert.equal(claim.currency, 'usd')
  assert.equal((await permit(claim)).allowed, true, 'Bank loss is matched in original charge currency, never settlement units.')
  const reversal = `trr_${p.id.replaceAll('-', '')}`
  await assert.rejects(rpc('record_payment_recovery($1,$2,$3,$4,$5,$6,$7,$8)', [claim.id, 'completed', reversal, null, new Date().toISOString(), 'fr_wrong', 200, 'eur']), /settlement/)
  const result = await finishRecovery(claim, 'completed', reversal)
  assert.equal(result.fee_refund_amount_minor, 223); assert.equal(result.fee_refund_currency, 'usd')
  const ledger = (await db.query('select * from payment_recovery_ledger where recovery_id=$1', [claim.id])).rows[0]
  assert.equal(ledger.gross_amount_minor, 4460); assert.equal(ledger.fee_returned_minor, 223); assert.equal(ledger.currency, 'usd')
  assert.equal(ledger.original_amount_minor, 4000); assert.equal(ledger.original_fee_amount_minor, 200); assert.equal(ledger.original_fee_currency, 'eur')
  assert.equal(ledger.stripe_fee_refund_id, result.stripe_fee_refund_id)
})
