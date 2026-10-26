import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), user: vi.fn(), flag: { enabled: true } as { enabled: boolean } | null, flagError: null as unknown }))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: {
  auth: { getUser: mocks.user }, rpc: mocks.rpc,
  from: (table: string) => {
    const chain = { select: () => chain, eq: () => chain, limit: () => chain, single: async () => ({ data: table === 'profiles' ? { id: 'buyer-profile' } : mocks.flag, error: table === 'feature_flags' ? mocks.flagError : null }) }
    return chain
  },
} }))
import { POST } from '@/app/api/milestones/create/route'

const listingId = '00000000-0000-4000-8000-000000000003'
function request(amount: unknown, title = 'First step', token = 'token') {
  return new NextRequest('http://localhost/api/milestones/create', { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {}, body: JSON.stringify({ listingId, title, amount }) })
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.flag = { enabled: true }; mocks.flagError = null
  mocks.user.mockResolvedValue({ data: { user: { id: 'auth-user' } }, error: null })
  mocks.rpc.mockResolvedValue({ data: 'proposal-id', error: null })
})
describe('Milestone proposal validation', () => {
  it.each(['missing', 'disabled', 'error'])('fails closed when its feature flag is %s', async state => {
    mocks.flag = state === 'missing' ? null : { enabled: state !== 'disabled' }
    mocks.flagError = state === 'error' ? new Error('offline') : null
    expect((await POST(request(5))).status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([-1, '-12', '1,000.00', '', 'EUR 5', 0, 1.234])('rejects malformed or unsafe amount %s', async amount => {
    expect((await POST(request(amount))).status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('accepts decimal comma without changing the amount and keeps chat response compatible', async () => {
    const response = await POST(request('12,50', ' First step '))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, id: 'proposal-id' })
    expect(mocks.rpc).toHaveBeenCalledWith('create_milestone_proposal', { p_listing_id: listingId, p_buyer_id: 'buyer-profile', p_title: 'First step', p_amount: 12.5, p_chat_id: null })
  })
  it('rejects blank titles and unsigned requests', async () => {
    expect((await POST(request(5, ' '))).status).toBe(400)
    expect((await POST(request(5, 'Title', ''))).status).toBe(401)
  })
  it('returns atomic total validation failures without reporting success', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Total milestone amount would exceed listing price' } })
    const response = await POST(request(5))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'Total milestone amount would exceed listing price' })
  })
})
