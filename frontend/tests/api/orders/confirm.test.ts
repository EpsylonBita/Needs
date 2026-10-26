import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ userId: '', enabled: true, flagError: null as unknown, rpc: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: {
  auth: { getUser: async () => ({ data: { user: { id: state.userId } }, error: null }) }, rpc: (...args: unknown[]) => state.rpc(...args),
  from: () => { const q = { select: () => q, eq: () => q, single: async () => ({ data: { enabled: state.enabled }, error: state.flagError }) }; return q },
} }))
import { POST } from '@/app/api/orders/confirm/route'
const userId = '00000000-0000-4000-8000-000000000001'
const paymentId = '00000000-0000-4000-8000-000000000002'
const req = (expectedUserId = userId) => new NextRequest('http://localhost/api/orders/confirm', { method: 'POST', headers: { Authorization: 'Bearer token' }, body: JSON.stringify({ paymentId, expectedUserId }) })
beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_PAYMENTS_ENABLED', 'false'); state.userId = userId; state.enabled = true; state.flagError = null; state.rpc.mockReset().mockResolvedValue({ data: { id: paymentId, my_role: 'buyer', buyer_confirmed: true }, error: null }) })
describe('order confirmation', () => {
  it('uses the verified authenticated user, not a client-selected role or profile', async () => {
    expect((await POST(req())).status).toBe(200)
    expect(state.rpc).toHaveBeenCalledWith('confirm_order', { p_payment_id: paymentId, p_user_id: userId })
  })
  it('blocks changed accounts and disabled or failed flags before writes', async () => {
    expect((await POST(req(paymentId))).status).toBe(403)
    state.enabled = false; expect((await POST(req())).status).toBe(403)
    state.enabled = true; state.flagError = new Error('offline'); expect((await POST(req())).status).toBe(403)
    expect(state.rpc).not.toHaveBeenCalled()
  })
  it('preserves the existing environment OR database flag rule', async () => {
    state.enabled = false; vi.stubEnv('NEXT_PUBLIC_PAYMENTS_ENABLED', 'true')
    expect((await POST(req())).status).toBe(200)
  })
  it('surfaces server eligibility and ownership rejection', async () => {
    state.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'Resolve the open dispute first' } })
    const response = await POST(req()); expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'Resolve the open dispute first' })
    state.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } }); expect((await POST(req())).status).toBe(403)
  })
  it('requires a verified persisted own confirmation', async () => {
    state.rpc.mockResolvedValueOnce({ data: { id: paymentId, my_role: 'seller', buyer_confirmed: true, seller_confirmed: false }, error: null })
    expect((await POST(req())).status).toBe(500)
  })
})
