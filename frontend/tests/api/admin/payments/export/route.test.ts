import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../../../../../app/api/admin/payments/export/route'

vi.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn(async () => ({ data: [
          { id: 'p1', status: 'completed', amount: 100, platform_fee: 5, buyer_id: 'b1', seller_id: 's1', stripe_payment_intent: 'pi_1', created_at: '2025-01-01T00:00:00Z' },
          { id: 'p2', status: 'failed', amount: 200, platform_fee: 10, buyer_id: 'b2', seller_id: 's2', stripe_payment_intent: 'pi_2', created_at: '2025-02-01T00:00:00Z' }
        ] }))
      }
      return chain
    })
  }
}))

describe('Admin Payments Export', () => {
  it('GET returns CSV with X-Request-Id', async () => {
    const req = new NextRequest('http://localhost/api/admin/payments/export?status=all&year=2025', { method: 'GET' }) as any
    const res = await GET(req)
    const text = await res.text()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/csv')
    expect(res.headers.get('Content-Disposition')).toContain('payments.csv')
    expect(text.split('\n')[0]).toBe('id,status,amount,platform_fee,buyer_id,seller_id,stripe_payment_intent,created_at')
    expect(text).toContain('p1')
    expect(text).toContain('p2')
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
  })
})
