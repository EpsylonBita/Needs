import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ payments: [] as { id: string | number; amount: number; platform_fee: number; currency: string; created_at: string }[], error: null as unknown, countError: null as unknown, from: vi.fn(), select: vi.fn(), eq: vi.fn(), gte: vi.fn(), lt: vi.fn() }))
vi.mock('@/lib/auth/admin', () => ({ requireAdmin: vi.fn(async (request: NextRequest) => ({ allowed: request.headers.get('authorization') === 'Bearer admin-token', reason: 'forbidden' })) }))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: { from: mocks.from } }))
import { GET as listDisputes } from '@/app/api/admin/disputes/list/route'
import { GET as exportPayments } from '@/app/api/admin/payments/export/route'
import { GET as listPayments } from '@/app/api/admin/payments/list/route'
import { GET } from '@/app/api/payments/admin/summary/route'

function request(query = '', token = 'admin-token') {
  return new NextRequest('http://localhost/api/payments/admin/summary' + query, { headers: token ? { Authorization: 'Bearer ' + token } : {} })
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.payments = [
    { id: 'p1', amount: 100, platform_fee: 5, currency: 'eur', created_at: '2026-10-01T00:00:00Z' },
    { id: 'p2', amount: 50, platform_fee: 2.5, currency: 'usd', created_at: '2026-10-01T00:00:00Z' },
  ]
  mocks.error = null
  mocks.countError = null
  mocks.from.mockImplementation((table: string) => {
    const chain = {
      select: (...args: unknown[]) => { mocks.select(table, ...args); return chain }, order: () => chain,
      eq: (...args: unknown[]) => { mocks.eq(table, ...args); return chain },
      gte: (...args: unknown[]) => { mocks.gte(...args); return chain },
      lt: (...args: unknown[]) => { mocks.lt(...args); return chain },
      range: async (start: number, end: number) => ({ data: mocks.payments.slice(start, end + 1), error: mocks.error }),
      limit: async () => ({ data: table === 'disputes' ? [{ id: 'd1', status: 'open', payment_id: 'p1' }] : [], error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ count: ({ listings: 1234, profiles: 18, disputes: 7, transactions: 2 } as Record<string, number>)[table], error: mocks.countError }).then(resolve),
    }
    return chain
  })
})

describe('Trusted payment administration reads', () => {
  it.each([GET, listPayments, exportPayments, listDisputes])('blocks untrusted callers before any privileged query', async handler => {
    expect((await handler(request('', ''))).status).toBe(403)
    expect((await handler(request('', 'user-token'))).status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('keeps monthly totals and revenue separate by currency', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toMatchObject({
      totals: [{ currency: 'EUR', volume: 100, fee: 5 }, { currency: 'USD', volume: 50, fee: 2.5 }],
      monthly: [{ month: '2026-10', currency: 'EUR', volume: 100, fee: 5 }, { month: '2026-10', currency: 'USD', volume: 50, fee: 2.5 }],
      disputes: [{ id: 'd1' }],
      overview: { activeListings: 1234, newUsers: 18, openDisputes: 7, recordedTransfers: 2 },
    })
    expect(mocks.from).not.toHaveBeenCalledWith('monthly_payments_agg')
    for (const table of ['listings', 'profiles', 'disputes', 'transactions']) expect(mocks.select).toHaveBeenCalledWith(table, 'id', { count: 'exact', head: true })
    expect(mocks.eq).toHaveBeenCalledWith('disputes', 'status', 'open')
    expect(mocks.eq).toHaveBeenCalledWith('transactions', 'type', 'transfer')
    expect(mocks.eq).toHaveBeenCalledWith('transactions', 'status', 'created')
  })
  it('reads beyond the REST row cap and uses an exclusive next-year boundary', async () => {
    mocks.payments = Array.from({ length: 1001 }, (_, id) => ({ id, amount: 1, platform_fee: 0.05, currency: 'eur', created_at: '2026-12-31T12:00:00Z' }))
    const response = await GET(request('?year=2026'))
    expect((await response.json()).totals[0].volume).toBe(1001)
    expect(mocks.gte).toHaveBeenCalledWith('created_at', '2026-01-01')
    expect(mocks.lt).toHaveBeenCalledWith('created_at', '2027-01-01')
  })
  it('returns validation and database failures without zero-value success', async () => {
    expect((await GET(request('?year=invalid'))).status).toBe(400)
    mocks.error = { message: 'unavailable' }
    expect((await GET(request())).status).toBe(500)
  })
  it('does not return false zero overview counts when a privileged count fails', async () => {
    mocks.countError = { message: 'Count unavailable' }
    const response = await GET(request())
    expect(response.status).toBe(500)
    expect(await response.json()).not.toHaveProperty('overview')
  })
})
