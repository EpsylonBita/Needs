import type Stripe from 'stripe'
import { describe, expect, it } from 'vitest'
import { providerSnapshot, verifyProviderPayment, type ProviderPayment } from '@/lib/payments/provider-state'

const payment: ProviderPayment = {
  id: 'payment', listing_id: 'listing', buyer_id: 'buyer', seller_id: 'seller',
  amount: '75.00', platform_fee: '3.75', currency: 'eur', stripe_payment_intent: 'pi_test',
  agreement_id: 'agreement', status: 'requires_capture',
}
const intent = () => ({
  id: 'pi_test', amount: 7500, currency: 'eur', application_fee_amount: 375,
  capture_method: 'manual', status: 'requires_capture', amount_capturable: 7500, amount_received: 0,
  metadata: { listing_id: 'listing', buyer_profile_id: 'buyer', seller_profile_id: 'seller', service_agreement_id: 'agreement' },
  latest_charge: { id: 'ch_test', payment_intent: 'pi_test', amount: 7500, currency: 'eur', payment_method_details: { card: { capture_before: 1804118400 } } },
} as unknown as Stripe.PaymentIntent)

describe('canonical provider observation', () => {
  it('retains the exact provider deadline and canonical cents', () => {
    expect(providerSnapshot(payment, intent(), '2026-10-27T01:00:00.000Z')).toMatchObject({
      p_amount_cents: 7500, p_platform_fee_cents: 375, p_capture_before: new Date(1804118400000).toISOString(),
      p_amount_received: 0, p_provider_status: 'requires_capture',
    })
  })
  it('does not invent deadlines for an unexpanded or absent charge', () => {
    for (const latest_charge of [null, 'ch_test']) {
      expect(providerSnapshot(payment, { ...intent(), latest_charge }, '2026-10-27T01:00:00Z').p_capture_before).toBeNull()
    }
  })
  it.each([
    ['id', 'pi_other'], ['amount', 1000], ['currency', 'usd'], ['capture_method', 'automatic'], ['application_fee_amount', 0],
  ])('rejects mismatched %s', (key, value) => {
    expect(() => verifyProviderPayment(payment, { ...intent(), [key]: value })).toThrow('provider_payment_mismatch')
  })
  it.each(['listing_id', 'buyer_profile_id', 'seller_profile_id', 'service_agreement_id'])('rejects mismatched %s metadata', key => {
    const value = intent(); value.metadata[key] = 'other'
    expect(() => verifyProviderPayment(payment, value)).toThrow('provider_payment_mismatch')
  })
  it('rejects a charge belonging to a different payment', () => {
    const value = intent(); (value.latest_charge as Stripe.Charge).payment_intent = 'pi_other'
    expect(() => verifyProviderPayment(payment, value)).toThrow('provider_charge_mismatch')
  })
  it('validates observation time and money rather than coercing invalid values', () => {
    expect(() => providerSnapshot(payment, intent(), 'invalid')).toThrow('invalid_provider_observation')
    expect(() => verifyProviderPayment({ ...payment, amount: 'not money' }, intent())).toThrow('provider_payment_mismatch')
  })
})
