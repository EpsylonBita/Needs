import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../../../../app/api/admin/status/route'

vi.mock('@/lib/auth/admin', () => ({
  requireAdmin: vi.fn(async (req: any) => ({ allowed: req.headers.get('x-admin') === 'true', user: { id: 'u1', email: 'admin@test' } }))
}))

vi.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      const chain: any = {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn(async () => ({ data: [{ id: 'evt_1', created_at: '2025-01-01', event_type: 'payment_intent.succeeded', status: 'processed' }], error: null }))
      }
      return chain
    })
  }
}))

describe('Admin Status', () => {
  it('rejects non-admin with X-Request-Id', async () => {
    const req = new NextRequest('http://localhost/api/admin/status', { method: 'GET', headers: {} }) as any
    const res = await GET(req)
    const data = await res.json()
    expect(res.status).toBe(403)
    expect(data.error).toBe('forbidden')
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
  })

  it('returns envStatus and webhooks with X-Request-Id', async () => {
    const req = new NextRequest('http://localhost/api/admin/status', { method: 'GET', headers: { 'x-admin': 'true' } }) as any
    const res = await GET(req)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.envStatus).toBeDefined()
    expect(Array.isArray(data.webhooks)).toBe(true)
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
  })
})
