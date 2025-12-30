import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../../../../../app/api/admin/disputes/list/route'

vi.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn(async () => ({ data: [
          { id: 'd1', status: 'open', reason: 'product_not_as_described', payment_id: 'p1', created_at: '2025-01-01T00:00:00Z' },
          { id: 'd2', status: 'resolved', reason: 'seller_refund', payment_id: 'p2', created_at: '2025-02-01T00:00:00Z' }
        ], count: 2, error: null }))
      }
      return chain
    })
  }
}))

describe('Admin Disputes List', () => {
  it('GET returns rows and total with X-Request-Id', async () => {
    const req = new NextRequest('http://localhost/api/admin/disputes/list?status=all&limit=10&offset=0', { method: 'GET' }) as any
    const res = await GET(req)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(Array.isArray(data.rows)).toBe(true)
    expect(data.total).toBe(2)
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
  })
})
