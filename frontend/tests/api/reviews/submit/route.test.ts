import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ user: vi.fn(), rpc: vi.fn(), payments: [] as { id: string; listing_id: string }[], filters: vi.fn(), paymentError: null as unknown }))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: {
  auth: { getUser: mocks.user }, rpc: mocks.rpc,
  from: (table: string) => {
    const chain = {
      select: () => chain,
      eq: (column: string, value: string) => { mocks.filters(table, column, value); return chain },
      maybeSingle: async () => ({ data: { id: 'payer-profile' }, error: null }),
      limit: async () => ({ data: mocks.payments, error: mocks.paymentError }),
    }
    return chain
  },
} }))
import { POST } from '@/app/api/reviews/submit/route'

const listingId = '00000000-0000-4000-8000-000000000001'
const paymentId = '00000000-0000-4000-8000-000000000002'
function request(body: unknown, token = 'session-token') {
  return new NextRequest('http://localhost/api/reviews/submit', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.user.mockResolvedValue({ data: { user: { id: 'auth-user' } }, error: null })
  mocks.rpc.mockResolvedValue({ data: 'review-id', error: null })
  mocks.payments = [{ id: paymentId, listing_id: listingId }]
  mocks.paymentError = null
})

describe('Reviews are bound to an eligible completed payment', () => {
  it('rejects an explicit previous account before looking up or submitting a review', async () => {
    const response = await POST(request({ paymentId, rating: 5, expectedUserId: listingId }))
    expect(response.status).toBe(403)
    expect(mocks.filters).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('uses authenticated payer identity and lets the database derive the actual provider', async () => {
    const response = await POST(request({ paymentId, rating: 5, comment: ' Good work ', reviewerId: 'forged', sellerId: 'publisher' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, reviewId: 'review-id' })
    expect(mocks.filters).toHaveBeenCalledWith('payments', 'buyer_id', 'payer-profile')
    expect(mocks.filters).toHaveBeenCalledWith('payments', 'status', 'completed')
    expect(mocks.filters).toHaveBeenCalledWith('payments', 'id', paymentId)
    expect(mocks.rpc).toHaveBeenCalledWith('submit_payment_review', { p_payment_id: paymentId, p_reviewer_id: 'payer-profile', p_rating: 5, p_comment: 'Good work' })
    expect(mocks.filters).not.toHaveBeenCalledWith('listings', expect.anything(), expect.anything())
  })

  it('supports legacy listingId only when one completed payment is eligible', async () => {
    expect((await POST(request({ listingId, rating: 4 }))).status).toBe(200)
    expect(mocks.filters).toHaveBeenCalledWith('payments', 'listing_id', listingId)
    mocks.payments.push({ id: 'second-payment', listing_id: listingId })
    mocks.rpc.mockClear()
    const response = await POST(request({ listingId, rating: 4 }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'AMBIGUOUS_PAYMENT' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each([0, 6, 1.5, '5', null])('rejects invalid rating %s before writing', async rating => {
    expect((await POST(request({ paymentId, rating }))).status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each([{ rating: 5 }, { paymentId: 'bad-id', rating: 5 }, { paymentId, rating: 5, comment: 'x'.repeat(4001) }])('rejects malformed review %o', async body => {
    expect((await POST(request(body))).status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('requires authentication and an eligible payment', async () => {
    expect((await POST(request({ paymentId, rating: 5 }, ''))).status).toBe(401)
    mocks.payments = []
    expect((await POST(request({ paymentId, rating: 5 }))).status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('maps a database duplicate, including concurrent submission, to a useful conflict', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23505' } })
    const response = await POST(request({ paymentId, rating: 5 }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'REVIEW_EXISTS' })
  })

  it('does not report success if settlement changes between the read and write', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    expect((await POST(request({ paymentId, rating: 5 }))).status).toBe(403)
  })
})
