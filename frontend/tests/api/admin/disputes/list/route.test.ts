import { beforeEach, describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/admin/disputes/list/route'

const mocks = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn() }))
vi.mock('@/lib/auth/admin', () => ({ requireAdmin: vi.fn(async (request: NextRequest) => ({ allowed: request.headers.get('authorization') === 'Bearer admin-token', reason: 'forbidden' })) }))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: { from: mocks.from } }))

const row = { id: 'd1', status: 'won', reason: 'product_not_received', payment_id: 'p1', created_at: '2026-01-01T00:00:00Z', resolved_at: '2026-01-02T00:00:00Z', stripe_dispute_id: 'du_bank', amount: 12.5, currency: 'eur' }
beforeEach(() => {
  vi.clearAllMocks()
  const query = { select: mocks.select, eq: mocks.eq, order: mocks.order, range: mocks.range }
  mocks.from.mockReturnValue(query)
  mocks.select.mockReturnValue(query)
  mocks.eq.mockReturnValue(query)
  mocks.order.mockReturnValue(query)
  mocks.range.mockResolvedValue({ data: [row], count: 1, error: null })
})
const request = (query = '') => new NextRequest(`http://localhost/api/admin/disputes/list${query}`, { headers: { Authorization: 'Bearer admin-token' } })

describe('Admin Disputes List', () => {
  it('returns the bank identity and amount with uncached rows, total and request ID', async () => {
    const res = await GET(request('?status=all&limit=10&offset=0'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ rows: [row], total: 1 })
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mocks.select).toHaveBeenCalledWith(expect.stringContaining('stripe_dispute_id, amount, currency'), { count: 'exact' })
    expect(mocks.range).toHaveBeenCalledWith(0, 9)
  })
  it('requires authenticated admin access before reading disputes', async () => {
    const res = await GET(new NextRequest('http://localhost/api/admin/disputes/list'))
    expect(res.status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it.each(['won', 'lost'])('supports the terminal bank outcome %s', async status => {
    expect((await GET(request(`?status=${status}`))).status).toBe(200)
    expect(mocks.eq).toHaveBeenCalledWith('status', status)
  })
  it.each(['?status=unknown', '?limit=0', '?limit=101', '?limit=NaN', '?limit=1.5', '?offset=-1', '?offset=Infinity', '?offset=1000001'])('rejects invalid filter or pagination %s before a database query', async query => {
    expect((await GET(request(query))).status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
