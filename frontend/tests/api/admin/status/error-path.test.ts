import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../../../../app/api/admin/status/route'

vi.mock('@/lib/auth/admin', () => ({
  requireAdmin: vi.fn(async (req: any) => ({ allowed: true, user: { id: 'u1', email: 'admin@test' } }))
}))

vi.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => ({ data: null, error: new Error('db error') }))
    }))
  }
}))

describe('Admin Status - Error Path', () => {
  it('GET returns 500 with X-Request-Id when db error', async () => {
    const req = new NextRequest('http://localhost/api/admin/status', { method: 'GET', headers: { 'x-admin': 'true' } }) as any
    const res = await GET(req)
    const data = await res.json()
    expect(res.status).toBe(500)
    expect(data.error).toBe('Failed to fetch webhook events')
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
  })
})
