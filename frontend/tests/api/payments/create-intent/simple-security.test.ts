import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock the dependencies
vi.mock('@/lib/stripe/server', () => ({
  stripe: {
    paymentIntents: {
      create: vi.fn()
    }
  }
}))

vi.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    auth: {
      getUser: vi.fn()
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { enabled: true } })
    }))
  }
}))

vi.mock('../../../../lib/utils/logger', () => ({
  log: vi.fn()
}))

vi.mock('../../../../lib/utils/rate-limit-enhanced', () => ({
  rateLimitEnhanced: vi.fn().mockResolvedValue({ allowed: true }),
  RateLimitConfigs: {
    PAYMENTS: {
      key: (ip: string) => `payments:${ip}`
    }
  }
}))



describe('Payment Security - Core Authentication', () => {
  let mockRequest: NextRequest

  beforeEach(() => {
    vi.clearAllMocks()
    
    mockRequest = {
      headers: new Headers({
        'content-type': 'application/json'
      }),
      json: vi.fn().mockResolvedValue({
        listingId: 'test-listing-123'
      })
    } as any
  })

  it('should reject payment creation without authentication', async () => {
    // Import the route handler after mocks are set up
    const { POST } = await import('../../../../app/api/payments/create-intent/route')
    
    const response = await POST(mockRequest)
    const data = await response.json()
    
    expect(response.status).toBe(401)
    expect(data.error).toBe('Authentication required')
  })

  it('should reject payment creation with invalid authentication', async () => {
    const { supabaseAdmin } = await import('@/lib/supabase/server')
    
    // Mock invalid authentication - this should return Invalid authentication
    ;(supabaseAdmin.auth.getUser as any).mockResolvedValueOnce({ 
      data: { user: null }, 
      error: new Error('Invalid token') 
    })
    
    mockRequest.headers.set('authorization', 'Bearer invalid-token')
    
    const { POST } = await import('../../../../app/api/payments/create-intent/route')
    
    const response = await POST(mockRequest)
    const data = await response.json()
    
    expect(response.status).toBe(401)
    expect(data.error).toBe('Invalid authentication')
  })
})
vi.mock('@/lib/utils/error-handler', () => ({
  withApiErrorHandler: (handler: any) => handler
}))
