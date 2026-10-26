import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/admin/listings/route'
import { POST as suspend } from '@/app/api/admin/listings/[id]/suspend/route'
import { POST as release } from '@/app/api/admin/listings/[id]/unsuspend/route'

const mock = vi.hoisted(() => ({ allowed: true, from: vi.fn(), rpc: vi.fn(), range: vi.fn(), eq: vi.fn(), result: { data: [] as unknown, count: 0, error: null as { code?: string; message: string } | null } }))
vi.mock('@/lib/auth/admin', () => ({ requireAdmin: vi.fn(async () => ({ allowed: mock.allowed, user: { id: 'admin-id', email: 'admin@example.invalid' } })) }))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: { from: mock.from, rpc: mock.rpc } }))
const id = '11111111-1111-4111-8111-111111111111'
const request = (suffix = '', body?: unknown) => new NextRequest(`http://localhost/api/admin/listings${suffix}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  mock.allowed = true
  mock.result = { data: [], count: 0, error: null }
  mock.rpc.mockImplementation(async () => mock.result)
  mock.range.mockImplementation(async () => mock.result)
  mock.from.mockImplementation(() => {
    const query = { select: vi.fn(), order: vi.fn(), eq: mock.eq, range: mock.range }
    query.select.mockReturnValue(query)
    query.order.mockReturnValue(query)
    mock.eq.mockReturnValue(query)
    return query
  })
})

describe('listing moderation API', () => {
  it('denies public and non-admin callers before reading or changing listings', async () => {
    mock.allowed = false
    expect((await GET(request())).status).toBe(403)
    expect((await suspend(request(`/${id}/suspend`, {}))).status).toBe(403)
    expect((await release(request(`/${id}/unsuspend`, {}))).status).toBe(403)
    expect(mock.from).not.toHaveBeenCalled()
    expect(mock.rpc).not.toHaveBeenCalled()
  })

  it('lists held records through trusted bounded reads so administrators can release them', async () => {
    const listing = { id, title: 'Held', status: 'suspended', owner_status: 'active', moderation_suspended: true }
    mock.result = { data: [listing], count: 51, error: null }
    const result = await GET(request('?page=2&filter=held'))
    expect(await result.json()).toEqual({ listings: [listing], page: 2, totalPages: 2 })
    expect(mock.eq).toHaveBeenCalledWith('moderation_suspended', true)
    expect(mock.range).toHaveBeenCalledWith(50, 99)
    expect((await GET(request('?page=-1'))).status).toBe(400)
    expect((await GET(request('?filter=arbitrary'))).status).toBe(400)
  })

  it('changes only the hold through the atomic audited RPC; release does not force active', async () => {
    mock.result.data = { id, status: 'suspended', owner_status: 'suspended', moderation_suspended: false }
    expect((await suspend(request(`/${id}/suspend`, { note: ' Review required ' }))).status).toBe(200)
    expect(mock.rpc).toHaveBeenLastCalledWith('moderate_listing', { p_listing_id: id, p_suspended: true, p_admin_email: 'admin@example.invalid', p_note: 'Review required' })
    const response = await release(request(`/${id}/unsuspend`, {}))
    expect(await response.json()).toEqual({ success: true, listing: mock.result.data })
    expect(mock.rpc).toHaveBeenLastCalledWith('moderate_listing', { p_listing_id: id, p_suspended: false, p_admin_email: 'admin@example.invalid', p_note: '' })
    expect(mock.from).not.toHaveBeenCalled()
  })

  it('rejects forged payloads and invalid IDs, and surfaces missing or failed persistence', async () => {
    expect((await suspend(request('/invalid/suspend', {}))).status).toBe(400)
    expect((await suspend(request(`/${id}/suspend`, { status: 'active' }))).status).toBe(400)
    expect((await release(request(`/${id}/unsuspend`, { note: 'x'.repeat(2001) }))).status).toBe(400)
    expect(mock.rpc).not.toHaveBeenCalled()
    mock.result.error = { code: 'P0002', message: 'Listing not found' }
    expect((await release(request(`/${id}/unsuspend`, {}))).status).toBe(404)
    mock.result.error = { code: '23514', message: 'Audit failed' }
    expect((await suspend(request(`/${id}/suspend`, {}))).status).toBeGreaterThanOrEqual(500)
  })
})
