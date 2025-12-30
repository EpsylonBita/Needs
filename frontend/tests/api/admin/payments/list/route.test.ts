import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../../../../../app/api/admin/payments/list/route'

vi.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn(async () => ({ data: [
          { id: 'p1', status: 'completed', amount: 100, platform_fee: 5, buyer_id: 'b1', seller_id: 's1', stripe_payment_intent: 'pi_1', created_at: '2025-01-01T00:00:00Z' },
          { id: 'p2', status: 'failed', amount: 200, platform_fee: 10, buyer_id: 'b2', seller_id: 's2', stripe_payment_intent: 'pi_2', created_at: '2025-02-01T00:00:00Z' }
        ], count: 2, error: null }))
      }
      return chain
    })
  }
}))

describe('Admin Payments List', () => {
  it('GET returns rows and total with X-Request-Id', async () => {
    const req = new NextRequest('http://localhost/api/admin/payments/list?status=all&year=2025&limit=10&offset=0', { method: 'GET' }) as any
    const res = await GET(req)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(Array.isArray(data.rows)).toBe(true)
    expect(data.total).toBe(2)
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
  })
})
