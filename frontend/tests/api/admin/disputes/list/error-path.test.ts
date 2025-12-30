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
        range: vi.fn(async () => ({ data: null, count: null, error: new Error('db error') }))
      }
      return chain
    })
  }
}))

describe('Admin Disputes List - Error Path', () => {
  it('GET returns 500 with X-Request-Id on db error', async () => {
    const req = new NextRequest('http://localhost/api/admin/disputes/list?status=open&limit=10&offset=0', { method: 'GET' }) as any
    const res = await GET(req)
    const data = await res.json()
    expect(res.status).toBe(500)
    expect(data.error).toBeDefined()
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
  })
})
