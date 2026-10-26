// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Execute the actual migration against PostgreSQL, with the repository's payment
// table definitions. Only unrelated auth/geography tables are minimal fixtures.
const sqlRoot = resolve(process.cwd(), '../supabase')
const read = (name: string) => readFileSync(resolve(sqlRoot, 'sql', name), 'utf8')
function table(source: string, name: string) {
  const start = source.toLowerCase().indexOf('create table if not exists ' + name + ' (')
  if (start < 0) throw new Error('Missing baseline table ' + name)
  return source.slice(start, source.indexOf(');', start) + 2)
}
const buyer = '00000000-0000-4000-8000-000000000001'
const seller = '00000000-0000-4000-8000-000000000002'
const listing = '00000000-0000-4000-8000-000000000003'
const payment = '00000000-0000-4000-8000-000000000004'
let db: PGlite
let sequence = 0

function stripeEvent(type = 'payment_intent.succeeded', object: Record<string, unknown> = {}, id = 'evt_' + ++sequence) {
  return { id, type, data: { object: { id: 'pi_test', amount: 1000, application_fee_amount: null, metadata: {}, ...object } } }
}
async function processEvent(event: ReturnType<typeof stripeEvent>, intent: string | null = 'pi_test') {
  const result = await db.query<{ result: any }>('select public.process_stripe_webhook_event($1::jsonb, $2, $3) as result', [JSON.stringify(event), intent, 'test-request'])
  return result.rows[0].result
}
async function counts() {
  const result = await db.query<any>('select (select count(*)::int from transactions) transactions, (select count(*)::int from notifications) notifications, (select count(*)::int from payment_audit_logs) audits, (select count(*)::int from webhook_events) events')
  return result.rows[0]
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    create table profiles(id uuid primary key, user_id uuid unique);
    create table listings(id uuid primary key, seller_id uuid references profiles(id), price numeric, status text);
    ` + ['payments', 'transactions', 'disputes', 'notifications'].map(name => table(read('001_init.sql'), name)).join('\n'))
  await db.exec(read('004_payment_confirmations.sql'))
  await db.exec(read('009_milestones.sql'))
  await db.exec(table(read('021_fix_payment_security.sql'), 'payment_audit_logs'))
  await db.exec(read('021_fix_payment_security.sql').split('-- Add payment audit log table')[0])
  for (const file of ['013_webhook_events.sql', '023_webhook_events_extended.sql', '024_payments_intent_unique.sql', '025_payments_transactions_disputes_milestones_columns.sql', '026_payment_atomic_functions.sql', '027_payments_open_intent_unique.sql', '028_payment_atomic_function.sql']) await db.exec(read(file))
  await db.exec(readFileSync(resolve(sqlRoot, 'migrations/20261013232046_webhook_event_atomic_processing.sql'), 'utf8'))
  await db.exec(readFileSync(resolve(sqlRoot, 'migrations/20261014085831_payment_dispute_workflow.sql'), 'utf8'))
  await db.exec('grant usage on schema auth to authenticated; grant select on profiles to authenticated; grant select, update on payments,milestones to authenticated')
}, 30000)

beforeEach(async () => {
  await db.exec('truncate webhook_events, payments, milestones, payment_audit_logs, transactions, notifications, disputes, listings, profiles cascade')
  await db.query('insert into profiles values ($1,$1), ($2,$2)', [buyer, seller])
  await db.query("insert into listings values ($1, $2, 10, 'active')", [listing, seller])
  await db.query("insert into payments(id, listing_id, buyer_id, seller_id, amount, platform_fee, stripe_payment_intent, status, buyer_confirmed, seller_confirmed) values ($1,$2,$3,$4,10,0.5,'pi_test','requires_capture',true,true)", [payment, listing, buyer, seller])
})
afterAll(async () => { await db?.close() })

describe('Atomic webhook database effects', () => {
  async function refundEvent(status: string, created: number, eventId = 'evt_refund_' + ++sequence) {
    return db.query<any>('select public.process_stripe_refund_event($1,$2,$3,$4) result', [
      JSON.stringify({ id: eventId, type: status === 'failed' ? 'refund.failed' : 'refund.updated', created, data: { object: { id: 're_test' } } }),
      'pi_test', JSON.stringify([{ id: 're_test', amount: 1000, currency: 'usd', status }]), 'request-test',
    ])
  }

  it('does not mark a pending refund as money returned', async () => {
    await processEvent(stripeEvent())
    await refundEvent('pending', 10)
    expect((await db.query<any>('select status from payments')).rows[0].status).toBe('completed')
    expect((await db.query<any>("select status from transactions where type='refund'")).rows[0].status).toBe('pending')
  })

  it('reopens a refunded complaint when a later canonical refund fails without double-counting stale events', async () => {
    await processEvent(stripeEvent())
    await db.query('select public.open_payment_complaint($1,$2)', [payment, buyer])
    await refundEvent('succeeded', 10)
    expect((await db.query<any>('select status from payments')).rows[0].status).toBe('refunded')
    expect((await db.query<any>('select status from disputes')).rows[0].status).toBe('refunded')
    await refundEvent('failed', 20, 'evt_refund_failure')
    await refundEvent('succeeded', 10)
    await refundEvent('succeeded', 20)
    expect((await db.query<any>('select status from payments')).rows[0].status).toBe('completed')
    expect((await db.query<any>('select status from disputes')).rows[0].status).toBe('open')
    expect((await db.query<any>("select status from transactions where stripe_refund_id='re_test'")).rows[0].status).toBe('failed')
    expect((await db.query<any>("select count(*)::int count from notifications where type='payment_refund_failed'")).rows[0].count).toBe(2)
    expect((await refundEvent('failed', 20, 'evt_refund_failure')).rows[0].result.duplicate).toBe(true)
  })

  it('rolls back a refund failure and its marker if downstream notification delivery fails', async () => {
    await processEvent(stripeEvent())
    await refundEvent('succeeded', 10)
    await db.exec('alter table notifications add constraint injected_failure check (false) not valid')
    try { await expect(refundEvent('failed', 20, 'evt_failure_retry')).rejects.toThrow() }
    finally { await db.exec('alter table notifications drop constraint injected_failure') }
    expect((await db.query<any>('select status from payments')).rows[0].status).toBe('refunded')
    expect((await db.query<any>("select count(*)::int count from webhook_events where id='evt_failure_retry'")).rows[0].count).toBe(0)
    await refundEvent('failed', 20, 'evt_failure_retry')
    expect((await db.query<any>('select status from payments')).rows[0].status).toBe('completed')
  })
  it('keeps settled financial state and deduplicates concurrent application complaints', async () => {
    await processEvent(stripeEvent())
    const open = () => db.query<any>('select public.open_payment_complaint($1,$2) result', [payment, buyer])
    const results = await Promise.all([open(), open(), open()])
    expect(new Set(results.map(result => result.rows[0].result.dispute_id)).size).toBe(1)
    expect((await db.query<any>('select status from payments')).rows[0].status).toBe('completed')
    expect((await db.query<any>('select count(*)::int count from disputes')).rows[0].count).toBe(1)
  })

  it('closes application complaints only after a full actual refund', async () => {
    await processEvent(stripeEvent())
    await db.query('select public.open_payment_complaint($1,$2)', [payment, buyer])
    await processEvent(stripeEvent('charge.refunded', { id: 'ch_test', amount_refunded: 400 }))
    expect((await db.query<any>('select status from disputes')).rows[0].status).toBe('open')
    await processEvent(stripeEvent('charge.refunded', { id: 'ch_test', amount_refunded: 1000 }))
    expect((await db.query<any>('select status from disputes')).rows[0].status).toBe('refunded')
  })

  it('resolves complaints idempotently without changing financial state', async () => {
    await processEvent(stripeEvent())
    const result = await db.query<any>('select public.open_payment_complaint($1,$2) result', [payment, buyer])
    const complaint = result.rows[0].result.dispute_id
    await db.query('select public.resolve_payment_complaint($1,$2)', [complaint, 'admin@example.com'])
    await db.query('select public.resolve_payment_complaint($1,$2)', [complaint, 'admin@example.com'])
    expect((await db.query<any>('select status from payments')).rows[0].status).toBe('completed')
    expect((await db.query<any>("select count(*)::int count from payment_audit_logs where action='admin_resolve'")).rows[0].count).toBe(1)
  })

  it('keeps complaint RPCs service-only and denies another buyer', async () => {
    await expect(db.query('select public.open_payment_complaint($1,$2)', [payment, seller])).rejects.toThrow('Payment not owned')
    for (const fn of ['open_payment_complaint(uuid,uuid)', 'resolve_payment_complaint(uuid,text)', 'close_refunded_payment_complaints()']) {
      for (const role of ['anon', 'authenticated']) {
        expect((await db.query<any>('select has_function_privilege($1,$2,\'EXECUTE\') allowed', [role, 'public.' + fn])).rows[0].allowed).toBe(false)
      }
    }
  })
  it('commits the completion marker, payment, charge, notifications and audit together', async () => {
    expect(await processEvent(stripeEvent())).toMatchObject({ action: 'payment_completed', duplicate: false })
    expect((await db.query<any>('select status from payments')).rows[0].status).toBe('completed')
    expect(await counts()).toEqual({ transactions: 1, notifications: 2, audits: 1, events: 1 })
  })

  it('rolls all effects back on a downstream failure, then retries the same event successfully', async () => {
    const event = stripeEvent()
    await db.exec('alter table notifications add constraint injected_failure check (false) not valid')
    try {
      await expect(processEvent(event)).rejects.toThrow()
      expect(await counts()).toEqual({ transactions: 0, notifications: 0, audits: 0, events: 0 })
      expect((await db.query<any>('select status from payments')).rows[0].status).toBe('requires_capture')
    } finally { await db.exec('alter table notifications drop constraint injected_failure') }
    expect(await processEvent(event)).toMatchObject({ action: 'payment_completed', duplicate: false })
    expect(await counts()).toEqual({ transactions: 1, notifications: 2, audits: 1, events: 1 })
  })

  it('deduplicates simultaneous submissions and repeats after acknowledgement loss', async () => {
    const event = stripeEvent()
    const results = await Promise.all([processEvent(event), processEvent(event), processEvent(event)])
    expect(results.filter(result => !result.duplicate)).toHaveLength(1)
    expect(await processEvent(event)).toMatchObject({ duplicate: true })
    expect(await counts()).toEqual({ transactions: 1, notifications: 2, audits: 1, events: 1 })
  })

  it('recovers legacy failed and prematurely marked deliveries', async () => {
    const event = stripeEvent()
    await db.query("insert into webhook_events(id, processed_at, processing_error) values ($1, now(), '{\"message\":\"failed\"}')", [event.id])
    expect(await processEvent(event)).toMatchObject({ duplicate: false, action: 'payment_completed' })
    expect((await db.query<any>('select processing_error from webhook_events')).rows[0].processing_error).toBeNull()
  })

  it('does not lose an event that arrives before its local payment exists', async () => {
    const event = stripeEvent()
    await expect(processEvent(event, 'pi_not_saved_yet')).rejects.toThrow('Payment not found')
    expect((await counts()).events).toBe(0)
    await db.query("update payments set stripe_payment_intent = 'pi_not_saved_yet'")
    expect(await processEvent(event, 'pi_not_saved_yet')).toMatchObject({ action: 'payment_completed' })
  })

  it('records only new cumulative refund amounts and does not reverse settlement on stale events', async () => {
    await processEvent(stripeEvent())
    await processEvent(stripeEvent('charge.refunded', { id: 'ch_1', amount_refunded: 300 }))
    expect((await db.query<any>('select status from payments')).rows[0].status).toBe('completed')
    await processEvent(stripeEvent('charge.refunded', { id: 'ch_1', amount_refunded: 1000 }))
    await processEvent(stripeEvent('charge.refunded', { id: 'ch_1', amount_refunded: 300 }))
    await processEvent(stripeEvent('payment_intent.payment_failed'))
    await processEvent(stripeEvent())
    const refunds = await db.query<any>("select amount from transactions where type = 'refund' order by amount")
    expect(refunds.rows.map(row => Number(row.amount))).toEqual([3, 7])
    expect((await db.query<any>('select status from payments')).rows[0].status).toBe('refunded')
  })

  it('deduplicates transfers across different Stripe event IDs', async () => {
    await processEvent(stripeEvent('transfer.created', { id: 'tr_1' }))
    await processEvent(stripeEvent('transfer.created', { id: 'tr_1' }))
    expect((await counts()).transactions).toBe(1)
    expect((await counts()).notifications).toBe(1)
  })

  it('handles closed-before-created disputes without reopening or updating unrelated disputes', async () => {
    await processEvent(stripeEvent())
    await processEvent(stripeEvent('charge.dispute.closed', { id: 'dp_1', status: 'won' }))
    await processEvent(stripeEvent('charge.dispute.created', { id: 'dp_1', status: 'needs_response' }))
    await processEvent(stripeEvent('charge.dispute.created', { id: 'dp_2', status: 'needs_response' }))
    const rows = (await db.query<any>('select stripe_dispute_id, status from disputes order by stripe_dispute_id')).rows
    expect(rows).toEqual([{ stripe_dispute_id: 'dp_1', status: 'won' }, { stripe_dispute_id: 'dp_2', status: 'open' }])
  })

  it('does not grant financial RPC execution to browser roles', async () => {
    for (const role of ['anon', 'authenticated']) {
      for (const fn of ['process_stripe_refund_event(jsonb,text,jsonb,text)', 'process_stripe_webhook_event(jsonb,text,text)', 'payment_complete_atomic(text,numeric,numeric,uuid)', 'payment_fail_atomic(text,numeric)', 'payment_refund_atomic(text,numeric)', 'create_payment_with_audit(uuid,uuid,uuid,numeric,numeric,text)', 'create_milestone_proposal(uuid,uuid,text,numeric)', 'create_milestone_payment(uuid,uuid,uuid,text,numeric,numeric,text,uuid)', 'create_listing_payment(uuid,uuid,uuid,numeric,numeric,text)']) {
        const permission = await db.query<any>('select has_function_privilege($1, $2, \'EXECUTE\') allowed', [role, 'public.' + fn])
        expect(permission.rows[0].allowed).toBe(false)
      }
    }
    expect((await db.query<any>("select has_function_privilege('service_role', 'public.process_stripe_webhook_event(jsonb,text,text)', 'EXECUTE') allowed")).rows[0].allowed).toBe(true)
  })

  it('settles a lost dispute even when the closed event arrives first', async () => {
    await processEvent(stripeEvent())
    await processEvent(stripeEvent('charge.dispute.closed', { id: 'dp_lost', status: 'lost' }))
    await processEvent(stripeEvent('charge.dispute.created', { id: 'dp_lost', status: 'needs_response' }))
    expect((await db.query<any>('select status from payments')).rows[0].status).toBe('refunded')
  })

  it('keeps a declined intent retryable but retires a canceled authorization', async () => {
    await processEvent(stripeEvent('payment_intent.payment_failed'))
    expect((await db.query<any>('select status from payments')).rows[0].status).toBe('requires_capture')
    await processEvent(stripeEvent('payment_intent.canceled'))
    expect((await db.query<any>('select status from payments')).rows[0].status).toBe('failed')
  })

  it('allows each participant to confirm only their own field', async () => {
    await db.exec('update payments set buyer_confirmed=false,seller_confirmed=false')
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [buyer])
    await db.exec('set role authenticated')
    try {
      await db.exec('update payments set buyer_confirmed=true')
      await expect(db.exec('update payments set seller_confirmed=true')).rejects.toThrow('Only your own confirmation')
      await expect(db.exec('update payments set amount=1')).rejects.toThrow('Only your own confirmation')
    } finally { await db.exec('reset role') }
    expect((await db.query<any>('select buyer_confirmed,seller_confirmed from payments')).rows[0]).toEqual({ buyer_confirmed: true, seller_confirmed: false })
  })
})

describe('Milestone payment linkage', () => {
  async function createMilestone(intent: string, amount: number) {
    return (await db.query<any>('select public.create_milestone_payment($1,$2,$3,$4,$5,$6,$7) result', [listing, buyer, seller, 'First milestone', amount, amount * 0.05, intent])).rows[0].result
  }
  it('creates linked records atomically and reuses them for the same intent', async () => {
    const result = await createMilestone('pi_milestone', 5)
    expect(await createMilestone('pi_milestone', 5)).toEqual(result)
    expect((await db.query<any>('select count(*)::int n from milestones')).rows[0].n).toBe(1)
    expect((await db.query<any>('select milestone_id from payments where id=$1', [result.payment_id])).rows[0].milestone_id).toBe(result.milestone_id)
  })

  it('supports two milestones and rejects excess totals without leaving an orphan', async () => {
    await createMilestone('pi_milestone_a', 5)
    await createMilestone('pi_milestone_b', 5)
    await expect(createMilestone('pi_milestone_c', 1)).rejects.toThrow('exceed listing price')
    expect((await db.query<any>('select count(*)::int n from milestones')).rows[0].n).toBe(2)
  })

  it('completes a milestone after its own two confirmations', async () => {
    const result = await createMilestone('pi_milestone', 5)
    await db.query('update milestones set buyer_confirmed=true, seller_confirmed=true where id=$1', [result.milestone_id])
    await processEvent(stripeEvent('payment_intent.succeeded', { id: 'pi_milestone', amount: 500 }), 'pi_milestone')
    expect((await db.query<any>('select status from milestones where id=$1', [result.milestone_id])).rows[0].status).toBe('completed')
    expect((await db.query<any>('select status,buyer_confirmed,seller_confirmed from payments where id=$1', [result.payment_id])).rows[0]).toEqual({ status: 'completed', buyer_confirmed: true, seller_confirmed: true })
  })

  it('funds a saved proposal once and exposes capture only after authorization', async () => {
    const id = (await db.query<any>('select public.create_milestone_proposal($1,$2,$3,$4) id', [listing,buyer,'First milestone',10])).rows[0].id
    const result = await createMilestone('pi_proposal', 10)
    expect(result.milestone_id).toBe(id)
    expect((await db.query<any>('select count(*)::int n from milestones')).rows[0].n).toBe(1)
    expect((await db.query<any>('select status,currency from milestones')).rows[0]).toEqual({ status: 'pending', currency: 'eur' })
    await processEvent(stripeEvent('payment_intent.amount_capturable_updated', { id: 'pi_proposal', amount_capturable: 1000 }), 'pi_proposal')
    expect((await db.query<any>('select status from milestones')).rows[0].status).toBe('requires_capture')
    await processEvent(stripeEvent('payment_intent.canceled', { id: 'pi_proposal' }), 'pi_proposal')
    expect((await db.query<any>('select status from milestones')).rows[0].status).toBe('failed')
    const retry = (await db.query<any>('select public.create_milestone_payment($1,$2,$3,$4,$5,$6,$7,$8) result', [listing,buyer,seller,'First milestone',10,0.5,'pi_retry',id])).rows[0].result
    expect(retry.milestone_id).toBe(id)
    expect((await db.query<any>('select count(*)::int n from milestones')).rows[0].n).toBe(1)
  })

  it('rejects self-purchase, unavailable listings and excess proposal totals', async () => {
    const create = (id: string, amount = 10) => db.query('select public.create_milestone_proposal($1,$2,$3,$4)', [listing,id,'Proposal',amount])
    await expect(create(seller)).rejects.toThrow('unavailable')
    await expect(create(buyer, -1)).rejects.toThrow('Invalid milestone')
    await create(buyer)
    await expect(create(buyer, 1)).rejects.toThrow('exceed listing price')
    await db.exec("update listings set status='sold'")
    await expect(create(buyer)).rejects.toThrow('unavailable')
  })
})

describe('Listing payment retries', () => {
  it('reuses the existing payment for the same intent, including after completion', async () => {
    const create = async () => (await db.query<any>('select public.create_listing_payment($1,$2,$3,$4,$5,$6) result', [listing, buyer, seller, 10, 0.5, 'pi_test'])).rows[0].result
    expect(await create()).toEqual({ payment_id: payment })
    await processEvent(stripeEvent())
    expect(await create()).toEqual({ payment_id: payment })
    expect((await db.query<any>('select count(*)::int n from payments')).rows[0].n).toBe(1)
  })

  it('creates payment and audit together and disallows reuse for another buyer', async () => {
    await db.exec('delete from payments')
    const create = await db.query<any>('select public.create_listing_payment($1,$2,$3,$4,$5,$6) result', [listing, buyer, seller, 10, 0.5, 'pi_new'])
    expect(create.rows[0].result.payment_id).toBeTruthy()
    expect((await counts()).audits).toBe(1)
    await expect(db.query('select public.create_listing_payment($1,$2,$3,$4,$5,$6)', [listing, seller, seller, 10, 0.5, 'pi_new'])).rejects.toThrow('Intent does not match')
  })
})
