// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import Stripe from 'stripe'
import { STRIPE_API_VERSION, stripeListenerArguments, stripeListenerReady } from '@/lib/stripe/api-version.mjs'

describe('Stripe SDK23 request compatibility', () => {
  it('serializes destination authorization, capture and refund with the pinned API and idempotency headers', async () => {
    const requests: { url: string; init: RequestInit }[] = []
    const transport = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(url), init: init || {} })
      return new Response(JSON.stringify({ id: 'pi_offline', object: 'payment_intent', status: 'requires_capture', livemode: false }), { status: 200, headers: { 'Content-Type': 'application/json', 'Request-Id': 'req_offline' } })
    })
    const stripe = new Stripe('sk_test_offline_transport_fixture', {
      apiVersion: STRIPE_API_VERSION, httpClient: Stripe.createFetchHttpClient(transport), maxNetworkRetries: 0,
    })
    await stripe.paymentIntents.create({ amount: 200, currency: 'eur', capture_method: 'manual', application_fee_amount: 10, transfer_data: { destination: 'acct_offline' }, receipt_email: 'verified@example.com' }, { idempotencyKey: 'intent-offline' })
    await stripe.paymentIntents.capture('pi_offline', undefined, { idempotencyKey: 'capture-offline' })
    await stripe.refunds.create({ payment_intent: 'pi_offline', reverse_transfer: true, refund_application_fee: true }, { idempotencyKey: 'refund-offline' })
    expect(requests).toHaveLength(3)
    expect(requests.map(request => new Headers(request.init.headers).get('Stripe-Version'))).toEqual(Array(3).fill(STRIPE_API_VERSION))
    expect(requests.map(request => new Headers(request.init.headers).get('Idempotency-Key'))).toEqual(['intent-offline', 'capture-offline', 'refund-offline'])
    const authorization = new URLSearchParams(String(requests[0].init.body))
    expect(authorization.get('capture_method')).toBe('manual')
    expect(authorization.get('transfer_data[destination]')).toBe('acct_offline')
    expect(authorization.get('application_fee_amount')).toBe('10')
    expect(authorization.has('payment_method_types')).toBe(false)
    expect(requests[1].url).toMatch(/\/v1\/payment_intents\/pi_offline\/capture$/)
    const refund = new URLSearchParams(String(requests[2].init.body))
    expect(refund.get('reverse_transfer')).toBe('true')
    expect(refund.get('refund_application_fee')).toBe('true')
  })

  it('keeps the existing Connect V1 account operation on its supported endpoint', async () => {
    let endpoint = ''
    let parameters = new URLSearchParams()
    const transport = async (url: RequestInfo | URL, init?: RequestInit) => {
      endpoint = String(url)
      parameters = new URLSearchParams(String(init?.body))
      return new Response(JSON.stringify({ id: 'acct_offline', object: 'account', type: 'express' }), { headers: { 'Content-Type': 'application/json' } })
    }
    const stripe = new Stripe('sk_test_offline_transport_fixture', { apiVersion: STRIPE_API_VERSION, httpClient: Stripe.createFetchHttpClient(transport) })
    await stripe.accounts.create({ type: 'express', capabilities: { transfers: { requested: true } } }, { idempotencyKey: 'connect-offline' })
    expect(endpoint).toMatch(/\/v1\/accounts$/)
    expect(parameters.get('type')).toBe('express')
    expect(parameters.get('capabilities[transfers][requested]')).toBe('true')
    await stripe.accounts.retrieve(null)
    expect(endpoint).toMatch(/\/v1\/account$/)
  })
})

describe('Local Stripe webhook version alignment', () => {
  it('requests current snapshots and forwards both platform and Connect events', () => {
    const args = stripeListenerArguments('http://127.0.0.1:3002')
    expect(args).toContain('--latest')
    expect(args[args.indexOf('--forward-to') + 1]).toBe('http://127.0.0.1:3002/api/payments/webhook')
    expect(args[args.indexOf('--forward-connect-to') + 1]).toBe('http://127.0.0.1:3002/api/payments/webhook')
  })
  it('accepts only the reviewed API version before starting the application', () => {
    expect(stripeListenerReady(`Ready! You are using Stripe API Version [${STRIPE_API_VERSION}]. Your webhook signing secret is whsec_fixture`)).toEqual({ apiVersion: STRIPE_API_VERSION, signingSecret: 'whsec_fixture' })
    expect(stripeListenerReady('Connecting…')).toBeNull()
    expect(() => stripeListenerReady('Ready! You are using Stripe API Version [2024-06-20]. Your webhook signing secret is whsec_fixture')).toThrow('does not match')
    expect(() => stripeListenerReady('Ready! Your webhook signing secret is whsec_fixture')).toThrow('unknown')
  })
})
