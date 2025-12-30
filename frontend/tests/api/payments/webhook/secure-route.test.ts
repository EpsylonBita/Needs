import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock the dependencies first
vi.mock('@/lib/stripe/server', () => ({
  stripe: {
    webhooks: {
      constructEvent: vi.fn()
    },
    charges: {
      retrieve: vi.fn()
    }
  }
}))

const webhookScenario: any = {
  duplicate: false,
  payment: null
}

vi.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: vi.fn((tableName: string) => {
      const chain: any = {
        select: vi.fn().mockImplementation(() => chain),
        eq: vi.fn().mockImplementation(() => chain),
        single: vi.fn(),
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        update: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ data: null, error: null }))
        })),
        limit: vi.fn().mockReturnThis()
      }
      
      if (tableName === 'webhook_events') {
        chain.select = vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: webhookScenario.duplicate ? { id: 'evt_123', processed_at: '2024-01-01' } : null,
              error: null
            })
          }))
        }))
        return chain
      }
      
      if (tableName === 'payments') {
        chain.select = vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: webhookScenario.payment,
              error: webhookScenario.payment ? null : null
            })
          }))
        }))
        chain.update = vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ data: null, error: null }))
        }))
        return chain
      }
      
      return chain
    })
  ,
    rpc: vi.fn(async (fnName: string, args: any) => {
      if (fnName === 'payment_complete_atomic') return { data: { status: 'payment_completed' }, error: null }
      if (fnName === 'payment_fail_atomic') return { data: { status: 'payment_failed' }, error: null }
      if (fnName === 'payment_refund_atomic') return { data: { status: 'payment_refunded' }, error: null }
      return { data: null, error: null }
    })
  }
}))

vi.mock('../../../../lib/utils/logger', () => ({
  log: vi.fn()
}))

// Now import the module under test
import { POST } from '../../../../app/api/payments/webhook/route'
import { stripe } from '@/lib/stripe/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { log } from '../../../../lib/utils/logger'

describe('Secure Stripe Webhook Handler', () => {
  let mockRequest: NextRequest
  let mockStripe: any
  let mockSupabaseAdmin: any
  let mockLog: any
  
  beforeEach(() => {
    vi.clearAllMocks()
    
    // Setup mock request
    mockRequest = {
      headers: new Headers(),
      text: vi.fn().mockResolvedValue('mock-raw-body')
    } as any
    
    mockStripe = stripe
    mockSupabaseAdmin = supabaseAdmin
    mockLog = log
    
    // Set webhook secret
    process.env.STRIPE_WEBHOOK_SECRET = 'test-webhook-secret'

    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('test-request-id')
  })
  
  afterEach(() => {
    delete process.env.STRIPE_WEBHOOK_SECRET
  })
  
  describe('Webhook Signature Validation', () => {
    it('should reject request without signature', async () => {
      const response = await POST(mockRequest)
      const data = await response.json()
      
      expect(response.status).toBe(400)
      expect(data.error).toBe('Missing webhook signature or secret')
      expect(response.headers.get('X-Request-Id')).toBeTruthy()
      expect(mockLog).toHaveBeenCalledWith('error', 'stripe_webhook_missing_signature', expect.any(Object))
    })
    
    it('should reject request without webhook secret', async () => {
      delete process.env.STRIPE_WEBHOOK_SECRET
      mockRequest.headers.set('stripe-signature', 'test-signature')
      
      const response = await POST(mockRequest)
      const data = await response.json()
      
      expect(response.status).toBe(400)
      expect(data.error).toBe('Missing webhook signature or secret')
      expect(response.headers.get('X-Request-Id')).toBeTruthy()
      expect(mockLog).toHaveBeenCalledWith('error', 'stripe_webhook_missing_signature', expect.any(Object))
    })
    
    it('should reject invalid signature', async () => {
      mockRequest.headers.set('stripe-signature', 'invalid-signature')
      mockStripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('Invalid signature')
      })
      
      const response = await POST(mockRequest)
      const data = await response.json()
      
      expect(response.status).toBe(400)
      expect(data.error).toBe('Webhook signature verification failed')
      expect(response.headers.get('X-Request-Id')).toBeTruthy()
      expect(mockLog).toHaveBeenCalledWith('error', 'stripe_webhook_signature_error', expect.any(Object))
    })
    
    it('should handle duplicate webhook events', async () => {
      mockRequest.headers.set('stripe-signature', 'test-signature')
      const mockEvent = {
        id: 'evt_123',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_123', amount: 1000, currency: 'usd' } }
      }
      
      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent)
      
      webhookScenario.duplicate = true
      
      const response = await POST(mockRequest)
      const data = await response.json()
      
      expect(response.status).toBe(200)
      expect(data.duplicate).toBe(true)
      expect(response.headers.get('X-Request-Id')).toBeTruthy()
      expect(mockLog).toHaveBeenCalledWith('info', 'stripe_webhook_duplicate', expect.any(Object))
    })
  })
  
  describe('Payment Intent Success Processing', () => {
    beforeEach(() => {
      mockRequest.headers.set('stripe-signature', 'test-signature')
      const mockEvent = {
        id: 'evt_123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_123',
            amount: 1000,
            application_fee_amount: 100,
            metadata: {
              listing_id: 'list_123',
              milestone_id: 'mile_123',
              seller_profile_id: 'prof_123',
              buyer_profile_id: 'prof_456'
            }
          }
        }
      }
      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent)
      
      webhookScenario.duplicate = false
    })
    
    it('should handle payment not found', async () => {
      webhookScenario.payment = null
      
      const response = await POST(mockRequest)
      const data = await response.json()
      
      expect(response.status).toBe(200)
      expect(data.received).toBe(true)
      expect(data.processed).toBe(true)
      expect(response.headers.get('X-Request-Id')).toBeTruthy()
    })
    
    it('should handle already completed payments', async () => {
      webhookScenario.payment = {
        id: 'pay_123',
        buyer_id: 'prof_456',
        seller_id: 'prof_123',
        status: 'completed'
      }
      
      const response = await POST(mockRequest)
      const data = await response.json()
      
      expect(response.status).toBe(200)
      expect(data.received).toBe(true)
      expect(data.processed).toBe(true)
    })
  })

  describe('Additional Events', () => {
    beforeEach(() => {
      mockRequest.headers.set('stripe-signature', 'test-signature')
    })
    it('handles payment_intent.payment_failed', async () => {
      const mockEvent = {
        id: 'evt_pf',
        type: 'payment_intent.payment_failed',
        data: { object: { id: 'pi_pf', amount: 2000, metadata: {} } }
      }
      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent)
      webhookScenario.duplicate = false
      webhookScenario.payment = { id: 'pay_pf', status: 'requires_capture' }
      const response = await POST(mockRequest)
      const data = await response.json()
      expect(response.status).toBe(200)
      expect(data.received).toBe(true)
      expect(data.processed).toBe(true)
    })
    it('handles charge.refunded', async () => {
      const mockEvent = {
        id: 'evt_ref',
        type: 'charge.refunded',
        data: { object: { id: 'ch_ref', payment_intent: 'pi_ref', amount_refunded: 500 } }
      }
      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent)
      mockStripe.charges.retrieve.mockResolvedValue({ id: 'ch_ref', payment_intent: 'pi_ref', amount_refunded: 500 })
      webhookScenario.payment = { id: 'pay_ref', status: 'completed' }
      const response = await POST(mockRequest)
      const data = await response.json()
      expect(response.status).toBe(200)
      expect(data.received).toBe(true)
      expect(data.processed).toBe(true)
    })
    it('handles transfer.created', async () => {
      const mockEvent = {
        id: 'evt_tc',
        type: 'transfer.created',
        data: { object: { id: 'tr_1', amount: 1500, source_transaction: 'pi_tc' } }
      }
      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent)
      webhookScenario.payment = { id: 'pay_tc', seller_id: 'seller_1' }
      const response = await POST(mockRequest)
      const data = await response.json()
      expect(response.status).toBe(200)
      expect(data.received).toBe(true)
      expect(data.processed).toBe(true)
    })
    it('handles transfer.failed', async () => {
      const mockEvent = {
        id: 'evt_tf',
        type: 'transfer.failed',
        data: { object: { id: 'tr_f', amount: 1500, source_transaction: 'pi_tf' } }
      }
      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent)
      webhookScenario.payment = { id: 'pay_tf' }
      const response = await POST(mockRequest)
      const data = await response.json()
      expect(response.status).toBe(200)
      expect(data.received).toBe(true)
      expect(data.processed).toBe(true)
    })
    it('handles charge.dispute.created', async () => {
      const mockEvent = {
        id: 'evt_dc',
        type: 'charge.dispute.created',
        data: { object: { id: 'dp_1', charge: 'ch_dp', status: 'open' } }
      }
      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent)
      mockStripe.charges.retrieve.mockResolvedValue({ id: 'ch_dp', payment_intent: 'pi_dp' })
      webhookScenario.payment = { id: 'pay_dp', seller_id: 'seller_x', buyer_id: 'buyer_y', amount: 123 }
      const response = await POST(mockRequest)
      const data = await response.json()
      expect(response.status).toBe(200)
      expect(data.received).toBe(true)
      expect(data.processed).toBe(true)
    })
    it('handles charge.dispute.closed', async () => {
      const mockEvent = {
        id: 'evt_dl',
        type: 'charge.dispute.closed',
        data: { object: { id: 'dp_2', charge: 'ch_dl', status: 'won' } }
      }
      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent)
      mockStripe.charges.retrieve.mockResolvedValue({ id: 'ch_dl', payment_intent: 'pi_dl' })
      webhookScenario.payment = { id: 'pay_dl', seller_id: 'seller_x', buyer_id: 'buyer_y' }
      const response = await POST(mockRequest)
      const data = await response.json()
      expect(response.status).toBe(200)
      expect(data.received).toBe(true)
      expect(data.processed).toBe(true)
    })

    it('handles payout.created (unhandled -> ignored)', async () => {
      const mockEvent = {
        id: 'evt_payout_created',
        type: 'payout.created',
        data: { object: { id: 'po_123', amount: 5000 } }
      }
      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent)
      webhookScenario.payment = null
      const response = await POST(mockRequest)
      const data = await response.json()
      expect(response.status).toBe(200)
      expect(data.received).toBe(true)
      expect(data.processed).toBe(true)
      expect(mockLog).toHaveBeenCalledWith('info', 'stripe_webhook_unhandled_event', expect.any(Object))
    })

    it('handles charge.captured (unhandled -> ignored)', async () => {
      const mockEvent = {
        id: 'evt_charge_captured',
        type: 'charge.captured',
        data: { object: { id: 'ch_123', payment_intent: 'pi_789' } }
      }
      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent)
      webhookScenario.payment = { id: 'pay_789', status: 'requires_capture' }
      const response = await POST(mockRequest)
      const data = await response.json()
      expect(response.status).toBe(200)
      expect(data.received).toBe(true)
      expect(data.processed).toBe(true)
      expect(mockLog).toHaveBeenCalledWith('info', 'stripe_webhook_unhandled_event', expect.any(Object))
    })
  })
  
  describe('Error Handling', () => {
    it('should handle unexpected errors', async () => {
      mockRequest.headers.set('stripe-signature', 'test-signature')
      mockRequest.text = vi.fn().mockRejectedValue(new Error('Network error'))
      
      const response = await POST(mockRequest)
      const data = await response.json()
      
      expect(response.status).toBe(500)
      expect(data.error).toBe('Internal server error')
      expect(mockLog).toHaveBeenCalledWith('error', 'stripe_webhook_unexpected_error', expect.any(Object))
    })
  })
})
