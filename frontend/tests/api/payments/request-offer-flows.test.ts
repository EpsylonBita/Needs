import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  actor: '10000000-0000-4000-8000-000000000001',
  owner: '10000000-0000-4000-8000-000000000001',
  provider: '10000000-0000-4000-8000-000000000002',
  listing: '20000000-0000-4000-8000-000000000001',
  chat: '30000000-0000-4000-8000-000000000001',
  category: 'Services', subcategory: 'I want',
  description: '', price: 100,
  chatListing: '', members: [] as string[],
  milestones: [] as Record<string, unknown>[],
  create: vi.fn(), rpc: vi.fn(),
}))
vi.mock('@/lib/stripe/server', () => ({ stripe: {
  accounts: { retrieve: vi.fn(async () => ({ capabilities: { transfers: 'active' } })) },
  paymentIntents: { create: state.create, retrieve: vi.fn(), cancel: vi.fn() },
} }))
vi.mock('@/lib/utils/logger', () => ({ log: vi.fn() }))
vi.mock('@/lib/utils/rate-limit-enhanced', () => ({
  rateLimitEnhanced: vi.fn(async () => ({ allowed: true })),
  RateLimitConfigs: { PAYMENTS: { key: (s: string) => s }, MILESTONES: { key: (s: string) => s } },
}))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: {
  auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'auth-user' } }, error: null })) },
  rpc: state.rpc,
  from: (table: string) => {
    const filters: Record<string, unknown> = {}
    const rows = () => {
      if (table === 'feature_flags') return [{ enabled: true }]
      if (table === 'profiles') return filters.user_id ? [{ id: state.actor }] : [{ id: filters.id, stripe_account_id: 'acct_' + filters.id }]
      if (table === 'listings') return [{ id: state.listing, seller_id: state.owner, price: state.price, title: 'Need a plumber', description: state.description, status: 'active', main_category: state.category, sub_category: state.subcategory }]
      if (table === 'chats') return [{ id: state.chat, type: 'direct', listing_id: state.chatListing }]
      if (table === 'chat_participants') return state.members.map(user_id => ({ user_id }))
      if (table === 'milestones') return state.milestones.filter(row => Object.entries(filters).every(([key, value]) => row[key] === value))
      return []
    }
    const query: any = {
      select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query },
      is: () => query, order: () => query, limit: () => query,
      single: async () => ({ data: rows()[0] || null, error: null }),
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      insert: async () => ({ error: null }), update: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
    }
    return query
  },
} }))
import { POST as checkout } from '@/app/api/payments/create-intent/route'
import { POST as fundMilestone } from '@/app/api/payments/milestones/create-intent/route'
import { POST as proposeMilestone } from '@/app/api/milestones/create/route'
import { GET as context } from '@/app/api/payments/context/route'

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/payments/create-intent', {
    method: 'POST', headers: { Authorization: 'Bearer token' }, body: JSON.stringify({ listingId: state.listing, ...body }),
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  state.actor = state.owner
  state.category = 'Services'; state.subcategory = 'I want'
  state.description = ''; state.price = 100
  state.chatListing = state.listing
  state.members = [state.owner, state.provider]
  state.milestones = []
  state.create.mockResolvedValue({ id: 'pi_request', client_secret: 'secret' })
  state.rpc.mockResolvedValue({ data: { payment_id: 'payment', milestone_id: 'milestone' }, error: null })
})

describe('Request and offer payment roles', () => {
  it('requires price confirmation for stored zero-rate listings instead of suggesting a free exchange', async () => {
    state.description = 'Home care 10€/hour'; state.price = 0;
    const response = await context(new NextRequest(`http://localhost/api/payments/context?listingId=${state.listing}&chatId=${state.chat}`, { headers: { Authorization: 'Bearer token' } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ amount: 0, isFree: false, canPay: false, requiresAgreement: true, priceNeedsConfirmation: true, priceUnit: 'hour' });
    for (const endpoint of [checkout, fundMilestone, proposeMilestone]) {
      expect((await endpoint(request({ chatId: state.chat, title: 'First visit', amount: 40 }))).status).toBe(400);
    }
    expect(state.create).not.toHaveBeenCalled();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('keeps an explicit Items/Free exchange free even if prior rate wording remains', async () => {
    state.description = 'Previously rented at 10€/hour'; state.price = 0;
    state.category = 'Items'; state.subcategory = 'Free';
    const response = await context(new NextRequest(`http://localhost/api/payments/context?listingId=${state.listing}&chatId=${state.chat}`, { headers: { Authorization: 'Bearer token' } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ isFree: true, canPay: false, requiresAgreement: false, priceNeedsConfirmation: false, priceUnit: null });
  });

  it.each(['μπορω να αναλαβω ηλικιωμενους κατοικον με 10 ευρω την ωρα', 'Care costs 10€/hour or 100€/day', 'Care costs 10€/week', 'από 20€ στα 10 την ώρα', 'was €20 now 10 per week'])('does not silently bill a rate as a total: %s', async description => {
    state.description = description
    for (const endpoint of [checkout, fundMilestone, proposeMilestone]) {
      const result = await endpoint(request({ chatId: state.chat, title: 'First visit', amount: 40 }))
      expect(result.status).toBe(400)
      expect(JSON.stringify(await result.json())).toContain('rate per unit')
    }
    expect(state.create).not.toHaveBeenCalled()
    expect(state.rpc).not.toHaveBeenCalled()
  })

  it('keeps a stated total for a duration payable without treating it as a recurring rate', async () => {
    state.description = 'The full visit costs 100€ for 2 hours'
    expect((await checkout(request({ chatId: state.chat }))).status).toBe(200)
    expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 10000 }), expect.anything())
  })

  it('returns a non-free hourly rate with agreement instructions instead of a payable total', async () => {
    state.description = 'μπορω να αναλαβω ηλικιωμενους κατοικον με 10 ευρω την ωρα'
    const response = await context(new NextRequest(`http://localhost/api/payments/context?listingId=${state.listing}&chatId=${state.chat}`, { headers: { Authorization: 'Bearer token' } }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ canPay: false, isFree: false, requiresAgreement: true, priceUnit: 'hour' })
    expect(state.create).not.toHaveBeenCalled()
  })

  it.each([['Services', 'I want'], ['Items', 'Buy']])('lets the %s/%s requester pay their chat provider', async (category, subcategory) => {
    state.category = category; state.subcategory = subcategory
    const response = await checkout(request({ chatId: state.chat }))
    expect(response.status).toBe(200)
    expect(state.create).toHaveBeenCalledWith(expect.objectContaining({
      amount: 10000, transfer_data: { destination: 'acct_' + state.provider },
      metadata: expect.objectContaining({ buyer_profile_id: state.owner, seller_profile_id: state.provider }),
    }), expect.anything())
    expect(state.rpc).toHaveBeenCalledWith('create_listing_payment', expect.objectContaining({ p_buyer_id: state.owner, p_seller_id: state.provider, p_chat_id: state.chat }))
  })
  it('never charges the responding provider for a request', async () => {
    state.actor = state.provider
    expect((await checkout(request({ chatId: state.chat }))).status).toBe(403)
    expect(state.create).not.toHaveBeenCalled()
  })
  it('requires a specific conversation for a request', async () => {
    expect((await checkout(request({}))).status).toBe(400)
    expect(state.create).not.toHaveBeenCalled()
  })
  it.each(['wrong-listing', 'missing-owner', 'group', 'outsider'])('rejects %s conversation context before creating money movement', async scenario => {
    if (scenario === 'wrong-listing') state.chatListing = 'another-listing'
    if (scenario === 'missing-owner') state.members = [state.provider, 'other']
    if (scenario === 'group') state.members.push('other')
    if (scenario === 'outsider') state.actor = 'other'
    expect((await checkout(request({ chatId: state.chat }))).status).toBeGreaterThanOrEqual(400)
    expect(state.create).not.toHaveBeenCalled()
  })
  it('keeps offer checkout payable by the interested buyer to the publisher', async () => {
    state.category = 'Items'; state.subcategory = 'Sell'; state.actor = state.provider
    expect((await checkout(request({}))).status).toBe(200)
    expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ transfer_data: { destination: 'acct_' + state.owner } }), expect.anything())
  })
  it('never charges for a Free listing even if legacy data has a price', async () => {
    state.category = 'Items'; state.subcategory = 'Free'; state.actor = state.provider
    expect((await checkout(request({ chatId: state.chat }))).status).toBe(400)
    expect(state.create).not.toHaveBeenCalled()
  })
  it('funds request milestones in the same direction as the agreed conversation', async () => {
    expect((await fundMilestone(request({ chatId: state.chat, title: 'First visit', amount: 40 }))).status).toBe(200)
    expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ transfer_data: { destination: 'acct_' + state.provider } }), expect.anything())
  })
  it('passes conversation identity into atomic milestone proposals', async () => {
    state.rpc.mockResolvedValue({ data: 'proposal', error: null })
    expect((await proposeMilestone(request({ chatId: state.chat, title: 'First visit', amount: 40 }))).status).toBe(200)
    expect(state.rpc).toHaveBeenCalledWith('create_milestone_proposal', expect.objectContaining({ p_buyer_id: state.owner, p_chat_id: state.chat }))
  })
  it('funds a saved request milestone with its persisted provider and conversation', async () => {
    const milestoneId = '40000000-0000-4000-8000-000000000001'
    state.milestones = [{ id: milestoneId, listing_id: state.listing, buyer_id: state.owner, seller_id: state.provider,
      chat_id: state.chat, title: 'First visit', amount: 40, status: 'pending', stripe_payment_intent: null }]
    expect((await fundMilestone(request({ milestoneId, title: 'First visit', amount: 40 }))).status).toBe(200)
    expect(state.rpc).toHaveBeenCalledWith('create_milestone_payment', expect.objectContaining({ p_seller_id: state.provider, p_chat_id: state.chat, p_milestone_id: milestoneId }))
    expect((await fundMilestone(request({ milestoneId, title: 'First visit', amount: 40, chatId: '30000000-0000-4000-8000-000000000099' }))).status).toBe(400)
  })
  it('serves payer context only to members without caching private roles', async () => {
    const get = () => context(new NextRequest(`http://localhost/api/payments/context?listingId=${state.listing}&chatId=${state.chat}`, { headers: { Authorization: 'Bearer token' } }))
    const response = await get()
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toMatchObject({ buyerId: state.owner, sellerId: state.provider, canPay: true, isFree: false })
    state.actor = state.provider
    expect(await (await get()).json()).toMatchObject({ canPay: false, sellerId: state.provider })
    state.actor = 'outsider'
    expect((await get()).status).toBe(403)
  })
})
