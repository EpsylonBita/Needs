import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../../../../../app/api/admin/kpi/overview/route'

vi.mock('@/lib/auth/role-based-admin', () => ({
  requireAdmin: vi.fn(async () => ({ allowed: true, user: { id: 'admin1', email: 'admin@test' }, role: 'admin' })),
  UserRole: { ADMIN: 'admin' }
}))

vi.mock('@/lib/utils/rate-limit-enhanced', () => ({
  rateLimitEnhanced: vi.fn(async () => ({ allowed: true })),
  RateLimitConfigs: { ADMIN: { key: (x: string) => `admin:${x}`, limit: 50, windowMs: 60000, message: 'admin rate' } }
}))

vi.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => (table === 'disputes' ? Promise.resolve({ data: [], count: 3 }) : ({ gte: vi.fn(() => Promise.resolve({ data: [], count: 5 })) }))),
        gte: vi.fn(() => Promise.resolve({ data: [], count: 5 }))
      }))
    }))
  }
}))

describe('Admin KPI Overview', () => {
  it('GET returns KPIs with X-Request-Id', async () => {
    const req = new NextRequest('http://localhost/api/admin/kpi/overview', { method: 'GET', headers: { Authorization: 'Bearer token' } }) as any
    const res = await GET(req)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.payments.last24h).toBeDefined()
    expect(data.disputes.open).toBeDefined()
    expect(data.users.new7d).toBeDefined()
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
  })
})
