import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/admin/disputes/export/route'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), from: vi.fn(), order: vi.fn() }))
vi.mock('@/lib/auth/admin', () => ({ requireAdmin: mocks.auth }))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: { from: mocks.from } }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ allowed: false })
  mocks.from.mockReturnValue({ select: () => ({ order: mocks.order }) })
  mocks.order.mockResolvedValue({ data: [], error: null })
})
describe('admin dispute export authorization', () => {
  it('denies unauthenticated or non-admin callers before reading disputes', async () => {
    const result = await GET(new NextRequest('http://localhost/api/admin/disputes/export'))
    expect(result.status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('serves a private uncached CSV to an authorized administrator', async () => {
    mocks.auth.mockResolvedValue({ allowed: true })
    const result = await GET(new NextRequest('http://localhost/api/admin/disputes/export'))
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('private, no-store')
    expect(await result.text()).toBe('id,status,reason,payment_id,created_at')
  })
})
