import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../../../../app/api/admin/check/route'

vi.mock('@/lib/auth/role-based-admin', () => ({
  requireAdmin: vi.fn(async (req: any, role: any) => {
    const ok = req.headers.get('x-admin') === 'true'
    return ok ? { allowed: true, role, user: { id: 'u1', email: 'admin@test' } } : { allowed: false, reason: 'forbidden', error: 'not_admin' }
  }),
  UserRole: { ADMIN: 'admin' }
}))

describe('Admin Check', () => {
  it('rejects non-admin', async () => {
    const req = new NextRequest('http://localhost/api/admin/check', { method: 'GET' }) as any
    const res = await GET(req)
    const data = await res.json()
    expect(res.status).toBe(403)
    expect(data.allowed).toBe(false)
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
  })

  it('returns admin details', async () => {
    const req = new NextRequest('http://localhost/api/admin/check', { method: 'GET', headers: { 'x-admin': 'true' } }) as any
    const res = await GET(req)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.allowed).toBe(true)
    expect(data.user.email).toBe('admin@test')
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
  })
})

