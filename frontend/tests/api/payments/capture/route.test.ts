import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({ profile: 'buyer', enabled: true, flagError: null as unknown, payment: {} as Record<string, unknown>, rpc: vi.fn(), retrieve: vi.fn(), capture: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: {
  auth: { getUser: async (token: string) => ({ data: { user: token === 'token' ? { id: 'user' } : null }, error: null }) },
  rpc: (...args: unknown[]) => s.rpc(...args),
  from: (table: string) => { const q = { select: () => q, eq: () => q, single: async () => ({ data: table === 'profiles' ? { id: s.profile } : table === 'feature_flags' ? { enabled: s.enabled } : s.payment, error: table === 'feature_flags' ? s.flagError : null }) }; return q },
} }))
vi.mock('@/lib/stripe/server', () => ({ stripe: { paymentIntents: { retrieve: (...args: unknown[]) => s.retrieve(...args), capture: (...args: unknown[]) => s.capture(...args) } } }))
vi.mock('@/lib/utils/rate-limit-enhanced', () => ({ rateLimitEnhanced: vi.fn(async () => ({ allowed: true })), RateLimitConfigs: { PAYMENTS: { key: (v: string) => v } } }))
import { POST } from '@/app/api/payments/capture/route'
const paymentId = '00000000-0000-4000-8000-000000000001'
const intent = (status = 'requires_capture') => ({ id: 'pi_123', amount: 1250, amount_capturable: status === 'requires_capture' ? 1250 : 0, currency: 'eur', capture_method: 'manual', status, metadata: { listing_id: 'listing', buyer_profile_id: 'buyer', seller_profile_id: 'seller' } })
const request = (body: Record<string, unknown> = { paymentId, expectedUserId: 'user' }, token = 'token') => new NextRequest('http://localhost/api/payments/capture', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
const claim = { payment_id: paymentId, intent_id: 'pi_123', claim_id: 'claim-one', status: 'claimed' }
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_PAYMENTS_ENABLED', 'false')
  s.profile = 'buyer'; s.enabled = true; s.flagError = null
  s.payment = { id: paymentId, listing_id: 'listing', buyer_id: 'buyer', seller_id: 'seller', stripe_payment_intent: 'pi_123', amount: 12.5, currency: 'eur', status: 'requires_capture', role_review_required: false }
  s.rpc.mockReset().mockImplementation(async (name: string) => ({ data: name === 'claim_order_capture' ? claim : null, error: null }))
  s.retrieve.mockReset().mockResolvedValue(intent()); s.capture.mockReset().mockResolvedValue(intent('succeeded'))
})
describe('capture verifies provider state and atomically claims the order', () => {
  it('rejects unauthenticated or switched-account requests before provider access', async () => {
    expect((await POST(request({}, 'bad'))).status).toBe(401)
    expect((await POST(request({ paymentId, expectedUserId: 'another' }))).status).toBe(403)
    expect(s.retrieve).not.toHaveBeenCalled()
  })
  it.each([false, null])('fails closed on disabled or missing payment flag %s', async enabled => {
    s.enabled = enabled as boolean
    expect((await POST(request())).status).toBe(403); expect(s.retrieve).not.toHaveBeenCalled()
  })
  it('honors env OR DB enablement but fails closed on a flag read failure', async () => {
    s.flagError = new Error('offline')
    expect((await POST(request())).status).toBe(403)
    vi.stubEnv('NEXT_PUBLIC_PAYMENTS_ENABLED', 'true')
    expect((await POST(request())).status).toBe(200)
  })
  it.each(['buyer', 'seller'])('allows actual %s after DB checks canonical payment/milestone confirmations', async profile => {
    s.profile = profile
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ captured: true, pending: true, status: 'succeeded' })
    expect(s.rpc).toHaveBeenCalledWith('claim_order_capture', { p_payment_id: paymentId, p_user_id: 'user' })
    expect(s.capture).toHaveBeenCalledWith('pi_123', undefined, { idempotencyKey: 'capture:pi_123' })
    expect(s.rpc).toHaveBeenCalledWith('resolve_order_capture', { p_payment_id: paymentId, p_claim_id: 'claim-one', p_outcome: 'captured' })
  })
  it('preserves intentId callers but rejects a mismatched supplied intent', async () => {
    expect((await POST(request({ intentId: 'pi_123' }))).status).toBe(200)
    s.capture.mockClear()
    expect((await POST(request({ paymentId, intentId: 'pi_other' }))).status).toBe(400)
    expect(s.capture).not.toHaveBeenCalled()
  })
  it('denies unrelated profiles and legacy reversed roles before provider access', async () => {
    s.profile = 'stranger'; expect((await POST(request())).status).toBe(403)
    s.profile = 'buyer'; s.payment.role_review_required = true; expect((await POST(request())).status).toBe(409)
    expect(s.retrieve).not.toHaveBeenCalled()
  })
  it.each(['Both parties must confirm before capture', 'Resolve the open dispute before capturing this payment.', 'Authorization has not been verified'])('does not capture when atomic claim rejects %s', async message => {
    s.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message } })
    const response = await POST(request())
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: message }); expect(s.capture).not.toHaveBeenCalled()
  })
  it.each([{ amount: 999 }, { currency: 'usd' }, { capture_method: 'automatic' },
    { metadata: { listing_id: 'foreign', buyer_profile_id: 'buyer', seller_profile_id: 'seller' } },
    { metadata: { listing_id: 'listing', buyer_profile_id: 'foreign', seller_profile_id: 'seller' } },
    { metadata: { listing_id: 'listing', buyer_profile_id: 'buyer', seller_profile_id: 'foreign' } },
  ])('rejects mismatched provider details before claim %j', async mismatch => {
    s.retrieve.mockResolvedValue({ ...intent(), ...mismatch })
    expect((await POST(request())).status).not.toBe(200)
    expect(s.rpc).not.toHaveBeenCalled(); expect(s.capture).not.toHaveBeenCalled()
  })
  it('does not capture reduced authorization or failed stored payments', async () => {
    s.retrieve.mockResolvedValue({ ...intent(), amount_capturable: 1200 }); expect((await POST(request())).status).toBe(409)
    s.payment.status = 'failed'; expect((await POST(request())).status).toBe(409); expect(s.capture).not.toHaveBeenCalled()
  })
  it('reconciles prior provider success without capturing twice', async () => {
    s.retrieve.mockResolvedValue(intent('succeeded'))
    expect((await POST(request())).status).toBe(200); expect(s.capture).not.toHaveBeenCalled()
    expect(s.rpc).toHaveBeenCalledWith('resolve_order_capture', expect.objectContaining({ p_outcome: 'captured' }))
  })
  it('acknowledges an already settled payment without capturing or mutating local financial state', async () => {
    s.payment.status = 'completed'
    s.retrieve.mockResolvedValue(intent('succeeded'))
    s.rpc.mockResolvedValue({ data: { ...claim, status: 'completed', claim_id: null }, error: null })
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ captured: true, pending: false, status: 'succeeded' })
    expect(s.capture).not.toHaveBeenCalled()
    expect(s.rpc.mock.calls.map(call => call[0])).toEqual(['claim_order_capture'])
  })
  it('does not capture when the DB settles after the initial provider read but before the claim', async () => {
    s.rpc.mockResolvedValue({ data: { ...claim, status: 'completed', claim_id: null }, error: null })
    const response = await POST(request())
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ captured: false, pending: true, status: 'requires_capture' })
    expect(s.capture).not.toHaveBeenCalled()
    expect(s.rpc.mock.calls.map(call => call[0])).toEqual(['claim_order_capture'])
  })
  it('retains claim when capture and verification time out', async () => {
    s.capture.mockRejectedValue(new Error('Timeout after submission')); s.retrieve.mockResolvedValueOnce(intent()).mockResolvedValueOnce(intent()).mockRejectedValueOnce(new Error('Offline'))
    const response = await POST(request())
    expect(response.status).toBe(202); expect(await response.json()).toEqual({ captured: false, pending: true, status: 'verification_pending' })
    expect(s.rpc.mock.calls.map(call => call[0])).toEqual(['claim_order_capture'])
    expect(s.capture).toHaveBeenCalledTimes(1)
  })
  it('reconciles success after losing the capture response', async () => {
    s.capture.mockRejectedValue(new Error('Timeout')); s.retrieve.mockResolvedValueOnce(intent()).mockResolvedValueOnce(intent()).mockResolvedValueOnce(intent('succeeded'))
    expect((await POST(request())).status).toBe(200)
    expect(s.capture).toHaveBeenCalledTimes(1)
    expect(s.rpc).toHaveBeenCalledWith('resolve_order_capture', expect.objectContaining({ p_outcome: 'captured' }))
  })
  it('clears only provider-proven noncapture and retains processing uncertainty', async () => {
    s.retrieve.mockResolvedValue(intent('canceled')); expect((await POST(request())).status).toBe(409)
    expect(s.rpc).toHaveBeenCalledWith('resolve_order_capture', expect.objectContaining({ p_outcome: 'not_captured' }))
    s.rpc.mockClear(); s.retrieve.mockResolvedValue(intent('processing')); expect((await POST(request())).status).toBe(202)
    expect(s.rpc.mock.calls.map(call => call[0])).toEqual(['claim_order_capture']); expect(s.capture).not.toHaveBeenCalled()
  })
  it.each(['requires_payment_method', 'requires_confirmation', 'requires_action'])('retains the shared claim for mutable provider status %s', async status => {
    s.retrieve.mockResolvedValue(intent(status))
    const response = await POST(request())
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ captured: false, pending: true, status })
    expect(s.rpc.mock.calls.map(call => call[0])).toEqual(['claim_order_capture'])
    expect(s.capture).not.toHaveBeenCalled()
  })
  it('uses the post-claim provider state if another retry advanced the pre-claim snapshot', async () => {
    s.retrieve.mockResolvedValueOnce(intent('requires_payment_method')).mockResolvedValueOnce(intent('succeeded'))
    expect((await POST(request())).status).toBe(200)
    expect(s.rpc).not.toHaveBeenCalledWith('resolve_order_capture', expect.objectContaining({ p_outcome: 'not_captured' }))
    expect(s.rpc).toHaveBeenCalledWith('resolve_order_capture', expect.objectContaining({ p_outcome: 'captured' }))
    expect(s.capture).not.toHaveBeenCalled()
  })
  it('does not claim success if reconciliation acknowledgement failed', async () => {
    s.rpc.mockImplementation(async (name: string) => name === 'claim_order_capture' ? { data: claim, error: null } : { data: null, error: { message: 'Offline' } })
    expect((await POST(request())).status).toBe(500)
  })
})
