import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '../../../../../app/api/admin/listings/[id]/unsuspend/route'
import { supabaseAdmin } from '@/lib/supabase/server'

vi.mock('@/lib/auth/admin', () => ({
  requireAdmin: vi.fn(async () => ({ allowed: true, user: { email: 'admin@test' } }))
}))

vi.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    rpc: vi.fn(async () => ({ data: { status: 'active', moderation_suspended: false }, error: null }))
  }
}))

describe('Admin Listings Unsuspend', () => {
  it('POST returns success with X-Request-Id', async () => {
    const url = 'http://localhost/api/admin/listings/10000000-0000-4000-8000-000000000001/unsuspend'
    const req = new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' }, body: JSON.stringify({ note: 'resolved' }) })
    const res = await POST(req)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('moderate_listing', { p_listing_id: '10000000-0000-4000-8000-000000000001', p_suspended: false, p_admin_email: 'admin@test', p_note: 'resolved' })
  })
})
