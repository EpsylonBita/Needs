import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/admin/disputes/export/route'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn() }))
vi.mock('@/lib/auth/admin', () => ({ requireAdmin: mocks.auth }))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: { from: mocks.from } }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ allowed: false })
  const query = { select: mocks.select, eq: mocks.eq, order: mocks.order }
  mocks.from.mockReturnValue(query)
  mocks.select.mockReturnValue(query)
  mocks.eq.mockReturnValue(query)
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
    expect(await result.text()).toBe('id,status,reason,payment_id,created_at,stripe_dispute_id,amount,currency,resolved_at')
  })
  it('exports bank identifiers, actual amounts and safely quoted text without losing commas or newlines', async () => {
    mocks.auth.mockResolvedValue({ allowed: true })
    mocks.order.mockResolvedValue({ data: [{ id: 'd1', status: 'lost', reason: '=formula,"quoted"\nsecond line', payment_id: 'p1', created_at: '2026-01-01', stripe_dispute_id: 'du_bank', amount: 12.5, currency: 'eur', resolved_at: null }], error: null })
    const result = await GET(new NextRequest('http://localhost/api/admin/disputes/export?status=lost'))
    const csv = await result.text()
    expect(result.status).toBe(200)
    expect(mocks.eq).toHaveBeenCalledWith('status', 'lost')
    expect(mocks.select).toHaveBeenCalledWith(expect.stringContaining('stripe_dispute_id, amount, currency'))
    expect(csv).toContain('"\'=formula,""quoted""\nsecond line"')
    expect(csv).toContain('"du_bank","12.5","eur",""')
  })
  it('rejects an invalid status before reading disputes', async () => {
    mocks.auth.mockResolvedValue({ allowed: true })
    const result = await GET(new NextRequest('http://localhost/api/admin/disputes/export?status=invalid'))
    expect(result.status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('returns a failed export as an error rather than an empty CSV', async () => {
    mocks.auth.mockResolvedValue({ allowed: true })
    mocks.order.mockResolvedValue({ data: null, error: { message: 'database unavailable' } })
    const result = await GET(new NextRequest('http://localhost/api/admin/disputes/export'))
    expect(result.status).toBe(500)
    expect(result.headers.get('content-type')).toContain('application/json')
  })
})
