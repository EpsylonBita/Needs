import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as exportData } from '@/app/api/account/export/route'
import { GET as status, POST as deletion } from '@/app/api/account/deletion/route'
import { GET as queue, PATCH as review } from '@/app/api/admin/account-requests/route'

const ids = { owner: '10000000-0000-4000-8000-000000000001', other: '10000000-0000-4000-8000-000000000002', admin: '10000000-0000-4000-8000-000000000003', request: '20000000-0000-4000-8000-000000000001' }
const boundary = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), rate: vi.fn(), admin: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: { auth: { getUser: boundary.getUser }, rpc: boundary.rpc } }))
vi.mock('@/lib/utils/rate-limit-enhanced', () => ({ rateLimitEnhanced: boundary.rate }))
vi.mock('@/lib/auth/admin', () => ({ requireAdmin: boundary.admin }))
function token(claims: Record<string, unknown> = {}) {
  return `header.${Buffer.from(JSON.stringify({ sub: ids.owner, amr: [{ method: 'password', timestamp: Date.now() / 1000 }], ...claims })).toString('base64url')}.signature`
}
function req(path: string, options: { token?: string | null; expected?: string; body?: unknown; method?: string } = {}) {
  return new NextRequest(`http://localhost/api/${path}${path.includes('?') ? '&' : '?'}expectedUserId=${options.expected ?? ids.owner}`, {
    method: options.method ?? (options.body ? 'POST' : 'GET'),
    headers: { ...(options.token !== null ? { Authorization: `Bearer ${options.token ?? token()}` } : {}), 'Content-Type': 'application/json' },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  boundary.getUser.mockResolvedValue({ data: { user: { id: ids.owner, email: 'owner@example.test', created_at: '2026-01-01', last_sign_in_at: new Date().toISOString(), app_metadata: { secret: 'NEVER_EXPORT' }, user_metadata: { fullName: 'Owner', phoneNumber: '123456789', token: 'NEVER_EXPORT' } } }, error: null })
  boundary.rpc.mockResolvedValue({ data: { profile: { display_name: 'Owner' } }, error: null })
  boundary.rate.mockResolvedValue({ allowed: true })
  boundary.admin.mockResolvedValue({ allowed: true, user: { id: ids.admin } })
})
describe('account privacy API boundaries', () => {
  it('rejects missing, invalid or mismatched sessions before data access', async () => {
    expect((await exportData(req('account/export', { token: null }))).status).toBe(401)
    expect((await exportData(req('account/export', { expected: ids.other }))).status).toBe(403)
    boundary.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'expired' } })
    expect((await exportData(req('account/export'))).status).toBe(401)
    expect(boundary.rpc).not.toHaveBeenCalled()
  })

  it.each([
    { amr: [{ method: 'password', timestamp: Date.now() / 1000 - 7200 }], iat: Date.now() / 1000 },
    { amr: [{ method: 'anonymous', timestamp: Date.now() / 1000 }] },
    { amr: ['password'] }, { amr: [] }, { amr: [{ method: 'password', timestamp: Date.now() / 1000 + 3600 }] }, { sub: ids.other },
  ])('requires real recent authentication, ignoring refresh time or mutable user fields: %j', async claims => {
    const response = await exportData(req('account/export', { token: token(claims) }))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'REAUTH_REQUIRED' })
    expect(boundary.rpc).not.toHaveBeenCalled()
  })

  it('exports the authenticated account through a strict metadata allowlist and prevents caching', async () => {
    const response = await exportData(req('account/export'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('content-disposition')).toContain('attachment')
    expect(boundary.rpc).toHaveBeenCalledWith('export_account_data', { p_user_id: ids.owner })
    const data = await response.json()
    expect(data.account).toMatchObject({ id: ids.owner, email: 'owner@example.test', full_name: 'Owner' })
    expect(JSON.stringify(data)).not.toContain('NEVER_EXPORT')
    expect(data.scope).toContain('sent messages')
  })

  it('fails closed on rate limiting and database failures without disclosing internal errors', async () => {
    boundary.rate.mockResolvedValueOnce({ allowed: false })
    expect((await exportData(req('account/export'))).status).toBe(429)
    expect(boundary.rpc).not.toHaveBeenCalled()
    boundary.rpc.mockResolvedValueOnce({ data: null, error: { message: 'postgres credentials: NEVER_EXPORT' } })
    const failed = await exportData(req('account/export'))
    expect(failed.status).toBe(503); expect(await failed.text()).not.toContain('NEVER_EXPORT')
    boundary.rpc.mockResolvedValueOnce({ data: null, error: { code: '54000' } })
    expect((await exportData(req('account/export'))).status).toBe(413)
  })

  it('reads own request status without claiming the account was deleted', async () => {
    boundary.rpc.mockResolvedValueOnce({ data: { request: null, blockers: {} }, error: null })
    const response = await status(req('account/deletion', { token: token({ amr: [] }) }))
    expect(response.status).toBe(200)
    expect(boundary.rpc).toHaveBeenCalledWith('get_account_deletion_status', { p_user_id: ids.owner })
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('requires explicit confirmation, rejects arbitrary fields and stores a request for the verified owner', async () => {
    for (const body of [
      { expectedUserId: ids.owner, action: 'request' },
      { expectedUserId: ids.owner, action: 'request', confirmation: 'DELETE', user_id: ids.other },
      { expectedUserId: ids.owner, action: 'delete', confirmation: 'DELETE' },
    ]) expect((await deletion(req('account/deletion', { body }))).status).toBe(400)
    expect(boundary.rpc).not.toHaveBeenCalled()
    const body = { expectedUserId: ids.owner, action: 'request', confirmation: 'DELETE' }
    expect((await deletion(req('account/deletion', { body, token: token({ amr: [] }) }))).status).toBe(403)
    expect((await deletion(req('account/deletion', { body }))).status).toBe(200)
    expect(boundary.rpc).toHaveBeenCalledWith('request_account_deletion', { p_user_id: ids.owner })
  })

  it('binds cancellation to the authenticated owner and surfaces stale requests', async () => {
    const body = { expectedUserId: ids.other, action: 'cancel', requestId: ids.request }
    expect((await deletion(req('account/deletion', { body }))).status).toBe(403)
    expect(boundary.rpc).not.toHaveBeenCalled()
    boundary.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } })
    expect((await deletion(req('account/deletion', { body: { ...body, expectedUserId: ids.owner } }))).status).toBe(409)
    expect(boundary.rpc).toHaveBeenCalledWith('cancel_account_deletion', { p_user_id: ids.owner, p_request_id: ids.request })
  })

  it('protects admin reads and review writes and rejects a fabricated completed/deleted status', async () => {
    boundary.admin.mockResolvedValue({ allowed: false })
    expect((await queue(req('admin/account-requests'))).status).toBe(403)
    expect((await review(req('admin/account-requests', { method: 'PATCH', body: {} }))).status).toBe(403)
    expect(boundary.rpc).not.toHaveBeenCalled()
    boundary.admin.mockResolvedValue({ allowed: true, user: { id: ids.admin } })
    expect((await review(req('admin/account-requests', { method: 'PATCH', body: { requestId: ids.request, status: 'completed', response: 'Deleted everything' } }))).status).toBe(400)
    const response = await review(req('admin/account-requests', { method: 'PATCH', body: { requestId: ids.request, status: 'reviewing', response: 'Your request is being reviewed.' } }))
    expect(response.status).toBe(200)
    expect(boundary.rpc).toHaveBeenCalledWith('review_account_deletion_request', { p_request_id: ids.request, p_admin_id: ids.admin, p_status: 'reviewing', p_response: 'Your request is being reviewed.' })
  })

  it('bounds admin pages and rejects invalid cursors', async () => {
    expect((await queue(req('admin/account-requests?before=bad&id=bad'))).status).toBe(400)
    expect((await queue(req('admin/account-requests'))).status).toBe(200)
    expect(boundary.rpc).toHaveBeenCalledWith('list_account_deletion_requests', { p_before_created_at: null, p_before_id: null, p_limit: 20 })
  })
})
