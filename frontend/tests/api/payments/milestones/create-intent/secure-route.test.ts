import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/stripe/server', () => ({
  stripe: {
    paymentIntents: {
      create: vi.fn(),
      cancel: vi.fn()
    }
  }
}))

vi.mock('@/lib/supabase/server', () => {
  const state: Record<string, any> = {}
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockImplementation((k: string, v: any) => { state[k] = v; return chain }),
    single: vi.fn(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    update: vi.fn().mockResolvedValue({ data: null, error: null })
  }
  const supabaseAdmin = {
    auth: {
      getUser: vi.fn(async (token: string) => {
        if (token === 'test-token') return { data: { user: { id: 'user-123' } }, error: null }
        return { data: { user: null }, error: new Error('invalid') }
      })
    },
    from: vi.fn((table: string) => {
      if (table === 'profiles') {
        let lastKey: string | null = null
        chain.eq.mockImplementation((k: string, v: any) => { state[k] = v; lastKey = k; return chain })
        chain.single.mockImplementation(async () => {
          if (lastKey === 'user_id') {
            return { data: { id: 'buyer-profile-id', stripe_customer_id: 'cus_test123' } }
          }
          if (lastKey === 'id') {
            return scenario.sellerHasPayouts
              ? { data: { id: scenario.sellerId, stripe_account_id: 'seller-stripe-account', display_name: 'Seller' } }
              : { data: { id: scenario.sellerId, display_name: 'Seller' } }
          }
          return { data: null, error: { message: 'not_found' } } as any
        })
        return chain
      }
      if (table === 'listings') {
        chain.single.mockImplementation(async () => {
          const statusOk = state['status'] === 'active'
          if (statusOk && scenario.listingStatus === 'active') {
            return { data: { id: scenario.listingId, price: 100, seller_id: scenario.sellerId, title: 'Test Item', status: 'active' }, error: null }
          }
          return { data: null, error: null }
        })
        return chain
      }
      if (table === 'milestones') {
        if (chain.select.mock.calls.length === 0) {
          // first select for pending milestones total
          chain.select.mockReturnThis()
        }
        chain.select.mockReturnThis()
        chain.eq.mockImplementation((k: string, v: any) => { state[k] = v; return chain })
        ;(chain as any).then = undefined
        chain.single.mockReset()
        return {
          select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({
            // return existing pending amounts
            data: scenario.pendingMilestones.map((a: number) => ({ amount: a })), error: null
          })) })) })),
          insert: vi.fn(async () => scenario.milestonesInsertError ? { data: null, error: new Error('Failed to create milestone record') } : { data: null, error: null }),
          update: vi.fn().mockResolvedValue({ data: null, error: null })
        } as any
      }
      if (table === 'payment_audit_logs') {
        chain.insert.mockResolvedValue({ data: null, error: scenario.auditLogError ? new Error('audit error') : null })
        return chain
      }
      return chain
    })
  }
  return { supabaseAdmin }
})

vi.mock('@/lib/utils/logger', () => ({
  log: vi.fn()
}))

vi.mock('@/lib/utils/error-handler', () => ({
  withApiErrorHandler: (handler: any) => handler
}))

vi.mock('@/lib/utils/rate-limit-enhanced', () => ({
  rateLimitEnhanced: vi.fn(async () => {
    return (globalThis as any).__rateLimitResult ?? { allowed: true }
  }),
  RateLimitConfigs: {
    MILESTONES: {
      key: (ip: string) => `milestones:${ip}`,
      sustainedLimit: 10,
      sustainedWindowMs: 60_000,
      burstLimit: 3,
      burstWindowMs: 10_000,
      message: 'Rate limit exceeded'
    }
  }
}))

const scenario: any = {}
let PostHandler: any

describe('Secure Milestone Intent Creation', () => {
  let mockRequest: NextRequest
  let mockStripePaymentIntentsCreate: any
  let mockStripePaymentIntentsCancel: any

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    scenario.buyerId = 'buyer-profile-id'
    scenario.sellerId = 'seller-profile-id'
    scenario.listingId = '123e4567-e89b-12d3-a456-426614174000'
    scenario.sellerHasPayouts = true
    scenario.auditLogError = false
    scenario.listingStatus = 'active'
    scenario.pendingMilestones = []
    scenario.milestonesInsertError = false

    const stripeModule = await import('@/lib/stripe/server') as any
    const routeModule = await import('../../../../../app/api/payments/milestones/create-intent/route')
    PostHandler = routeModule.POST
    mockStripePaymentIntentsCreate = stripeModule.stripe.paymentIntents.create
    mockStripePaymentIntentsCancel = stripeModule.stripe.paymentIntents.cancel

    ;(globalThis as any).__rateLimitResult = { allowed: true }

    mockStripePaymentIntentsCreate.mockResolvedValue({
      id: 'pi_milestone_123',
      client_secret: 'pi_milestone_secret'
    })

    mockRequest = new NextRequest('http://localhost:3000/api/payments/milestones/create-intent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token'
      },
      body: JSON.stringify({
        listingId: scenario.listingId,
        title: 'Milestone A',
        amount: 50
      })
    })
  })

  it('should reject requests without authentication', async () => {
    const req = new NextRequest('http://localhost:3000/api/payments/milestones/create-intent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
    }) as any
    const response = await PostHandler(req)
    expect(response.status).toBe(401)
  })

  it('should reject invalid authentication', async () => {
    const req = new NextRequest('http://localhost:3000/api/payments/milestones/create-intent', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer bad-token' }, body: JSON.stringify({})
    }) as any
    const response = await PostHandler(req)
    expect(response.status).toBe(401)
  })

  it('should enforce rate limits', async () => {
    ;(globalThis as any).__rateLimitResult = { allowed: false, retryAfter: 60, message: 'Rate limit exceeded' }
    const response = await PostHandler(mockRequest)
    const data = await response.json()
    expect(response.status).toBe(429)
    expect(data.error).toBe('Too many milestone creation attempts. Please try again later.')
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled()
  })

  it('should reject when listing is inactive or unavailable', async () => {
    scenario.listingStatus = 'inactive'
    const response = await PostHandler(mockRequest)
    const data = await response.json()
    expect(response.status).toBe(404)
    expect(data.error).toBe('Listing not found or unavailable')
  })

  it('should prevent self-milestones', async () => {
    // simulate listing seller equals buyer by returning buyer id equal to seller id
    scenario.sellerId = 'buyer-profile-id'
    const response = await PostHandler(mockRequest)
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toBe('Cannot create milestone for your own listing')
  })

  it('should reject when milestone amount exceeds listing price', async () => {
    const req = new NextRequest('http://localhost:3000/api/payments/milestones/create-intent', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
      body: JSON.stringify({ listingId: scenario.listingId, title: 'Milestone A', amount: 200 })
    })
    const response = await PostHandler(req)
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toBe('Milestone amount cannot exceed listing price')
  })

  it('should reject when pending milestones total would exceed listing price', async () => {
    scenario.pendingMilestones = [60, 30]
    const req = new NextRequest('http://localhost:3000/api/payments/milestones/create-intent', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
      body: JSON.stringify({ listingId: scenario.listingId, title: 'Milestone B', amount: 20 })
    })
    const response = await PostHandler(req)
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toBe('Total milestone amount would exceed listing price')
  })

  it('should reject when seller not set up for payments', async () => {
    scenario.sellerHasPayouts = false
    const response = await PostHandler(mockRequest)
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toBe('Seller not set up for payments')
  })

  it('should create milestone intent with metadata and audit log', async () => {
    const response = await PostHandler(mockRequest)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.clientSecret).toBe('pi_milestone_secret')
    expect(data.milestoneId).toBe('pi_milestone_123')
    const stripeCall = mockStripePaymentIntentsCreate.mock.calls[0][0]
    expect(stripeCall.metadata).toEqual(expect.objectContaining({
      listing_id: scenario.listingId,
      seller_profile_id: 'seller-profile-id',
      buyer_profile_id: 'buyer-profile-id',
      milestone_title: 'Milestone A'
    }))
  })

  it('should rollback Stripe intent if database insert fails', async () => {
    scenario.milestonesInsertError = true
    const response = await PostHandler(mockRequest)
    expect(response.status).toBe(500)
    expect(mockStripePaymentIntentsCancel).toHaveBeenCalledWith('pi_milestone_123')
  })
})
