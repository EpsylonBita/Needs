import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '../../../../../app/api/admin/logs/[id]/note/route'

vi.mock('@/lib/auth/admin', () => ({
  requireAdmin: vi.fn(async () => ({ allowed: true, user: { email: 'admin@test' } }))
}))

vi.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => ({
      update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }))
    }))
  }
}))

describe('Admin Logs Note', () => {
  it('POST updates note and returns X-Request-Id', async () => {
    const url = 'http://localhost/api/admin/logs/xyz789/note'
    const req = new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' }, body: JSON.stringify({ note: 'investigation details' }) }) as any
    const res = await POST(req)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
  })
})
