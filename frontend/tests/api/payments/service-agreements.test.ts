import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  owner: '10000000-0000-4000-8000-000000000001', buyer: '10000000-0000-4000-8000-000000000002', outsider: '10000000-0000-4000-8000-000000000003',
  listingId: '20000000-0000-4000-8000-000000000001', chatId: '30000000-0000-4000-8000-000000000001', agreementId: '40000000-0000-4000-8000-000000000001',
  actor: '', auth: true, allowed: true, left: false,
  listing: {} as Record<string, unknown>, agreement: null as Record<string, unknown> | null, previous: null as Record<string, unknown> | null,
  rpc: vi.fn(), create: vi.fn(), retrieve: vi.fn(), cancel: vi.fn(), from: vi.fn(),
}))
vi.mock('@/lib/stripe/server', () => ({ stripe: {
  accounts: { retrieve: vi.fn(async () => ({ capabilities: { transfers: 'active' } })) },
  paymentIntents: { create: state.create, retrieve: state.retrieve, cancel: state.cancel },
} }))
vi.mock('@/lib/utils/logger', () => ({ log: vi.fn() }))
vi.mock('@/lib/utils/rate-limit-enhanced', () => ({ rateLimitEnhanced: vi.fn(async () => ({ allowed: state.allowed })), RateLimitConfigs: { PAYMENTS: { key: (value: string) => value } } }))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: {
  auth: { getUser: vi.fn(async () => ({ data: { user: state.auth ? { id: 'auth-user' } : null }, error: null })) },
  rpc: state.rpc,
  from: (table: string) => {
    state.from(table)
    const filters: Record<string, unknown> = {}
    const rows = () => {
      if (table === 'feature_flags') return [{ enabled: true }]
      if (table === 'profiles') return filters.user_id ? [{ id: state.actor }] : [{ id: filters.id, stripe_account_id: 'acct_provider' }]
      if (table === 'listings') return [state.listing]
      if (table === 'chats') return [{ id: state.chatId, listing_id: state.listingId, type: 'direct' }]
      if (table === 'chat_participants') return [{ user_id: state.owner, left_at: null }, { user_id: state.buyer, left_at: state.left ? '2026-10-26T00:00:00Z' : null }]
      if (table === 'service_price_agreements') return state.agreement ? [state.agreement].filter(row => Object.entries(filters).every(([key, value]) => row[key] === value)) : []
      if (table === 'payments') return state.previous ? [state.previous] : []
      return []
    }
    const query = {
      select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query },
      is: () => query, order: () => query, limit: () => query, update: () => query,
      insert: async () => ({ error: null }),
      single: async () => ({ data: rows()[0] || null, error: null }),
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
    }
    return query
  },
} }))

import { POST as mutate } from '@/app/api/payments/agreements/route'
import { POST as checkout } from '@/app/api/payments/create-intent/route'
import { GET as context } from '@/app/api/payments/context/route'

function request(extra: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/payments/agreements', { method: 'POST', headers: { Authorization: 'Bearer token' },
    body: JSON.stringify({ listingId: state.listingId, chatId: state.chatId, ...extra }) })
}
function accepted() {
  state.agreement = { id: state.agreementId, listing_id: state.listingId, chat_id: state.chatId, buyer_id: state.buyer, seller_id: state.owner,
    proposed_by: state.owner, accepted_by: state.buyer, amount: 75, currency: 'eur', status: 'accepted', created_at: '2026-10-26T12:00:00Z', checkout_started_at: null,
    listing_snapshot: { title: state.listing.title, description: state.listing.description, price: state.listing.price,
      main_category: state.listing.main_category, sub_category: state.listing.sub_category, seller_id: state.owner } }
}
beforeEach(() => {
  vi.clearAllMocks()
  state.actor = state.buyer; state.auth = true; state.allowed = true; state.left = false
  state.listing = { id: state.listingId, seller_id: state.owner, title: 'Φροντίδα ηλικιωμένων', description: '10 ευρώ την ώρα', price: 10, main_category: 'Services', sub_category: 'I can' }
  state.agreement = null; state.previous = null
  state.rpc.mockResolvedValue({ data: { payment_id: 'payment-id' }, error: null })
  state.create.mockResolvedValue({ id: 'pi_agreed', client_secret: 'fixture-secret' })
  state.cancel.mockResolvedValue({ id: 'pi_agreed', status: 'canceled' })
})

describe('service total agreement API', () => {
  it.each(['owner', 'buyer'] as const)('allows the %s to propose a total, independently of payment/milestone flags', async actor => {
    state.actor = state[actor]
    expect((await mutate(request({ action: 'propose', amount: 75.5, expectedAgreementId: null }))).status).toBe(200)
    expect(state.rpc).toHaveBeenCalledWith('propose_service_price_agreement', { p_listing_id: state.listingId, p_chat_id: state.chatId, p_actor_id: state.actor, p_amount: 75.5, p_expected_agreement_id: null })
    expect(state.create).not.toHaveBeenCalled()
    expect(state.from).not.toHaveBeenCalledWith('feature_flags')
  })
  it.each([0, -1, 0.49, 12.345, 1000000, '50'])('rejects invalid total %s before mutation', async amount => {
    expect((await mutate(request({ action: 'propose', amount, expectedAgreementId: null }))).status).toBe(400)
    expect(state.rpc).not.toHaveBeenCalled()
  })
  it.each(['outsider', 'left', 'signedOut', 'throttled'])('blocks %s without database mutation', async failure => {
    if (failure === 'outsider') state.actor = state.outsider
    if (failure === 'left') state.left = true
    if (failure === 'signedOut') state.auth = false
    if (failure === 'throttled') state.allowed = false
    expect((await mutate(request({ action: 'propose', amount: 75, expectedAgreementId: null }))).status).toBeGreaterThanOrEqual(400)
    expect(state.rpc).not.toHaveBeenCalled()
  })
  it('binds a response to its supplied listing and conversation', async () => {
    accepted(); state.agreement!.chat_id = '30000000-0000-4000-8000-000000000009'
    expect((await mutate(request({ action: 'accept', agreementId: state.agreementId }))).status).toBe(400)
    expect(state.rpc).not.toHaveBeenCalled()
  })
  it('returns a refresh conflict on stale or self-acceptance rejected atomically', async () => {
    accepted(); state.agreement!.status = 'proposed'; state.agreement!.accepted_by = null
    state.actor = state.owner
    state.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Only the other participant can accept' } })
    const response = await mutate(request({ action: 'accept', agreementId: state.agreementId }))
    expect(response.status).toBe(409)
    expect((await response.json()).error).toContain('Refresh')
  })
  it('enables only the buyer to pay the accepted total while retaining the hourly rate', async () => {
    accepted()
    const result = await context(new NextRequest(`http://localhost/api/payments/context?listingId=${state.listingId}&chatId=${state.chatId}`, { headers: { Authorization: 'Bearer token' } }))
    expect(await result.json()).toMatchObject({ canPay: true, requiresAgreement: true, amount: 10, serviceAgreementEligible: true,
      agreement: { id: state.agreementId, status: 'accepted', amount: 75 }, canAcceptAgreement: false })
    state.actor = state.owner
    expect(await (await context(new NextRequest(`http://localhost/api/payments/context?listingId=${state.listingId}&chatId=${state.chatId}`, { headers: { Authorization: 'Bearer token' } }))).json()).toMatchObject({ canPay: false })
  })
  it('marks changed terms stale and disables payment', async () => {
    accepted(); state.listing.description = '20 ευρώ την ώρα'
    const result = await context(new NextRequest(`http://localhost/api/payments/context?listingId=${state.listingId}&chatId=${state.chatId}`, { headers: { Authorization: 'Bearer token' } }))
    expect(await result.json()).toMatchObject({ canPay: false, agreement: { stale: true } })
  })
  it('unlocks an externally canceled checkout on explicit reconciliation without creating or canceling a Stripe intent', async () => {
    accepted(); state.actor = state.owner; state.agreement!.checkout_started_at = '2026-10-26T13:00:00Z'
    state.previous = { stripe_payment_intent: 'pi_existing' }
    state.retrieve.mockResolvedValue({ id: 'pi_existing', status: 'canceled' })
    expect((await mutate(request({ action: 'reconcile', agreementId: state.agreementId }))).status).toBe(200)
    expect(state.rpc).toHaveBeenCalledWith('retire_service_agreement_payment', { p_agreement_id: state.agreementId, p_buyer_id: state.buyer, p_intent_id: 'pi_existing' })
    expect(state.create).not.toHaveBeenCalled(); expect(state.cancel).not.toHaveBeenCalled()
  })
  it.each(['requires_payment_method', 'requires_capture', 'processing', 'succeeded'])('does not unlock a %s Stripe checkout', async status => {
    accepted(); state.previous = { stripe_payment_intent: 'pi_existing' }
    state.retrieve.mockResolvedValue({ id: 'pi_existing', status })
    expect((await mutate(request({ action: 'reconcile', agreementId: state.agreementId }))).status).toBe(200)
    expect(state.rpc).not.toHaveBeenCalled()
  })
})

describe('checkout of an accepted service total', () => {
  it.each([[0.50, 50, 3], [1.10, 110, 6], [199.99, 19999, 1000]])('rounds the 5%% fee consistently for a EUR%s total', async (total, cents, fee) => {
    accepted(); state.agreement!.amount = total
    expect((await checkout(request({ agreementId: state.agreementId }))).status).toBe(200)
    expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ amount: cents, application_fee_amount: fee }), expect.anything())
  })
  it('charges the accepted EUR75, ignores a forged client amount, and uses the agreement persistence RPC', async () => {
    accepted()
    const response = await checkout(request({ agreementId: state.agreementId, amount: 0.01 }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ totalAmount: 75, platformFee: 3.75, sellerAmount: 71.25 })
    expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 7500, application_fee_amount: 375, capture_method: 'manual',
      metadata: expect.objectContaining({ service_agreement_id: state.agreementId, chat_id: state.chatId }) }), { idempotencyKey: `service-agreement:eur:${state.agreementId}:7500` })
    expect(state.rpc).toHaveBeenCalledWith('create_agreed_service_payment', { p_agreement_id: state.agreementId, p_buyer_id: state.buyer, p_intent_id: 'pi_agreed' })
  })
  it('supports a requester paying the provider and a missing legacy hourly amount', async () => {
    state.listing.sub_category = 'I want'; state.listing.price = 0; state.actor = state.owner
    accepted(); state.agreement!.buyer_id = state.owner; state.agreement!.seller_id = state.buyer
    expect((await checkout(request({ agreementId: state.agreementId }))).status).toBe(200)
    expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 7500 }), expect.anything())
  })
  it.each(['missing', 'pending', 'stale', 'wrongId', 'provider', 'left'])('rejects %s agreements before Stripe', async failure => {
    accepted()
    if (failure === 'missing') state.agreement = null
    if (failure === 'pending') { state.agreement!.status = 'proposed'; state.agreement!.accepted_by = null }
    if (failure === 'stale') state.listing.title = 'Different work'
    if (failure === 'provider') state.actor = state.owner
    if (failure === 'left') state.left = true
    expect((await checkout(request({ agreementId: failure === 'wrongId' ? '40000000-0000-4000-8000-000000000009' : state.agreementId }))).status).toBeGreaterThanOrEqual(400)
    expect(state.create).not.toHaveBeenCalled()
  })
  it('cancels an unpersisted intent if acceptance changes during Stripe creation', async () => {
    accepted()
    state.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'The agreement changed' } })
    const response = await checkout(request({ agreementId: state.agreementId }))
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(state.cancel).toHaveBeenCalledWith('pi_agreed')
    expect(JSON.stringify(await response.json())).not.toContain('fixture-secret')
  })
  it('keeps an uncertain persistence outcome recoverable without canceling a possibly saved intent', async () => {
    accepted()
    state.rpc.mockResolvedValue({ data: null, error: { code: 'ETIMEDOUT', message: 'Timeout' } })
    expect((await checkout(request({ agreementId: state.agreementId }))).status).toBeGreaterThanOrEqual(400)
    expect(state.cancel).not.toHaveBeenCalled()
  })
  it.each(['succeeded', 'requires_capture', 'processing'])('does not create a second payment when Stripe reports %s', async status => {
    accepted(); state.previous = { id: 'payment-id', stripe_payment_intent: 'pi_existing', seller_id: state.owner, amount: 75, platform_fee: 3.75, currency: 'eur' }
    state.retrieve.mockResolvedValue({ id: 'pi_existing', status })
    expect((await checkout(request({ agreementId: state.agreementId }))).status).toBe(409)
    expect(state.create).not.toHaveBeenCalled()
  })
  it('resumes a failed-but-reusable attempt instead of creating a second intent', async () => {
    accepted(); state.previous = { id: 'payment-id', stripe_payment_intent: 'pi_existing', status: 'failed', seller_id: state.owner, amount: 75, platform_fee: 3.75, currency: 'eur' }
    state.retrieve.mockResolvedValue({ id: 'pi_existing', status: 'requires_payment_method', client_secret: 'resume-secret', amount: 7500, currency: 'eur', application_fee_amount: 375,
      metadata: { service_agreement_id: state.agreementId }, transfer_data: { destination: 'acct_provider' } })
    expect((await checkout(request({ agreementId: state.agreementId }))).status).toBe(200)
    expect(state.create).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled()
  })
  it('records Stripe-confirmed cancellation before creating a replacement attempt', async () => {
    accepted(); state.previous = { id: 'payment-id', stripe_payment_intent: 'pi_existing', seller_id: state.owner, amount: 75, platform_fee: 3.75, currency: 'eur' }
    state.retrieve.mockResolvedValue({ id: 'pi_existing', status: 'canceled' })
    expect((await checkout(request({ agreementId: state.agreementId }))).status).toBe(200)
    expect(state.rpc.mock.calls[0]).toEqual(['retire_service_agreement_payment', { p_agreement_id: state.agreementId, p_buyer_id: state.buyer, p_intent_id: 'pi_existing' }])
    expect(state.create).toHaveBeenCalledWith(expect.anything(), { idempotencyKey: `service-agreement:eur:${state.agreementId}:7500:after:pi_existing` })
  })
  it('does not expose a resumed secret when Stripe details differ from the agreement', async () => {
    accepted(); state.previous = { id: 'payment-id', stripe_payment_intent: 'pi_existing', seller_id: state.owner, amount: 75, platform_fee: 3.75, currency: 'eur' }
    state.retrieve.mockResolvedValue({ id: 'pi_existing', status: 'requires_payment_method', client_secret: 'wrong-secret', amount: 1000, currency: 'eur' })
    const response = await checkout(request({ agreementId: state.agreementId }))
    expect(response.status).toBe(409)
    expect(JSON.stringify(await response.json())).not.toContain('wrong-secret')
    expect(state.create).not.toHaveBeenCalled()
  })
})
