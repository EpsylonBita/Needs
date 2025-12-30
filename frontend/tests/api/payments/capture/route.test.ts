import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '../../../../app/api/payments/capture/route'

vi.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    auth: {
      getUser: vi.fn(async (token: string) => token === 'test-token' ? { data: { user: { id: 'user-1' } }, error: null } : { data: { user: null }, error: new Error('invalid') })
    },
    from: vi.fn((table: string) => {
      const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn(),
        insert: vi.fn().mockResolvedValue({ data: null, error: null })
      }
      if (table === 'profiles') {
        chain.single.mockResolvedValue({ data: { id: 'profile-1' }, error: null })
        return chain
      }
      if (table === 'payments') {
        chain.single.mockResolvedValue({ data: { id: 'pay-1', buyer_confirmed: true, seller_confirmed: true, buyer_id: 'profile-1', seller_id: 'seller-1' }, error: null })
        return chain
      }
      return chain
    })
  }
}))

vi.mock('@/lib/stripe/server', () => ({
  stripe: {
    paymentIntents: {
      capture: vi.fn(async () => ({ status: 'succeeded' }))
    }
  }
}))

vi.mock('@/lib/utils/rate-limit-enhanced', () => ({
  rateLimitEnhanced: vi.fn(async () => ({ allowed: true })),
  RateLimitConfigs: {
    PAYMENTS: { key: (ip: string) => `payments:${ip}`, sustainedLimit: 5, sustainedWindowMs: 60000, burstLimit: 3, burstWindowMs: 10000, message: 'rate' }
  }
}))

describe('Capture Route', () => {
  let req: NextRequest
  beforeEach(() => {
    req = new NextRequest('http://localhost:3000/api/payments/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
      body: JSON.stringify({ intentId: 'pi_123' })
    })
  })

  it('rejects unauthenticated requests', async () => {
    const r = new NextRequest('http://localhost:3000/api/payments/capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intentId: 'pi_123' }) })
    const res = await POST(r)
    expect(res.status).toBe(401)
  })

  it('captures intent when confirmed by both parties', async () => {
    const res = await POST(req)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.captured).toBe(true)
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
  })
})
