import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '../../../../../app/api/payments/disputes/[id]/create/route'

vi.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u1', email: 'buyer@test' } }, error: null })) },
    from: vi.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(async () => ({ data: { id: 'profile123' }, error: null })) })) }))
        }
      }
      if (table === 'payments') {
        return {
          select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(async () => ({ data: { id: 'pay1', buyer_id: 'profile123', seller_id: 'seller456', status: 'processing' }, error: null })) })) })),
          update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }))
        }
      }
      if (table === 'disputes') {
        return {
          insert: vi.fn(async () => ({ error: null }))
        }
      }
      if (table === 'notifications') {
        return {
          insert: vi.fn(async () => ({ error: null }))
        }
      }
      return {}
    })
  }
}))

describe('Payments Disputes Create', () => {
  it('POST opens dispute and returns X-Request-Id', async () => {
    const url = 'http://localhost/api/payments/disputes/pay1/create'
    const req = new NextRequest(url, { method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body: JSON.stringify({}) }) as any
    const res = await POST(req)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
  })
})
