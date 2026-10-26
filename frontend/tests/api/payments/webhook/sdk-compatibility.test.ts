// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import Stripe from 'stripe'
import { STRIPE_API_VERSION } from '@/lib/stripe/api-version.mjs'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: { rpc: mocks.rpc } }))
vi.mock('@/lib/utils/logger', () => ({ log: vi.fn() }))

// Real SDK HMAC verification with no Stripe/network access; only DB is mocked.
const signingSecret = 'whsec_offline_regression_fixture'
let post: typeof import('@/app/api/payments/webhook/route').POST
beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_offline_regression_fixture')
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', signingSecret)
  mocks.rpc.mockResolvedValue({ data: { duplicate: false, action: 'payment_completed' }, error: null })
  post = (await import('@/app/api/payments/webhook/route')).POST
})
afterEach(() => vi.unstubAllEnvs())

function delivery(apiVersion: string, options: { timestamp?: number; alterBody?: boolean } = {}) {
  const body = JSON.stringify({
    id: 'evt_offline', object: 'event', api_version: apiVersion, created: Math.floor(Date.now() / 1000),
    livemode: false, type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_offline', object: 'payment_intent', amount: 200, application_fee_amount: null, currency: 'eur', metadata: { listing_id: 'saved_listing' }, status: 'succeeded', future_compatible_field: { allowed: true } } },
  })
  const signature = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: signingSecret, ...(options.timestamp ? { timestamp: options.timestamp } : {}) })
  return new NextRequest('http://localhost/api/payments/webhook', {
    method: 'POST', headers: { 'stripe-signature': signature },
    body: options.alterBody ? body.replace('"amount":200', '"amount":999') : body,
  })
}

describe('Stripe SDK23 webhook compatibility', () => {
  it.each(['2024-06-20', STRIPE_API_VERSION])('verifies and processes a signed %s snapshot', async version => {
    const response = await post(delivery(version))
    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('process_stripe_webhook_event', expect.objectContaining({
      p_payment_intent: 'pi_offline', p_event: expect.objectContaining({ api_version: version }),
    }))
  })
  it('rejects a modified financial payload before any database write', async () => {
    expect((await post(delivery(STRIPE_API_VERSION, { alterBody: true }))).status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('keeps the default signature timestamp tolerance enabled', async () => {
    expect((await post(delivery(STRIPE_API_VERSION, { timestamp: Math.floor(Date.now() / 1000) - 3600 }))).status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
