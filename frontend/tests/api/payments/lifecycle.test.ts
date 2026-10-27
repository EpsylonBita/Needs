import type Stripe from 'stripe'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), retrieve: vi.fn(), cancel: vi.fn(), refunds: vi.fn(), disputes: vi.fn(), allowed: true, admin: false, userId: '', limited: false }))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: {
  auth: { getUser: async () => ({ data: { user: mock.allowed ? { id: mock.userId } : null }, error: null }) },
  rpc: (...args: unknown[]) => mock.rpc(...args), from: (...args: unknown[]) => mock.from(...args),
} }))
vi.mock('@/lib/stripe/server', () => ({ stripe: { paymentIntents: { retrieve: (...args: unknown[]) => mock.retrieve(...args), cancel: (...args: unknown[]) => mock.cancel(...args) }, disputes: { list: (...args: unknown[]) => mock.disputes(...args) } } }))
vi.mock('@/lib/stripe/refunds', () => ({ currentPaymentRefunds: (...args: unknown[]) => mock.refunds(...args) }))
vi.mock('@/lib/utils/rate-limit-enhanced', () => ({ rateLimitEnhanced: async () => ({ allowed: !mock.limited }) }))
vi.mock('@/lib/auth/admin', () => ({ requireAdmin: async () => ({ allowed: mock.admin, user: { id: mock.userId } }) }))

import { POST as cancelOrder } from '@/app/api/orders/cancel/route'
import { POST as refreshOrder } from '@/app/api/orders/reconcile/route'
import { POST as cancelAdmin } from '@/app/api/admin/payments/cancel/route'
import { releaseClaimedPayment, reconcilePayment } from '@/lib/payments/lifecycle'
import { reconcilePaymentBatch } from '@/lib/payments/reconciliation-worker'

const userId = '00000000-0000-4000-8000-000000000001'
const paymentId = '00000000-0000-4000-8000-000000000002'
const requestId = '00000000-0000-4000-8000-000000000003'
const payment = { id: paymentId, listing_id: 'listing', buyer_id: 'buyer', seller_id: 'seller', amount: 75, platform_fee: 3.75, currency: 'eur', stripe_payment_intent: 'pi_test', status: 'requires_capture', cancel_claim_id: 'claim', stripe_canceled_at: null }
const order = { id: paymentId, my_role: 'buyer', cancellation: { id: requestId, status: 'proposed' }, cancel_pending: false }
const claim = { payment_id: paymentId, intent_id: 'pi_test', claim_id: 'claim', status: 'claimed' as const }
const intent = (status = 'requires_capture') => ({ id: 'pi_test', status, amount: 7500, application_fee_amount: 375, currency: 'eur', capture_method: 'manual', amount_capturable: status === 'requires_capture' ? 7500 : 0, amount_received: status === 'succeeded' ? 7500 : 0, metadata: { listing_id: 'listing', buyer_profile_id: 'buyer', seller_profile_id: 'seller' }, latest_charge: null } as unknown as Stripe.PaymentIntent)
const request = (body: Record<string, unknown>, url = '/api/orders/cancel', authenticated = true) => new NextRequest(`http://localhost${url}`, { method: 'POST', headers: authenticated ? { authorization: 'Bearer token' } : {}, body: JSON.stringify({ paymentId, expectedUserId: userId, ...body }) })

beforeEach(() => {
  vi.clearAllMocks(); mock.allowed = true; mock.admin = false; mock.userId = userId; mock.limited = false
  mock.retrieve.mockResolvedValue(intent()); mock.cancel.mockResolvedValue(intent('canceled')); mock.refunds.mockResolvedValue([])
  mock.disputes.mockResolvedValue({ data: [], has_more: false })
  const query = { select: () => query, eq: () => query, single: async () => ({ data: payment, error: null }) }
  mock.from.mockReturnValue(query)
  mock.rpc.mockImplementation(async (name: string) => ({ data: name.includes('claim_order_cancellation') || name === 'claim_admin_order_cancellation' ? claim : ['reconcile_order_provider', 'reconcile_order_refunds', 'reconcile_order_disputes'].includes(name) ? { applied: true } : name === 'finish_order_reconciliation' ? true : order, error: null }))
})

describe('participant cancellation and provider refresh', () => {
  it('records the request through verified user identity without touching Stripe', async () => {
    expect((await cancelOrder(request({ action: 'request', expectedCancellationId: null, reason: 'Service no longer needed' }))).status).toBe(200)
    expect(mock.rpc).toHaveBeenCalledWith('request_order_cancellation', { p_payment_id: paymentId, p_user_id: userId, p_expected_cancellation_id: null, p_reason: 'Service no longer needed' })
    expect(mock.cancel).not.toHaveBeenCalled(); expect(mock.retrieve).not.toHaveBeenCalled()
  })
  it.each(['accept', 'reject', 'withdraw'])('requires the exact request for %s', async action => {
    expect((await cancelOrder(request({ action, expectedCancellationId: null }))).status).toBe(400)
    expect(mock.rpc).not.toHaveBeenCalled()
  })
  it('rejects unauthenticated, changed-account, injected amount and rate-limited requests before writes', async () => {
    const body = { action: 'request', expectedCancellationId: null, reason: 'Cancel please' }
    expect((await cancelOrder(request(body, undefined, false))).status).toBe(401)
    expect((await cancelOrder(request({ ...body, expectedUserId: paymentId }))).status).toBe(403)
    expect((await cancelOrder(request({ ...body, amount: 1 }))).status).toBe(400)
    mock.limited = true; expect((await cancelOrder(request(body))).status).toBe(429)
    expect(mock.rpc).not.toHaveBeenCalled(); expect(mock.cancel).not.toHaveBeenCalled()
  })
  it('does not reach Stripe when the database rejects self-acceptance or a stale request', async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: '23514', message: 'stale' } })
    expect((await cancelOrder(request({ action: 'accept', expectedCancellationId: requestId }))).status).toBe(409)
    expect(mock.cancel).not.toHaveBeenCalled(); expect(mock.retrieve).not.toHaveBeenCalled()
  })
  it('only reports release after a fresh provider read confirms canceled', async () => {
    mock.retrieve.mockResolvedValueOnce(intent()).mockResolvedValueOnce(intent('canceled'))
    expect((await cancelOrder(request({ action: 'accept', expectedCancellationId: requestId }))).status).toBe(200)
    expect(mock.cancel).toHaveBeenCalledWith('pi_test', { cancellation_reason: 'requested_by_customer' }, expect.objectContaining({ idempotencyKey: `order-cancel:${paymentId}:claim` }))
    expect(mock.rpc.mock.calls.findIndex(([name]) => name === 'claim_order_cancellation')).toBeLessThan(mock.rpc.mock.calls.findIndex(([name]) => name === 'reconcile_order_provider'))
  })
  it('keeps uncertain cancellation pending, with the same stable claim available to retry', async () => {
    mock.cancel.mockRejectedValue(new Error('timeout'))
    mock.retrieve.mockResolvedValueOnce(intent()).mockRejectedValueOnce(new Error('offline'))
    expect((await cancelOrder(request({ action: 'accept', expectedCancellationId: requestId }))).status).toBe(202)
  })
  it('authorizes ownership before a reconciliation provider read', async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } })
    expect((await refreshOrder(request({}))).status).toBe(403)
    expect(mock.retrieve).not.toHaveBeenCalled()
  })
  it('refreshes only from canonical Stripe data and returns the account-scoped order', async () => {
    const response = await refreshOrder(request({}))
    expect(response.status).toBe(200); expect(await response.json()).toEqual(order)
    expect(mock.rpc).toHaveBeenCalledWith('reconcile_order_provider', expect.objectContaining({ p_amount_cents: 7500, p_platform_fee_cents: 375, p_provider_status: 'requires_capture' }))
  })
})

describe('release and reconciliation recovery', () => {
  it('will never cancel a captured payment', async () => {
    mock.retrieve.mockResolvedValue(intent('succeeded'))
    await expect(releaseClaimedPayment(payment, claim)).rejects.toThrow('refund')
    expect(mock.cancel).not.toHaveBeenCalled()
  })
  it('does not cancel without a matching persistent claim', async () => {
    await expect(releaseClaimedPayment(payment, { ...claim, payment_id: requestId })).rejects.toThrow()
    expect(mock.retrieve).not.toHaveBeenCalled(); expect(mock.cancel).not.toHaveBeenCalled()
  })
  it('does not release or report success after the provider snapshot loses its lease', async () => {
    mock.rpc.mockResolvedValueOnce({ data: { applied: false, reason: 'stale_lease' }, error: null })
    await expect(releaseClaimedPayment(payment, claim, requestId)).rejects.toThrow('newer payment check')
    expect(mock.cancel).not.toHaveBeenCalled()
  })
  it('rejects changed provider identity before applying snapshots or releasing funds', async () => {
    mock.retrieve.mockResolvedValue({ ...intent(), amount: 1 })
    await expect(reconcilePayment(payment)).rejects.toThrow('provider_payment_mismatch')
    expect(mock.rpc).not.toHaveBeenCalled()
  })
  it('checks administrator role, current account and a meaningful reason', async () => {
    expect((await cancelAdmin(request({ reason: 'Admin release' }))).status).toBe(403)
    mock.admin = true
    expect((await cancelAdmin(request({ reason: 'x' }))).status).toBe(400)
    expect((await cancelAdmin(request({ reason: 'Admin release', expectedUserId: paymentId }))).status).toBe(403)
    expect(mock.cancel).not.toHaveBeenCalled()
    mock.retrieve.mockResolvedValue(intent('canceled'))
    expect((await cancelAdmin(request({ reason: 'Admin release' }))).status).toBe(200)
    expect(mock.rpc).toHaveBeenCalledWith('claim_admin_order_cancellation', { p_payment_id: paymentId, p_admin_user_id: userId, p_reason: 'Admin release' })
  })
  it('reconciles actual refund records without fabricating Stripe events', async () => {
    mock.retrieve.mockResolvedValue({ ...intent('succeeded'), latest_charge: { payment_intent: 'pi_test', amount: 7500, currency: 'eur', amount_refunded: 7500 } })
    mock.refunds.mockResolvedValue([{ id: 're_test', amount: 7500, currency: 'eur', status: 'succeeded' }])
    await reconcilePayment(payment)
    expect(mock.rpc).toHaveBeenCalledWith('reconcile_order_refunds', expect.objectContaining({ p_refunds: [{ id: 're_test', amount: 7500, currency: 'eur', status: 'succeeded', failure_reason: null }] }))
  })
  it('the worker resumes only persisted cancellation consent and records failures', async () => {
    const defaultRpc = mock.rpc.getMockImplementation()!
    mock.rpc.mockImplementation((name, parameters) => name === 'claim_order_reconciliation'
      ? Promise.resolve({ data: [{ payment_id: paymentId, intent_id: 'pi_test', lease_id: requestId }], error: null }) : defaultRpc(name, parameters))
    mock.retrieve.mockResolvedValue(intent('canceled'))
    expect(await reconcilePaymentBatch()).toEqual({ claimed: 1, completed: 1, failed: 0 })
    expect(mock.cancel).not.toHaveBeenCalled()
    mock.retrieve.mockRejectedValue(new Error('offline'))
    expect(await reconcilePaymentBatch()).toEqual({ claimed: 1, completed: 0, failed: 1 })
    expect(mock.rpc).toHaveBeenCalledWith('finish_order_reconciliation', { p_payment_id: paymentId, p_lease_id: requestId, p_error_code: 'provider_reconciliation_failed' })
  })
  it.each(['pending', 'failed'])('finds missed %s refunds even when nothing has been refunded yet', async status => {
    mock.retrieve.mockResolvedValue({ ...intent('succeeded'), latest_charge: { payment_intent: 'pi_test', amount: 7500, currency: 'eur', amount_refunded: 0 } })
    mock.refunds.mockResolvedValue([{ id: 're_test', amount: 7500, currency: 'eur', status }])
    await reconcilePayment({ ...payment, status: 'completed' })
    expect(mock.refunds).toHaveBeenCalledWith('pi_test', { timeout: 12000, maxNetworkRetries: 0 }, 100)
    expect(mock.rpc).toHaveBeenCalledWith('reconcile_order_refunds', expect.objectContaining({ p_refunds: [expect.objectContaining({ status })] }))
  })
  it('recovers a missed bank dispute before applying the refund snapshot', async () => {
    mock.retrieve.mockResolvedValue(intent('succeeded'))
    mock.disputes.mockResolvedValue({ data: [{ id: 'du_test', payment_intent: 'pi_test', amount: 7500, currency: 'eur', status: 'needs_response', reason: 'fraudulent' }], has_more: false })
    await reconcilePayment(payment)
    expect(mock.disputes).toHaveBeenCalledWith({ payment_intent: 'pi_test', limit: 100 }, { timeout: 12000, maxNetworkRetries: 0 })
    expect(mock.rpc).toHaveBeenCalledWith('reconcile_order_disputes', expect.objectContaining({ p_disputes: [{ id: 'du_test', amount: 7500, currency: 'eur', status: 'needs_response', reason: 'fraudulent' }] }))
    expect(mock.rpc.mock.calls.findIndex(([name]) => name === 'reconcile_order_disputes')).toBeLessThan(mock.rpc.mock.calls.findIndex(([name]) => name === 'reconcile_order_refunds'))
  })
  it.each(['pagination', 'identity'])('rejects an incomplete or mismatched dispute snapshot: %s', async fault => {
    mock.retrieve.mockResolvedValue(intent('succeeded'))
    mock.disputes.mockResolvedValue({ data: fault === 'identity' ? [{ id: 'du_other', payment_intent: 'pi_other' }] : [], has_more: fault === 'pagination' })
    await expect(reconcilePayment(payment)).rejects.toThrow()
    expect(mock.rpc.mock.calls.some(([name]) => name === 'reconcile_order_disputes')).toBe(false)
    expect(mock.refunds).not.toHaveBeenCalled()
  })
})
