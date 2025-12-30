import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as RefundPOST } from '../../../../app/api/payments/disputes/[id]/refund/route'
import { POST as ResolvePOST } from '../../../../app/api/payments/disputes/[id]/resolve/route'

vi.mock('@/lib/auth/admin', () => ({
  requireAdmin: vi.fn(async (req: any) => {
    const ok = req.headers.get('x-admin') === 'true'
    return ok ? { allowed: true, user: { email: 'admin@test' } } : { allowed: false, reason: 'forbidden' }
  })
}))

vi.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(),
        update: vi.fn(() => ({ eq: vi.fn(async () => ({ data: null, error: null })) }))
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
    refunds: { create: vi.fn(async () => ({ id: 're_1' })) }
  }
}))

vi.mock('@/lib/utils/error-handler', () => ({
  withApiErrorHandler: (handler: any) => handler
}))

vi.mock('@/lib/utils/rate-limit-enhanced', () => ({
  rateLimitEnhanced: vi.fn(async () => ({ allowed: true })),
  RateLimitConfigs: { ADMIN: { key: (x: string) => `admin:${x}`, limit: 50, windowMs: 60000, message: 'admin rate' } }
}))

describe('Admin Dispute Routes', () => {
  it('refund requires admin', async () => {
    const req = new NextRequest('http://localhost/api/payments/disputes/1/refund', { method: 'POST', headers: {} }) as any
    const res = await RefundPOST(req)
    expect(res.status).toBe(403)
  })

  it('resolve requires admin', async () => {
    const req = new NextRequest('http://localhost/api/payments/disputes/1/resolve', { method: 'POST', headers: {} }) as any
    const res = await ResolvePOST(req)
    expect(res.status).toBe(403)
  })
})
