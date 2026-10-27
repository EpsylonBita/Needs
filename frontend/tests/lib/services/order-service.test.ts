import { beforeEach, describe, expect, it, vi } from 'vitest'
import { captureOrder, confirmOrder, getMyOrder, getMyOrders, reconcileOrder, changeOrderCancellation, reportOrderProblem, submitOrderReview, type OrderDTO } from '@/lib/services/order-service'

const state = vi.hoisted(() => ({ userId: '', sessionId: '', rpc: vi.fn(), fetch: vi.fn(), csrf: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: state.userId } }, error: null }), getSession: async () => ({ data: { session: { user: { id: state.sessionId }, access_token: 'token' } }, error: null }) },
  rpc: (...args: unknown[]) => Object.assign(state.rpc(...args), { abortSignal() { return this } }),
} }))
vi.mock('@/lib/utils/csrf', () => ({ withCsrfHeaders: (...args: unknown[]) => state.csrf(...args) }))
const user = '00000000-0000-4000-8000-000000000001'
const otherUser = '00000000-0000-4000-8000-000000000002'
const profile = '00000000-0000-4000-8000-000000000003'
const otherProfile = '00000000-0000-4000-8000-000000000004'
const payment = '00000000-0000-4000-8000-000000000005'
const listing = '00000000-0000-4000-8000-000000000006'
const row: OrderDTO = {
  id: payment, created_at: '2026-10-19T12:00:00Z', status: 'requires_capture', amount: 12.5, currency: 'eur', platform_fee: 0.63,
  payments_enabled: false, listing: { id: listing, title: 'A chair', thumbnail: null, available: false },
  buyer: { id: profile, display_name: 'Buyer', avatar_url: null }, seller: { id: otherProfile, display_name: 'Provider', avatar_url: null },
  my_role: 'buyer', chat_id: null, milestone: null, buyer_confirmed: false, seller_confirmed: true, role_review_required: false,
  authorization_state: 'authorized', capture_pending: false, complaint: null, disputes: [], refund: { succeeded_amount: 0, pending_amount: 0, failed: false }, review: null,
  authorization: { expires_at: null, last_checked_at: null, provider_status: null, attention_required: true }, cancellation: null, cancel_pending: false, stripe_canceled_at: null,
  actions: { can_confirm: true, can_capture: false, can_complain: true, can_review: false, can_request_cancel: false, can_accept_cancel: false, can_reject_cancel: false, can_withdraw_cancel: false, can_reconcile: true },
}
const page = () => ({ profile_id: profile, payments_enabled: false, rows: [row], next_cursor: null })
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_PAYMENTS_ENABLED', 'false')
  state.userId = user; state.sessionId = user
  state.rpc.mockReset().mockResolvedValue({ data: page(), error: null })
  state.fetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ success: true, disputeId: payment }) })
  state.csrf.mockReset().mockImplementation(async headers => ({ ...headers, 'X-CSRF-Token': 'csrf' }))
  vi.stubGlobal('fetch', state.fetch)
})

describe('account-bound orders service', () => {
  it('reads real money, unavailable historical listings and server eligibility with the existing disabled flag', async () => {
    const result = await getMyOrders(user)
    expect(result.rows[0]).toMatchObject({ amount: 12.5, currency: 'eur', listing: { available: false }, actions: { can_confirm: false, can_complain: true } })
    expect(state.rpc).toHaveBeenCalledWith('get_my_orders', { p_expected_user_id: user, p_before_created_at: null, p_before_id: null, p_limit: 20 })
  })
  it('preserves env OR database enablement and never invents action eligibility', async () => {
    vi.stubEnv('NEXT_PUBLIC_PAYMENTS_ENABLED', 'true')
    expect((await getMyOrders(user)).rows[0].actions).toMatchObject({ can_confirm: true, can_capture: false })
    vi.stubEnv('NEXT_PUBLIC_PAYMENTS_ENABLED', 'false')
    state.rpc.mockResolvedValue({ data: { ...row, payments_enabled: true }, error: null })
    expect((await getMyOrder(payment, user)).actions.can_confirm).toBe(true)
  })
  it('passes keyset cursors and honors aborted reads', async () => {
    const cursor = { created_at: row.created_at, id: payment }
    await getMyOrders(user, cursor)
    expect(state.rpc.mock.calls[0][1]).toMatchObject({ p_before_created_at: row.created_at, p_before_id: payment })
    const controller = new AbortController(); controller.abort()
    await expect(getMyOrder(payment, user, controller.signal)).rejects.toThrow()
    expect(state.rpc).toHaveBeenCalledTimes(1)
  })
  it('rejects wrong-account reads before RPC and discards delayed prior-account results', async () => {
    await expect(getMyOrders(otherUser)).rejects.toThrow('account changed')
    expect(state.rpc).not.toHaveBeenCalled()
    state.rpc.mockImplementation(async () => { state.userId = otherUser; return { data: page(), error: null } })
    await expect(getMyOrders(user)).rejects.toThrow('account changed')
  })
  it('shows real errors instead of empty orders and rejects malformed or foreign rows', async () => {
    state.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Read denied' } })
    await expect(getMyOrders(user)).rejects.toThrow('Read denied')
    state.rpc.mockResolvedValueOnce({ data: { ...page(), rows: [{ ...row, amount: NaN }] }, error: null })
    await expect(getMyOrders(user)).rejects.toThrow('verified')
    state.rpc.mockResolvedValueOnce({ data: { ...page(), profile_id: otherProfile }, error: null })
    await expect(getMyOrders(user)).rejects.toThrow('verified')
    state.rpc.mockResolvedValueOnce({ data: { ...row, id: listing }, error: null })
    await expect(getMyOrder(payment, user)).rejects.toThrow('verified')
  })
  it('uses an explicit captured account and CSRF for reports without promising a refund', async () => {
    await expect(reportOrderProblem(payment, user)).resolves.toEqual({ success: true, disputeId: payment })
    expect(state.fetch).toHaveBeenCalledWith(`/api/payments/disputes/${payment}/create`, expect.objectContaining({ headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token', 'X-CSRF-Token': 'csrf' }, body: JSON.stringify({ expectedUserId: user }) }))
  })
  it('blocks changed sessions and account switches while preparing secure requests', async () => {
    state.sessionId = otherUser
    await expect(reportOrderProblem(payment, user)).rejects.toThrow('account changed')
    state.sessionId = user
    state.csrf.mockImplementation(async () => { state.userId = otherUser; return { 'X-CSRF-Token': 'csrf' } })
    await expect(reportOrderProblem(payment, user)).rejects.toThrow('account changed')
    expect(state.fetch).not.toHaveBeenCalled()
  })
  it('does not return late mutation success after changing accounts', async () => {
    state.fetch.mockImplementation(async () => { state.userId = otherUser; return { ok: true, json: async () => ({ success: true, disputeId: payment }) } })
    await expect(reportOrderProblem(payment, user)).rejects.toThrow('account changed')
  })
  it('surfaces rejected and unverified complaint results', async () => {
    state.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Capture reconciliation is pending' }) })
    await expect(reportOrderProblem(payment, user)).rejects.toThrow('Capture reconciliation is pending')
    state.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
    await expect(reportOrderProblem(payment, user)).rejects.toThrow('could not be verified')
  })
  it('requires actual persisted own confirmation and reports capture uncertainty honestly', async () => {
    state.fetch.mockResolvedValueOnce({ ok: true, json: async () => row })
    await expect(confirmOrder(payment, user)).rejects.toThrow('confirmation could not be verified')
    state.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ...row, buyer_confirmed: true }) })
    expect((await confirmOrder(payment, user)).buyer_confirmed).toBe(true)
    state.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ captured: false, pending: true, status: 'verification_pending' }) })
    await expect(captureOrder(payment, user)).resolves.toEqual({ captured: false, pending: true, status: 'verification_pending' })
  })
  it('submits the selected payment review, validates input and requires persisted acknowledgement', async () => {
    state.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, reviewId: payment }) })
    await expect(submitOrderReview(payment, 4, ' Good work ', user)).resolves.toEqual({ success: true, reviewId: payment })
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toEqual({ paymentId: payment, rating: 4, comment: 'Good work', expectedUserId: user })
    await expect(submitOrderReview(payment, 4.5, '', user)).rejects.toThrow()
    await expect(submitOrderReview(payment, 4, 'x'.repeat(4001), user)).rejects.toThrow()
    expect(state.fetch).toHaveBeenCalledTimes(1)
  })
  it('reconciles the provider through the explicit authenticated endpoint and keeps its exact deadline', async () => {
    const expires = '2026-10-28T15:43:21Z'
    state.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ...row, authorization: { ...row.authorization, expires_at: expires } }) })
    const controller = new AbortController()
    expect((await reconcileOrder(payment, user, controller.signal)).authorization.expires_at).toBe(expires)
    expect(state.fetch).toHaveBeenCalledWith('/api/orders/reconcile', expect.objectContaining({ signal: controller.signal, body: JSON.stringify({ paymentId: payment, expectedUserId: user }) }))
    controller.abort()
    await expect(reconcileOrder(payment, user, controller.signal)).rejects.toThrow()
    expect(state.fetch).toHaveBeenCalledTimes(1)
  })
  it('requires a reason before requesting cancellation and preserves the expected request version', async () => {
    await expect(changeOrderCancellation(payment, { action: 'request', expectedCancellationId: null }, user)).rejects.toThrow()
    await expect(changeOrderCancellation(payment, { action: 'request', expectedCancellationId: null, reason: ' no ' }, user)).rejects.toThrow()
    await expect(changeOrderCancellation(payment, { action: 'request', expectedCancellationId: null, reason: 'x'.repeat(1001) }, user)).rejects.toThrow()
    expect(state.fetch).not.toHaveBeenCalled()
    state.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ...row, actions: { ...row.actions, can_withdraw_cancel: true } }) })
    const result = await changeOrderCancellation(payment, { action: 'request', expectedCancellationId: listing, reason: ' Schedule changed ' }, user)
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toEqual({ paymentId: payment, expectedUserId: user, action: 'request', expectedCancellationId: listing, reason: 'Schedule changed' })
    expect(result.actions.can_withdraw_cancel).toBe(true)
    expect(result.payments_enabled).toBe(false)
  })
  it('accepts a 202 pending cancellation without asserting that Stripe released the money', async () => {
    state.fetch.mockResolvedValueOnce({ ok: true, status: 202, json: async () => ({ ...row, cancel_pending: true, cancellation: { id: listing, status: 'accepted', requested_by: otherProfile, reason: 'Cannot attend', requested_at: row.created_at } }) })
    const saved = await changeOrderCancellation(payment, { action: 'accept', expectedCancellationId: listing }, user)
    expect(saved.cancel_pending).toBe(true)
    expect(saved.stripe_canceled_at).toBeNull()
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toEqual({ paymentId: payment, expectedUserId: user, action: 'accept', expectedCancellationId: listing })
  })
  it('rejects malformed deadlines, foreign reconciliation results and changed-account cancellation responses', async () => {
    state.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ...row, authorization: { ...row.authorization, expires_at: 'guess-seven-days' } }) })
    await expect(reconcileOrder(payment, user)).rejects.toThrow('verified')
    state.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ...row, id: listing }) })
    await expect(reconcileOrder(payment, user)).rejects.toThrow('verified')
    state.fetch.mockImplementation(async () => { state.userId = otherUser; return { ok: true, json: async () => row } })
    await expect(changeOrderCancellation(payment, { action: 'reject', expectedCancellationId: listing }, user)).rejects.toThrow('account changed')
  })
})
