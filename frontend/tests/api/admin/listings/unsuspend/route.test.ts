import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '../../../../../app/api/admin/listings/[id]/unsuspend/route'

vi.mock('@/lib/auth/admin', () => ({
  requireAdmin: vi.fn(async () => ({ allowed: true, user: { email: 'admin@test' } }))
}))

vi.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'listings') {
        return {
          update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }))
        }
      }
      if (table === 'moderation_logs') {
        return {
          insert: vi.fn(async () => ({ error: null }))
        }
      }
      return {}
    })
  }
}))

describe('Admin Listings Unsuspend', () => {
  it('POST returns success with X-Request-Id', async () => {
    const url = 'http://localhost/api/admin/listings/abc123/unsuspend'
    const req = new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' }, body: JSON.stringify({ note: 'resolved' }) }) as any
    const res = await POST(req)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
  })
})
