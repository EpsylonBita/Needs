import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../../../../../app/api/admin/payments/export/route'
import { supabaseAdmin } from '@/lib/supabase/server'

vi.mock('@/lib/auth/admin', () => ({ requireAdmin: vi.fn(async (request: NextRequest) => ({ allowed: request.headers.get('authorization') === 'Bearer admin-token', reason: 'forbidden' })) }))

vi.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn(async () => ({ data: [
          { id: 'p1', status: 'completed', amount: 100, platform_fee: 5, buyer_id: 'b1', seller_id: 's1', stripe_payment_intent: 'pi_1', created_at: '2025-01-01T00:00:00Z', role_review_required: true },
          { id: 'p2', status: 'failed', amount: 200, platform_fee: 10, buyer_id: 'b2', seller_id: 's2', stripe_payment_intent: 'pi_2', created_at: '2025-02-01T00:00:00Z' }
        ] }))
      }
      return chain
    })
  }
}))

describe('Admin Payments Export', () => {
  it('GET returns CSV with X-Request-Id', async () => {
    const req = new NextRequest('http://localhost/api/admin/payments/export?status=all&year=2025', { method: 'GET', headers: { Authorization: 'Bearer admin-token' } }) as any
    const res = await GET(req)
    const text = await res.text()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/csv')
    expect(res.headers.get('Content-Disposition')).toContain('payments.csv')
    expect(text.split('\n')[0]).toBe('id,status,amount,platform_fee,currency,buyer_id,seller_id,stripe_payment_intent,created_at,role_review_required')
    expect(text).toContain('p1')
    expect(text).toContain('p2')
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
  })
  it('exports the review flag and applies the same administrator-review filter as the list', async () => {
    const req = new NextRequest('http://localhost/api/admin/payments/export?roleReview=required', { headers: { Authorization: 'Bearer admin-token' } })
    const response = await GET(req)
    const csv = await response.text()
    expect(response.status).toBe(200)
    const query = vi.mocked(supabaseAdmin.from).mock.results.at(-1)!.value
    expect(query.eq).toHaveBeenCalledWith('role_review_required', true)
    expect(csv.split('\n')[1].split(',').at(-1)).toBe('true')
  })
})
