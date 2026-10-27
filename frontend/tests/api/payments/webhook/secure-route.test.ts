import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ constructEvent: vi.fn(), retrieveCharge: vi.fn(), rpc: vi.fn(), listRefunds: vi.fn(), listDisputes: vi.fn() }))
vi.mock('@/lib/stripe/server', () => ({ stripe: { webhooks: { constructEvent: mocks.constructEvent }, charges: { retrieve: mocks.retrieveCharge }, refunds: { list: mocks.listRefunds }, disputes: { list: mocks.listDisputes } } }))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: { rpc: mocks.rpc } }))
vi.mock('@/lib/utils/logger', () => ({ log: vi.fn() }))
import { POST } from '@/app/api/payments/webhook/route'

function request(signature: string | null = 'signed') {
  return new NextRequest('http://localhost/api/payments/webhook', {
    method: 'POST', headers: signature ? { 'stripe-signature': signature } : {}, body: 'raw-stripe-payload',
  })
}
const paymentEvent = { id: 'evt_123', type: 'payment_intent.succeeded', data: { object: { id: 'pi_123', amount: 1000, application_fee_amount: 100, metadata: {} } } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'test-webhook-secret')
  mocks.constructEvent.mockReturnValue(paymentEvent)
  mocks.rpc.mockResolvedValue({ data: { action: 'payment_completed', duplicate: false }, error: null })
  mocks.retrieveCharge.mockResolvedValue({ id: 'ch_123', payment_intent: 'pi_123' })
  mocks.listRefunds.mockResolvedValue({ data: [{ id: 're_123', amount: 500, currency: 'eur', status: 'succeeded' }], has_more: false })
  mocks.listDisputes.mockResolvedValue({ data: [{ id: 'dp_123', payment_intent: 'pi_123', amount: 1000, currency: 'eur', status: 'won', reason: 'fraudulent' }], has_more: false })
})
afterEach(() => { vi.unstubAllEnvs() })

describe('Secure Stripe webhook endpoint', () => {
  it('rejects missing signature before touching the database', async () => {
    const response = await POST(request(null))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('Missing webhook signature or secret')
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(response.headers.get('X-Request-Id')).toBeTruthy()
  })
  it('rejects missing webhook secret', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '')
    expect((await POST(request())).status).toBe(400)
    expect(mocks.constructEvent).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('rejects invalid signatures', async () => {
    mocks.constructEvent.mockImplementationOnce(() => { throw new Error('Invalid signature') })
    const response = await POST(request())
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('Webhook signature verification failed')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('verifies the untouched body and signature', async () => {
    expect((await POST(request())).status).toBe(200)
    expect(mocks.constructEvent).toHaveBeenCalledWith('raw-stripe-payload', 'signed', 'test-webhook-secret')
  })
  it('acknowledges only a database-confirmed duplicate', async () => {
    mocks.rpc.mockResolvedValue({ data: { duplicate: true, action: 'already_processed' }, error: null })
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ received: true, duplicate: true })
  })
  it('leaves missing payments retryable instead of permanently ignoring an early delivery', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Payment not found for Stripe intent' } })
    const response = await POST(request())
    expect(response.status).toBe(500)
    expect((await response.json()).code).toBe('SYSTEM_ERROR')
  })
  it('acknowledges a previously completed payment without another state transition', async () => {
    mocks.rpc.mockResolvedValue({ data: { duplicate: false, action: 'ignored', reason: 'payment_already_settled' }, error: null })
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ received: true, processed: true })
  })
  it.each([
    ['payment_intent.payment_failed', { id: 'pi_123', amount: 2000, metadata: {} }, 'pi_123'],
    ['charge.refunded', { id: 'ch_123', payment_intent: 'pi_123', amount_refunded: 500 }, 'pi_123'],
    ['transfer.created', { id: 'tr_123', amount: 1000, source_transaction: 'ch_123' }, 'pi_123'],
    ['transfer.failed', { id: 'tr_123', amount: 1000, source_transaction: 'ch_123' }, 'pi_123'],
    ['charge.dispute.created', { id: 'dp_123', charge: 'ch_123', status: 'needs_response' }, 'pi_123'],
    ['charge.dispute.closed', { id: 'dp_123', charge: 'ch_123', status: 'won' }, 'pi_123'],
    ['charge.dispute.updated', { id: 'dp_123', charge: 'ch_123', status: 'lost' }, 'pi_123'],
    ['charge.dispute.funds_reinstated', { id: 'dp_123', charge: 'ch_123', status: 'won' }, 'pi_123'],
    ['payout.created', { id: 'po_123', amount: 5000 }, null],
    ['charge.captured', { id: 'ch_123', payment_intent: 'pi_123' }, null],
  ])('dispatches %s with the resolved payment reference', async (type, object, intent) => {
    const event = { id: 'evt_event', type, data: { object } }
    mocks.constructEvent.mockReturnValue(event)
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ received: true, processed: true })
    expect(mocks.rpc).toHaveBeenCalledWith(type.startsWith('charge.dispute.') ? 'process_stripe_dispute_event' : type === 'charge.refunded' ? 'process_stripe_refund_event' : 'process_stripe_webhook_event', expect.objectContaining({ p_event: event, p_payment_intent: intent }))
    expect(response.headers.get('X-Request-Id')).toBeTruthy()
  })
  it('keeps Stripe reference lookup errors retryable', async () => {
    mocks.constructEvent.mockReturnValue({ id: 'evt_dispute', type: 'charge.dispute.created', data: { object: { id: 'dp_1', charge: 'ch_123', status: 'needs_response' } } })
    mocks.retrieveCharge.mockRejectedValueOnce(new Error('Stripe temporary failure'))
    expect((await POST(request())).status).toBe(500)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('handles an unreadable request body as a server failure', async () => {
    const req = request()
    vi.spyOn(req, 'text').mockRejectedValueOnce(new Error('Network error'))
    const response = await POST(req)
    expect(response.status).toBe(500)
    expect((await response.json()).code).toBe('SYSTEM_ERROR')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
