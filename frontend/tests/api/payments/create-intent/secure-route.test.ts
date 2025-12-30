import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
let PostHandler: any

const scenario: any = {
  paymentsEnabled: true,
  buyerId: 'buyer-profile-id',
  sellerId: 'seller-profile-id',
  listingId: '123e4567-e89b-12d3-a456-426614174000',
  paymentsInsertError: false,
  sellerHasPayouts: true,
  auditLogError: false,
  listingStatus: 'active'
}

// Mock dependencies first (hoisted)
vi.mock('@/lib/stripe/server', () => ({
  stripe: {
    paymentIntents: {
      create: vi.fn(),
      cancel: vi.fn()
    }
  }
}))

vi.mock('@/lib/utils/error-handler', () => ({
  withApiErrorHandler: (handler: any) => handler
}))

vi.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    auth: {
      getUser: vi.fn(async (token?: string) => {
        if (token === 'invalid-token') {
          return { data: { user: null }, error: new Error('Invalid token') }
        }
        return { data: { user: { id: 'test-user-id' } }, error: null }
      })
    },
    from: vi.fn((table: string) => {
      const state: any = {}
      const chain: any = {
        select: vi.fn().mockImplementation(() => chain),
        eq: vi.fn().mockImplementation((field: string, value: any) => {
          state[field] = value
          return chain
        }),
        single: vi.fn(),
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        update: vi.fn().mockResolvedValue({ data: null, error: null })
      }

      if (table === 'feature_flags') {
        chain.single.mockResolvedValue({ data: { enabled: scenario.paymentsEnabled } })
        return chain
      }

      if (table === 'profiles') {
        chain.single.mockImplementation(async () => {
          if (state['user_id']) {
            return { data: { id: scenario.buyerId, stripe_customer_id: 'cus_test123' } }
          }
          if (state['id']) {
            return scenario.sellerHasPayouts
              ? { data: { id: scenario.sellerId, stripe_account_id: 'seller-stripe-account', display_name: 'Seller' } }
              : { data: { id: scenario.sellerId, display_name: 'Seller' } }
          }
          return { data: null, error: { message: 'not_found' } }
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

      if (table === 'payment_audit_logs') {
        chain.insert.mockResolvedValue({ data: null, error: scenario.auditLogError ? new Error('audit error') : null })
        return chain
      }

      if (table === 'payments') {
        chain.insert.mockImplementation(async () => {
          if (scenario.paymentsInsertError) {
            return { data: null, error: new Error('Failed to create payment record') }
          }
          return { data: null, error: null }
        })
        return chain
      }

      return chain
    })
  }
}))

vi.mock('../../../../lib/utils/logger', () => ({
  log: vi.fn()
}))

vi.mock('@/lib/utils/rate-limit-enhanced', () => ({
  rateLimitEnhanced: vi.fn(async () => {
    return (globalThis as any).__rateLimitResult ?? { allowed: true }
  }),
  RateLimitConfigs: {
    PAYMENTS: {
      key: (ip: string) => `payments:${ip}`,
      sustainedLimit: 5,
      sustainedWindowMs: 60_000,
      burstLimit: 3,
      burstWindowMs: 10_000,
      message: 'Rate limit exceeded'
    }
  }
}))



describe('Secure Payment Intent Creation', () => {
  let mockRequest: NextRequest
  let mockStripePaymentIntentsCreate: any
  let mockStripePaymentIntentsCancel: any
  let mockSupabaseAuthGetUser: any
  let mockSupabaseFrom: any
  let mockLoggerLog: any
  let mockRateLimitEnhanced: any

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    scenario.paymentsEnabled = true
    scenario.buyerId = 'buyer-profile-id'
    scenario.sellerId = 'seller-profile-id'
    scenario.listingId = '123e4567-e89b-12d3-a456-426614174000'
    scenario.paymentsInsertError = false
    scenario.sellerHasPayouts = true
    scenario.auditLogError = false
    scenario.listingStatus = 'active'
    
    // Get mock functions from the mocked modules
    const stripeModule = await import('@/lib/stripe/server') as any
    const supabaseModule = await import('@/lib/supabase/server') as any
    const loggerModule = await vi.importMock('../../../../lib/utils/logger') as any
    const rateLimitModule = await vi.importMock('@/lib/utils/rate-limit-enhanced') as any
    const routeModule = await import('../../../../app/api/payments/create-intent/route')
    PostHandler = routeModule.POST
    
    mockStripePaymentIntentsCreate = stripeModule.stripe.paymentIntents.create
    mockStripePaymentIntentsCancel = stripeModule.stripe.paymentIntents.cancel
    mockSupabaseAuthGetUser = supabaseModule.supabaseAdmin.auth.getUser
    mockSupabaseFrom = supabaseModule.supabaseAdmin.from
    mockLoggerLog = loggerModule.log
    mockRateLimitEnhanced = rateLimitModule.rateLimitEnhanced
    ;(globalThis as any).__rateLimitResult = { allowed: true }
    
    // Use default mock implementations

    // Auth behavior handled by module mock (token-aware)

    // Mock Stripe
    mockStripePaymentIntentsCreate.mockResolvedValue({
      id: 'pi_test123',
      client_secret: 'pi_test_secret',
      amount: 10000
    })

    // Create mock request
    mockRequest = new NextRequest('http://localhost:3000/api/payments/create-intent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token'
      },
      body: JSON.stringify({
        listingId: scenario.listingId
      })
    })
  })

  describe('Authentication & Authorization', () => {
    it('should reject requests without authentication', async () => {
      const requestWithoutAuth = new NextRequest('http://localhost:3000/api/payments/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId: '123e4567-e89b-12d3-a456-426614174000' })
      })

      const response = await PostHandler(requestWithoutAuth)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Authentication required')
      expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled()
    })

    it('should reject requests with invalid authentication', async () => {
      mockRequest = new NextRequest('http://localhost:3000/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer invalid-token'
        },
        body: JSON.stringify({
          listingId: '123e4567-e89b-12d3-a456-426614174000'
        })
      })

      const response = await PostHandler(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Invalid authentication')
      expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled()
    })

    it('should reject self-purchases', async () => {
      // Make buyer and seller the same
      scenario.buyerId = 'same-profile-id'
      scenario.sellerId = 'same-profile-id'

      const response = await PostHandler(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Cannot purchase your own listing')
      expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled()
    })
  })

  describe('Input Validation', () => {
    it('should reject invalid listingId', async () => {
      const requestWithInvalidData = new NextRequest('http://localhost:3000/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token'
        },
        body: JSON.stringify({
          listingId: 'invalid-uuid'
        })
      })

      const response = await PostHandler(requestWithInvalidData)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request data')
      expect(data.details).toBeDefined()
    })

    it('should reject missing listingId', async () => {
      const requestWithMissingData = new NextRequest('http://localhost:3000/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token'
        },
        body: JSON.stringify({})
      })

      const response = await PostHandler(requestWithMissingData)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request data')
    })
  })

  describe('Rate Limiting', () => {
    it('should enforce rate limits', async () => {
      ;(globalThis as any).__rateLimitResult = { allowed: false, retryAfter: 60, message: 'Rate limit exceeded' }

      const response = await PostHandler(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(429)
      expect(data.error).toBe('Too many payment attempts. Please try again later.')
      expect(response.headers.get('Retry-After')).toBe('60')
      expect(response.headers.get('X-Request-Id')).toBeTruthy()
      expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled()
    })
  })

  describe('Feature Flags', () => {
    it('should reject when payments are disabled', async () => {
      scenario.paymentsEnabled = false

      const response = await PostHandler(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe('Payments are currently disabled')
      expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled()
    })
  })

  describe('Successful Payment Creation', () => {
    it('should create payment intent with proper security checks', async () => {
      const response = await PostHandler(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.clientSecret).toBe('pi_test_secret')
      expect(data.paymentId).toBe('pi_test123')
      expect(data.platformFee).toBe(5) // 5% of $100
      expect(data.totalAmount).toBe(100)
      expect(data.sellerAmount).toBe(95) // $100 - $5 fee
      expect(response.headers.get('X-Request-Id')).toBeTruthy()

      // Verify Stripe was called with secure metadata
      expect(mockStripePaymentIntentsCreate).toHaveBeenCalledWith({
        amount: 10000,
        currency: 'usd',
        application_fee_amount: 500,
        transfer_data: { destination: 'seller-stripe-account' },
        capture_method: 'manual',
        metadata: expect.objectContaining({
          listing_id: scenario.listingId,
          seller_profile_id: scenario.sellerId,
          buyer_profile_id: scenario.buyerId,
          listing_title: 'Test Item',
          platform_fee_percent: '5'
        }),
        description: 'Purchase: Test Item'
      }, expect.any(Object))

      // Verify audit log was created
      expect(mockSupabaseFrom).toHaveBeenCalledWith('payment_audit_logs')
    })
    it('should reject when seller not set up for payments', async () => {
      scenario.sellerHasPayouts = false
      const response = await PostHandler(mockRequest)
      const data = await response.json()
      expect(response.status).toBe(400)
      expect(data.error).toBe('Seller not set up for payments')
    })
    it('should reject when listing is inactive or unavailable', async () => {
      scenario.listingStatus = 'inactive'
      const response = await PostHandler(mockRequest)
      const data = await response.json()
      expect(response.status).toBe(404)
      expect(data.error).toBe('Listing not found or unavailable')
    })
    it('should continue when audit log insert fails', async () => {
      scenario.auditLogError = true
      const response = await PostHandler(mockRequest)
      const data = await response.json()
      expect(response.status).toBe(200)
      expect(data.clientSecret).toBe('pi_test_secret')
    })
  })

  describe('Error Handling', () => {
    it('should handle Stripe errors gracefully', async () => {
      mockStripePaymentIntentsCreate.mockRejectedValue(new Error('Stripe API error'))

      await expect(PostHandler(mockRequest)).rejects.toThrow('Stripe API error')
    })

    it('should rollback Stripe intent if database insert fails', async () => {
      scenario.paymentsInsertError = true

      await expect(PostHandler(mockRequest)).rejects.toThrow('Failed to create payment record')
      expect(mockStripePaymentIntentsCancel).toHaveBeenCalledWith('pi_test123')
    })
  })

  describe('Security Audit', () => {
    it('should never trust client-provided buyerProfileId', async () => {
      const requestWithClientBuyerId = new NextRequest('http://localhost:3000/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token'
        },
        body: JSON.stringify({
          listingId: '123e4567-e89b-12d3-a456-426614174000',
          buyerProfileId: 'malicious-client-id' // This should be ignored
        })
      })

      const response = await PostHandler(requestWithClientBuyerId)
      const data = await response.json()
      
      expect(response.status).toBe(200)
      
      const stripeCall = mockStripePaymentIntentsCreate.mock.calls[0][0]
      expect(stripeCall.metadata.buyer_profile_id).toBe('buyer-profile-id')
      expect(stripeCall.metadata.buyer_profile_id).not.toBe('malicious-client-id')
    })
  })
})
