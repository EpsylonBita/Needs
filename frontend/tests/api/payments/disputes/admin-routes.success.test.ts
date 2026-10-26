import { NextRequest } from 'next/server'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST as RefundPOST } from '../../../../app/api/payments/disputes/[id]/refund/route'
import { POST as ResolvePOST } from '../../../../app/api/payments/disputes/[id]/resolve/route'

vi.mock('@/lib/auth/admin', () => ({
  requireAdmin: vi.fn(async (req: any) => ({ allowed: true, user: { email: 'admin@test' } }))
}))

vi.mock('@/lib/utils/rate-limit-enhanced', () => ({
  rateLimitEnhanced: vi.fn(async () => ({ allowed: true })),
  RateLimitConfigs: { ADMIN: { key: (x: string) => `admin:${x}`, limit: 50, windowMs: 60000, message: 'admin rate' } }
}))

vi.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    rpc: vi.fn(async () => ({ data: null, error: null })),
    from: vi.fn((table: string) => {
      const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(),
        update: vi.fn(() => ({ eq: vi.fn(async () => ({ data: null, error: null })) })),
        insert: vi.fn(async () => ({ data: null, error: null }))
      }
      if (table === 'disputes') {
        chain.single.mockResolvedValue({ data: { payment_id: 'pay-1' }, error: null })
        return chain
      }
      if (table === 'payments') {
        chain.select = vi.fn().mockReturnThis()
        chain.eq = vi.fn().mockReturnThis()
        chain.single = vi.fn().mockResolvedValue({ data: { id: 'pay-1', stripe_payment_intent: 'pi_1' }, error: null })
        return chain
      }
      return chain
    })
  }
}))

vi.mock('@/lib/stripe/server', () => ({
  stripe: {
    paymentIntents: { retrieve: vi.fn(async () => ({ id: 'pi_1', amount: 1000, status: 'succeeded', transfer_data: { destination: 'acct_seller' }, application_fee_amount: 50, latest_charge: { id: 'ch_1', refunded: false } })) },
    refunds: { create: vi.fn(async () => ({ id: 're_1', status: 'succeeded' })), list: vi.fn(async () => ({ data: [], has_more: false })) }
  }
}))


describe('Admin Dispute Routes Success', () => {
  beforeEach(() => { vi.clearAllMocks() })
  it('refund returns success with X-Request-Id', async () => {
    const req = new NextRequest('http://localhost/api/payments/disputes/1/refund', { method: 'POST', headers: { 'x-admin': 'true' } }) as any
    const res = await RefundPOST(req)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    const { stripe } = await import('@/lib/stripe/server')
    expect(stripe.refunds.create).toHaveBeenCalledWith({ payment_intent: 'pi_1', reverse_transfer: true, refund_application_fee: true }, { idempotencyKey: 'refund:pi_1' })
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
  })

  it('resolve returns success with X-Request-Id', async () => {
    const req = new NextRequest('http://localhost/api/payments/disputes/2/resolve', { method: 'POST', headers: { 'x-admin': 'true' } }) as any
    const res = await ResolvePOST(req)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
  })

  it('does not refund an uncaptured authorization', async () => {
    const { stripe } = await import('@/lib/stripe/server')
    vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValueOnce({ status: 'requires_capture' } as any)
    const res = await RefundPOST(new NextRequest('http://localhost/api/payments/disputes/1/refund', { method: 'POST' }))
    expect(res.status).toBe(409)
    expect(stripe.refunds.create).not.toHaveBeenCalled()
  })

  it('reuses the already-refunded canonical payment without another refund request', async () => {
    const { stripe } = await import('@/lib/stripe/server')
    vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValueOnce({ id: 'pi_1', amount: 1000, status: 'succeeded', latest_charge: { refunded: true } } as any)
    vi.mocked(stripe.refunds.list).mockResolvedValueOnce({ data: [{ id: 're_1', amount: 1000, status: 'succeeded' }], has_more: false } as any)
    expect((await RefundPOST(new NextRequest('http://localhost/api/payments/disputes/1/refund', { method: 'POST' }))).status).toBe(200)
    expect(stripe.refunds.create).not.toHaveBeenCalled()
  })

  it('keeps pending refunds pending and avoids creating another refund', async () => {
    const { stripe } = await import('@/lib/stripe/server')
    vi.mocked(stripe.refunds.list).mockResolvedValueOnce({ data: [{ id: 're_1', amount: 1000, status: 'pending' }], has_more: false } as any)
    const response = await RefundPOST(new NextRequest('http://localhost/api/payments/disputes/1/refund', { method: 'POST' }))
    expect((await response.json()).status).toBe('pending')
    expect(stripe.refunds.create).not.toHaveBeenCalled()
  })

  it('requires review for a failed refund instead of reusing the old idempotency key', async () => {
    const { stripe } = await import('@/lib/stripe/server')
    vi.mocked(stripe.refunds.list).mockResolvedValueOnce({ data: [{ id: 're_1', amount: 1000, status: 'failed' }], has_more: false } as any)
    expect((await RefundPOST(new NextRequest('http://localhost/api/payments/disputes/1/refund', { method: 'POST' }))).status).toBe(409)
    expect(stripe.refunds.create).not.toHaveBeenCalled()
  })

  it('does not report resolution success when the atomic database call fails', async () => {
    const { supabaseAdmin } = await import('@/lib/supabase/server')
    vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({ data: null, error: { message: 'db down' } } as any)
    expect((await ResolvePOST(new NextRequest('http://localhost/api/payments/disputes/1/resolve', { method: 'POST' }))).status).toBe(500)
  })
})
