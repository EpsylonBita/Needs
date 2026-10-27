import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), payment: vi.fn(), platform: vi.fn(), intent: vi.fn(), transfer: vi.fn(), fee: vi.fn(),
  disputes: vi.fn(), refunds: vi.fn(), reversals: vi.fn(), feeRefunds: vi.fn(), reverse: vi.fn(), destination: vi.fn(), allowed: true, limited: false }))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: { from: (...args: unknown[]) => mock.from(...args), rpc: (...args: unknown[]) => mock.rpc(...args) } }))
vi.mock('@/lib/stripe/server', () => ({ stripe: {
  accounts: { retrieve: (...args: unknown[]) => mock.platform(...args) }, paymentIntents: { retrieve: (...args: unknown[]) => mock.intent(...args) },
  charges: { retrieve: (...args: unknown[]) => mock.destination(...args) },
  transfers: { retrieve: (...args: unknown[]) => mock.transfer(...args), listReversals: (...args: unknown[]) => mock.reversals(...args), createReversal: (...args: unknown[]) => mock.reverse(...args) },
  applicationFees: { retrieve: (...args: unknown[]) => mock.fee(...args), listRefunds: (...args: unknown[]) => mock.feeRefunds(...args) },
  disputes: { list: (...args: unknown[]) => mock.disputes(...args) }, refunds: { list: (...args: unknown[]) => mock.refunds(...args) },
} }))
vi.mock('@/lib/payments/lifecycle', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/payments/lifecycle')>(), getProviderPayment: (...args: unknown[]) => mock.payment(...args) }))
vi.mock('@/lib/auth/admin', () => ({ requireAdmin: async () => ({ allowed: mock.allowed, user: { id: '00000000-0000-4000-8000-000000000001' } }) }))
vi.mock('@/lib/utils/rate-limit-enhanced', () => ({ rateLimitEnhanced: async () => ({ allowed: !mock.limited }) }))

import { previewPaymentRecovery, executePaymentRecovery, resumeApprovedRecovery, type RecoveryRow } from '@/lib/payments/recovery'
import { POST as preview } from '@/app/api/admin/payments/recovery/preview/route'
import { POST as execute } from '@/app/api/admin/payments/recovery/execute/route'
import { proxy } from '@/proxy'

const adminId = '00000000-0000-4000-8000-000000000001', paymentId = '00000000-0000-4000-8000-000000000002'
const recoveryId = '00000000-0000-4000-8000-000000000003'
const payment = { id: paymentId, stripe_payment_intent: 'pi_original', listing_id: 'listing', buyer_id: 'buyer', seller_id: 'seller',
  amount: 40, platform_fee: 2, currency: 'eur', status: 'refunded', capture_claim_id: null, cancel_claim_id: null, refund_claim_id: null, stripe_canceled_at: null }
let recovery: RecoveryRow | null
let localPayment: typeof payment
let localDisputes: Record<string, unknown>[], localRefunds: Record<string, unknown>[]
let intent: Record<string, any>, transfer: Record<string, any>, fee: Record<string, any>, bank: Record<string, any>
let reversals: Record<string, any>[], feeRefunds: Record<string, any>[]
let destination: Record<string, any>
const page = (data: unknown[]) => ({ data, has_more: false })
const request = (body: Record<string, unknown> = {}, route = 'execute') => new NextRequest(`http://localhost/api/admin/payments/recovery/${route}`, {
  method: 'POST', headers: { authorization: 'Bearer admin-token' }, body: JSON.stringify({ paymentId, expectedUserId: adminId, ...body }),
})
async function approve() {
  const value = await previewPaymentRecovery(paymentId)
  expect(value.eligible).toBe(true)
  return value.previewVersion!
}
const act = (version: string) => executePaymentRecovery(paymentId, adminId, version, 'Reviewed the final full bank loss.')

beforeEach(() => {
  vi.clearAllMocks(); mock.allowed = true; mock.limited = false; recovery = null
  localPayment = { ...payment }; localRefunds = []
  localDisputes = [{ stripe_dispute_id: 'du_original', status: 'lost', amount: 40, currency: 'eur' }]
  intent = { id: 'pi_original', status: 'succeeded', capture_method: 'manual', amount: 4000, amount_received: 4000, application_fee_amount: 200, currency: 'eur', livemode: false,
    metadata: { listing_id: 'listing', buyer_profile_id: 'buyer', seller_profile_id: 'seller' }, transfer_data: { destination: 'acct_originalSeller' },
    latest_charge: { id: 'ch_original', payment_intent: 'pi_original', amount: 4000, amount_captured: 4000, amount_refunded: 0, captured: true, paid: true, currency: 'eur', livemode: false, transfer: 'tr_original', application_fee: 'fee_original' } }
  transfer = { id: 'tr_original', source_transaction: 'ch_original', destination: 'acct_originalSeller', destination_payment: 'py_original', amount: 4000, amount_reversed: 0, currency: 'eur', livemode: false }
  fee = { id: 'fee_original', account: 'acct_originalSeller', originating_transaction: 'ch_original', charge: 'py_original', amount: 200, amount_refunded: 0, currency: 'eur', livemode: false, refunded: false }
  destination = { id: 'py_original', source_transfer: 'tr_original', amount: 4000, amount_captured: 4000, amount_refunded: 0, captured: true, paid: true, currency: 'eur', livemode: false, application_fee: 'fee_original', application_fee_amount: 200 }
  bank = { id: 'du_original', payment_intent: 'pi_original', charge: 'ch_original', amount: 4000, currency: 'eur', livemode: false, status: 'lost' }
  reversals = []; feeRefunds = []
  mock.payment.mockImplementation(async () => structuredClone(localPayment))
  mock.platform.mockResolvedValue({ id: 'acct_platform' })
  mock.intent.mockImplementation(async () => structuredClone(intent)); mock.transfer.mockImplementation(async () => structuredClone(transfer)); mock.fee.mockImplementation(async () => structuredClone(fee))
  mock.destination.mockImplementation(async () => structuredClone(destination))
  mock.disputes.mockImplementation(async () => page([structuredClone(bank)])); mock.refunds.mockResolvedValue(page([]))
  mock.reversals.mockImplementation(async () => page(structuredClone(reversals))); mock.feeRefunds.mockImplementation(async () => page(structuredClone(feeRefunds)))
  mock.from.mockImplementation((table: string) => {
    const data = () => table === 'payment_recoveries' ? recovery : table === 'payments' ? localPayment : table === 'disputes' ? localDisputes : localRefunds
    const query = { select: () => query, eq: () => query, limit: () => query,
      single: async () => ({ data: structuredClone(data()), error: null }), maybeSingle: async () => ({ data: structuredClone(data()), error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: structuredClone(data()), error: null }).then(resolve) }
    return query
  })
  mock.rpc.mockImplementation(async (name: string, args: Record<string, any>) => {
    if (name === 'claim_payment_recovery') {
      if (!recovery) recovery = { id: recoveryId, payment_id: paymentId, approved_by: adminId, reason: args.p_reason, preview_version: args.p_preview_version,
        stripe_platform_id: args.p_snapshot.platformId, livemode: args.p_snapshot.livemode, stripe_intent_id: args.p_snapshot.intentId,
        stripe_charge_id: args.p_snapshot.chargeId, stripe_dispute_id: args.p_snapshot.disputeId, stripe_transfer_id: args.p_snapshot.transferId,
        stripe_account_id: args.p_snapshot.accountId, stripe_fee_id: args.p_snapshot.feeId,
        gross_amount_minor: args.p_snapshot.grossAmountMinor, fee_amount_minor: args.p_snapshot.feeAmountMinor, currency: args.p_snapshot.currency,
        stripe_destination_payment_id: args.p_snapshot.destinationPaymentId, original_amount_minor: args.p_snapshot.originalAmountMinor,
        original_currency: args.p_snapshot.originalCurrency, original_requested_fee_minor: args.p_snapshot.originalRequestedFeeMinor,
        original_fee_amount_minor: args.p_snapshot.originalFeeAmountMinor, original_fee_currency: args.p_snapshot.originalFeeCurrency,
        status: 'pending', approved_at: new Date().toISOString(), completed_at: null, stripe_reversal_id: null, last_error_code: null }
      return { data: structuredClone(recovery), error: null }
    }
    if (name === 'authorize_payment_recovery_attempt') return { data: { allowed: true }, error: null }
    if (name === 'record_payment_recovery') {
      if (recovery!.status !== 'completed') recovery = { ...recovery!, status: args.p_status, stripe_reversal_id: args.p_reversal_id,
        last_error_code: args.p_error_code, completed_at: args.p_status === 'completed' ? new Date().toISOString() : null }
      return { data: structuredClone(recovery), error: null }
    }
    throw new Error(`Unexpected financial RPC ${name}`)
  })
  mock.reverse.mockImplementation(async (_id: string, body: Record<string, any>) => {
    transfer.amount_reversed = transfer.amount; fee.amount_refunded = fee.amount; fee.refunded = true; destination.amount_refunded = destination.amount
    reversals = [{ id: 'trr_original', transfer: 'tr_original', amount: transfer.amount, currency: transfer.currency, source_refund: null, metadata: body.metadata }]
    feeRefunds = [{ id: 'fr_original', fee: 'fee_original', amount: destination.application_fee_amount, currency: destination.currency }]
    return structuredClone(reversals[0])
  })
})

describe('admin recovery boundary and preview', () => {
  it('requires admin identity, account consistency, strict body, rate limit and CSRF', async () => {
    mock.allowed = false; expect((await preview(request({}, 'preview'))).status).toBe(403)
    mock.allowed = true; expect((await preview(request({ expectedUserId: paymentId }, 'preview'))).status).toBe(403)
    expect((await preview(request({ amount: 1 }, 'preview'))).status).toBe(400)
    expect((await execute(request({ previewVersion: 'a'.repeat(64), reason: 'x' }))).status).toBe(400)
    mock.limited = true; expect((await preview(request({}, 'preview'))).status).toBe(429)
    expect((await proxy(request())).status).toBe(403)
    expect(mock.rpc).not.toHaveBeenCalled(); expect(mock.reverse).not.toHaveBeenCalled()
  })
  it('preview reads exact original provider binding and gross/fee/net without approving or mutating', async () => {
    const result = await previewPaymentRecovery(paymentId)
    expect(result).toMatchObject({ eligible: true, grossAmountMinor: 4000, feeAmountMinor: 200, sellerNetAmountMinor: 3800, currency: 'eur', stripeDisputeId: 'du_original', recovery: null })
    expect(result.previewVersion).toMatch(/^[a-f0-9]{64}$/)
    expect(mock.rpc).not.toHaveBeenCalled(); expect(mock.reverse).not.toHaveBeenCalled()
    expect(mock.from.mock.calls.some(([table]) => table === 'profiles')).toBe(false)
    expect(mock.destination).toHaveBeenCalledWith('py_original', {}, expect.objectContaining({ stripeAccount: 'acct_originalSeller' }))
  })
  it.each(['partial', 'fx', 'multiple', 'refund', 'transfer', 'fee', 'reversal', 'not-lost', 'destination', 'destination-fee', 'destination-refund', 'unsupported-currency'])('blocks unsafe preview: %s', async fault => {
    if (fault === 'partial') bank.amount = 100
    if (fault === 'fx') bank.currency = 'usd'
    if (fault === 'multiple') mock.disputes.mockResolvedValue(page([bank, { ...bank, id: 'du_second' }]))
    if (fault === 'refund') mock.refunds.mockResolvedValue(page([{ id: 're_pending', status: 'pending' }]))
    if (fault === 'transfer') transfer.source_transaction = 'ch_foreign'
    if (fault === 'fee') fee.originating_transaction = 'ch_foreign'
    if (fault === 'reversal') transfer.amount_reversed = 1
    if (fault === 'not-lost') bank.status = 'won'
    if (fault === 'destination') destination.source_transfer = 'tr_foreign'
    if (fault === 'destination-fee') destination.application_fee = 'fee_foreign'
    if (fault === 'destination-refund') destination.amount_refunded = 1
    if (fault === 'unsupported-currency') transfer.currency = 'jpy'
    expect((await previewPaymentRecovery(paymentId)).eligible).toBe(false)
    expect(mock.reverse).not.toHaveBeenCalled(); expect(mock.rpc).not.toHaveBeenCalled()
  })
  it('rejects stale preview without creating authorization', async () => {
    await approve(); await expect(act('b'.repeat(64))).rejects.toThrow('προεπισκόπηση')
    expect(mock.rpc).not.toHaveBeenCalled(); expect(mock.reverse).not.toHaveBeenCalled()
  })
})

describe('approved seller transfer recovery', () => {
  it('recovers exact canonical USD settlement without deriving FX or mixing original EUR fee units', async () => {
    transfer.amount = 4460; transfer.currency = 'usd'
    Object.assign(destination, { amount: 4460, amount_captured: 4460, application_fee_amount: 223, currency: 'usd' })
    const view = await previewPaymentRecovery(paymentId)
    expect(view).toMatchObject({ eligible: true, currency: 'usd', grossAmountMinor: 4460, feeAmountMinor: 223, sellerNetAmountMinor: 4237,
      originalAmountMinor: 4000, originalCurrency: 'eur', originalFeeAmountMinor: 200, originalFeeCurrency: 'eur' })
    const result = await act(view.previewVersion!)
    expect(result.recovery?.status).toBe('completed')
    expect(mock.reverse).toHaveBeenCalledWith('tr_original', expect.objectContaining({ amount: 4460, refund_application_fee: true }), expect.anything())
    expect(mock.rpc).toHaveBeenCalledWith('record_payment_recovery', expect.objectContaining({ p_status: 'completed', p_fee_refund_id: 'fr_original', p_fee_refund_amount_minor: 223, p_fee_refund_currency: 'usd' }))
  })
  it.each(['id', 'amount', 'currency'])('rejects a foreign or mismatched linked fee refund: %s', async field => {
    const apply = mock.reverse.getMockImplementation()!
    mock.reverse.mockImplementation(async (...args: unknown[]) => {
      await apply(...args)
      if (field === 'id') feeRefunds[0].fee = 'fee_foreign'
      if (field === 'amount') feeRefunds[0].amount = 1
      if (field === 'currency') feeRefunds[0].currency = 'usd'
    })
    expect((await act(await approve())).recovery?.status).toBe('review_required')
    expect(mock.rpc.mock.calls.some(([name, args]) => name === 'record_payment_recovery' && args.p_status === 'completed')).toBe(false)
  })
  it('never retries a claim against changed destination settlement amounts', async () => {
    mock.reverse.mockRejectedValueOnce(new Error('timeout')); const version = await approve(); await act(version); mock.reverse.mockClear()
    transfer.amount = 4200; destination.amount = 4200; destination.amount_captured = 4200
    expect((await resumeApprovedRecovery(paymentId)).recovery?.status).toBe('review_required')
    expect(mock.reverse).not.toHaveBeenCalled()
  })
  it('returns completed only after exact original reversal and fee refund are verified', async () => {
    const result = await act(await approve())
    expect(result.recovery?.status).toBe('completed'); expect(result.pending).toBe(false)
    expect(mock.reverse).toHaveBeenCalledWith('tr_original', { amount: 4000, refund_application_fee: true,
      metadata: { needs_recovery_id: recoveryId, needs_payment_id: paymentId } }, expect.objectContaining({ idempotencyKey: `needs-recovery:${recoveryId}` }))
    expect(mock.rpc).toHaveBeenCalledWith('record_payment_recovery', expect.objectContaining({ p_status: 'completed', p_reversal_id: 'trr_original' }))
  })
  it('concurrent execute retries share one durable approval and one stable provider key', async () => {
    const version = await approve(); const results = await Promise.all([act(version), act(version)])
    expect(results.every(value => value.recovery?.id === recoveryId && value.recovery.status === 'completed')).toBe(true)
    expect(new Set(mock.reverse.mock.calls.map(([, , options]) => options.idempotencyKey))).toEqual(new Set([`needs-recovery:${recoveryId}`]))
  })
  it('recovers an accepted reversal after a timeout without submitting another refund or changing key', async () => {
    const apply = mock.reverse.getMockImplementation()!
    mock.reverse.mockImplementation(async (...args: unknown[]) => { await apply(...args); throw new Error('socket timeout') })
    expect((await act(await approve())).recovery?.status).toBe('completed')
    expect(mock.reverse).toHaveBeenCalledTimes(1)
  })
  it('insufficient funds stays pending with durable approval and may safely retry', async () => {
    const apply = mock.reverse.getMockImplementation()!
    mock.reverse.mockRejectedValueOnce(Object.assign(new Error('private provider diagnostic'), { code: 'balance_insufficient' }))
    const version = await approve(); const first = await act(version)
    expect(first.pending).toBe(true); expect(first.recovery?.status).toBe('pending')
    expect(first.recovery?.lastErrorCode).toBe('insufficient_seller_balance')
    expect(JSON.stringify(first)).not.toContain('private provider diagnostic')
    mock.reverse.mockImplementation(apply)
    const second = await act(version); expect(second.recovery?.id).toBe(first.recovery?.id); expect(second.recovery?.status).toBe('completed')
    expect(new Set(mock.reverse.mock.calls.map(([, , options]) => options.idempotencyKey)).size).toBe(1)
  })
  it.each(['platform', 'mode', 'won', 'fee-overlap'])('stops pending retries after changed financial facts: %s', async change => {
    mock.reverse.mockRejectedValue(new Error('timeout'))
    const version = await approve(); await act(version); mock.reverse.mockClear()
    if (change === 'platform') mock.platform.mockResolvedValue({ id: 'acct_anotherProject' })
    if (change === 'mode') { intent.livemode = true; intent.latest_charge.livemode = true; transfer.livemode = true; fee.livemode = true; bank.livemode = true }
    if (change === 'won') bank.status = 'won'
    if (change === 'fee-overlap') fee.amount_refunded = 1
    const result = await resumeApprovedRecovery(paymentId)
    expect(result.recovery?.status).toBe('review_required'); expect(mock.reverse).not.toHaveBeenCalled()
  })
  it('records irreversible provider truth and attention if a late win races accepted recovery', async () => {
    const apply = mock.reverse.getMockImplementation()!
    mock.reverse.mockImplementation(async (...args: unknown[]) => { const value = await apply(...args); bank.status = 'won'; return value })
    const result = await act(await approve())
    expect(result.recovery?.status).toBe('completed'); expect(result.recovery?.lastErrorCode).toBe('late_win_after_recovery')
  })
  it('worker performs no provider writes without approval and rejects a lost lease before mutation', async () => {
    expect(await resumeApprovedRecovery(paymentId, 'lease')).toEqual({ pending: false, recovery: null })
    expect(mock.intent).not.toHaveBeenCalled(); expect(mock.reverse).not.toHaveBeenCalled()
    mock.reverse.mockRejectedValue(new Error('timeout')); await act(await approve()); mock.reverse.mockClear()
    const original = mock.rpc.getMockImplementation()!
    mock.rpc.mockImplementation((name, args) => name === 'authorize_payment_recovery_attempt' ? { data: { allowed: false, reason: 'lease_lost' }, error: null } : original(name, args))
    await expect(resumeApprovedRecovery(paymentId, 'expired-lease')).rejects.toThrow('lease')
    expect(mock.reverse).not.toHaveBeenCalled()
  })
  it('HTTP status distinguishes pending provider result from verified completion', async () => {
    const version = await approve(); mock.reverse.mockRejectedValueOnce(new Error('timeout'))
    expect((await execute(request({ previewVersion: version, reason: 'Verified full loss.' }))).status).toBe(202)
    expect((await execute(request({ previewVersion: version, reason: 'Same approved retry.' }))).status).toBe(200)
  })
})
