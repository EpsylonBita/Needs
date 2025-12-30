import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST, GET } from '../../../../app/api/admin/create-user/route'

vi.mock('@/lib/utils/rate-limit', () => ({
  rateLimit: vi.fn(async () => ({ allowed: true }))
}))

vi.mock('@/lib/auth/role-based-admin', () => ({
  requireAdmin: vi.fn(async () => ({ allowed: true, user: { id: 'admin123', email: 'admin@test.com' }, role: 'admin' })),
  UserRole: { ADMIN: 'admin' }
}))

vi.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        createUser: vi.fn(async ({ email }: any) => ({ data: { user: { id: 'new-user-id', email } }, error: null })),
        deleteUser: vi.fn(async () => ({ error: null }))
      }
    },
    from: vi.fn(() => ({
      insert: vi.fn(async () => ({ error: null }))
    }))
  }
}))

describe('Admin Create User', () => {
  it('POST returns X-Request-Id on success', async () => {
    const body = { email: 'newuser@example.com', display_name: 'New User', role: 'user' }
    const req = new NextRequest('http://localhost/api/admin/create-user', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' }, body: JSON.stringify(body) }) as any
    const res = await POST(req)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
  })

  it('GET returns method not allowed with X-Request-Id', async () => {
    const req = new NextRequest('http://localhost/api/admin/create-user', { method: 'GET' }) as any
    const res = await GET(req)
    const data = await res.json()
    expect(res.status).toBe(405)
    expect(data.error).toBe('Method not allowed')
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
  })
})
