import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ constructEvent: vi.fn(), rpc: vi.fn(), from: vi.fn(), retrieveCharge: vi.fn(), retrieveAccount: vi.fn(), listRefunds: vi.fn() }))
vi.mock('@/lib/stripe/server', () => ({ stripe: { webhooks: { constructEvent: mocks.constructEvent }, charges: { retrieve: mocks.retrieveCharge }, accounts: { retrieve: mocks.retrieveAccount }, refunds: { list: mocks.listRefunds } } }))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: { rpc: mocks.rpc, from: mocks.from } }))
vi.mock('@/lib/utils/logger', () => ({ log: vi.fn() }))
import { POST } from '@/app/api/payments/webhook/route'

const event = { id: 'evt_retry', type: 'payment_intent.succeeded', data: { object: { id: 'pi_retry', amount: 1000, application_fee_amount: null, metadata: {} } } }
function request() { return new NextRequest('http://localhost/api/payments/webhook', { method: 'POST', headers: { 'stripe-signature': 'signed' }, body: '{"raw":"payload"}' }) }

describe('Webhook delivery reliability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'test-secret')
    mocks.constructEvent.mockReturnValue(event)
    mocks.rpc.mockResolvedValue({ data: { action: 'payment_completed', duplicate: false }, error: null })
    mocks.from.mockImplementation(() => {
      const chain: any = { select: vi.fn(() => chain), eq: vi.fn(() => chain), single: vi.fn(async () => ({ data: { id: event.id, processed_at: '2026-10-01', processing_error: { message: 'temporary database failure' } }, error: null })), insert: vi.fn(async () => ({ error: null })), update: vi.fn(() => chain), then: (resolve: any) => Promise.resolve({ error: null }).then(resolve) }
      return chain
    })
  })

  it('retries previously failed deliveries instead of acknowledging their existence as success', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect((await response.json()).processed).toBe(true)
    expect(mocks.rpc).toHaveBeenCalledWith('process_stripe_webhook_event', expect.objectContaining({ p_event: event }))
  })

  it('accepts the nullable application fee from actual Stripe payment intents', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('returns a retryable server error when persistence fails', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'database unavailable' } })
    const response = await POST(request())
    expect(response.status).toBe(500)
    expect((await response.json()).category).toBe('system')
  })

  it('resolves transfer source charges to their payment intent before database processing', async () => {
    mocks.constructEvent.mockReturnValue({ id: 'evt_transfer', type: 'transfer.created', data: { object: { id: 'tr_123', source_transaction: 'ch_123', amount: 1000 } } })
    mocks.retrieveCharge.mockResolvedValue({ id: 'ch_123', payment_intent: 'pi_retry' })
    expect((await POST(request())).status).toBe(200)
    expect(mocks.retrieveCharge).toHaveBeenCalledWith('ch_123')
    expect(mocks.rpc).toHaveBeenCalledWith('process_stripe_webhook_event', expect.objectContaining({ p_payment_intent: 'pi_retry' }))
  })

  it('synchronizes account.updated using current Stripe capabilities instead of a stale event snapshot', async () => {
    mocks.constructEvent.mockReturnValue({ id: 'evt_account', type: 'account.updated', data: { object: { id: 'acct_seller', charges_enabled: false } } })
    mocks.retrieveAccount.mockResolvedValue({ id: 'acct_seller', capabilities: { transfers: 'active' }, charges_enabled: true, payouts_enabled: true, details_submitted: true, type: 'express' })
    expect((await POST(request())).status).toBe(200)
    expect(mocks.retrieveAccount).toHaveBeenCalledWith('acct_seller')
    expect(mocks.from).toHaveBeenCalledWith('profiles')
    expect(mocks.rpc).toHaveBeenCalledWith('process_stripe_webhook_event', expect.objectContaining({ p_payment_intent: null }))
  })

  it('persists and acknowledges a controller-based account.updated with no legacy account type', async () => {
    mocks.constructEvent.mockReturnValue({ id: 'evt_controller_account', type: 'account.updated', data: { object: { id: 'acct_seller', type: 'express' } } })
    mocks.retrieveAccount.mockResolvedValue({
      id: 'acct_seller', type: 'none', capabilities: { transfers: 'active' },
      charges_enabled: true, payouts_enabled: true, details_submitted: true,
      controller: { requirement_collection: 'application', stripe_dashboard: { type: 'none' },
        fees: { payer: 'application' }, losses: { payments: 'application' } },
    })
    let persisted: Record<string, unknown> | undefined
    mocks.from.mockImplementation(() => ({
      update: (value: Record<string, unknown>) => {
        persisted = value
        return { eq: async () => ({ error: value.stripe_account_type === null
          ? null : { message: 'profiles_stripe_account_type_check' } }) }
      },
    }))
    expect((await POST(request())).status).toBe(200)
    expect(persisted).toMatchObject({ stripe_account_type: null, stripe_onboarding_complete: true, stripe_payouts_enabled: true })
    expect(mocks.retrieveAccount).toHaveBeenCalledWith('acct_seller')
    expect(mocks.rpc).toHaveBeenCalledWith('process_stripe_webhook_event', expect.objectContaining({ p_payment_intent: null }))
  })

  it('does not acknowledge account updates that cannot be synchronized', async () => {
    mocks.constructEvent.mockReturnValue({ id: 'evt_account', type: 'account.updated', data: { object: { id: 'acct_seller' } } })
    mocks.retrieveAccount.mockRejectedValueOnce(new Error('Stripe unavailable'))
    expect((await POST(request())).status).toBe(500)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('reconciles refund.failed from canonical refund records rather than the event snapshot', async () => {
    mocks.constructEvent.mockReturnValue({ id: 'evt_refund', type: 'refund.failed', data: { object: { id: 're_1', payment_intent: 'pi_retry', charge: 'ch_1', status: 'succeeded' } } })
    mocks.listRefunds.mockResolvedValue({ data: [{ id: 're_1', amount: 1000, currency: 'eur', status: 'failed', failure_reason: 'declined' }], has_more: false })
    expect((await POST(request())).status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('process_stripe_refund_event', expect.objectContaining({ p_payment_intent: 'pi_retry', p_refunds: [{ id: 're_1', amount: 1000, currency: 'eur', status: 'failed', failure_reason: 'declined' }] }))
  })
})
