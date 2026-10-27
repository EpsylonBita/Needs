import type Stripe from 'stripe'

export type ProviderPayment = {
  id: string
  listing_id: string
  buyer_id: string
  seller_id: string
  amount: number | string
  platform_fee: number | string
  currency: string
  stripe_payment_intent: string | null
  agreement_id?: string | null
  milestone_id?: string | null
  cancel_claim_id?: string | null
  stripe_canceled_at?: string | null
  status: string
}

/** Provider reads are useful only after binding them to the canonical order. */
export function verifyProviderPayment(payment: ProviderPayment, intent: Stripe.PaymentIntent) {
  const amount = Math.round(Number(payment.amount) * 100)
  const fee = Math.round(Number(payment.platform_fee) * 100)
  if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(fee) || fee < 0 || fee > amount
    || intent.id !== payment.stripe_payment_intent || intent.amount !== amount
    || intent.currency !== payment.currency.toLowerCase() || intent.capture_method !== 'manual'
    || (intent.application_fee_amount ?? 0) !== fee
    || intent.metadata?.listing_id !== payment.listing_id
    || intent.metadata?.buyer_profile_id !== payment.buyer_id
    || intent.metadata?.seller_profile_id !== payment.seller_id
    || (payment.agreement_id && intent.metadata?.service_agreement_id !== payment.agreement_id)) {
    throw new Error('provider_payment_mismatch')
  }
  const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null
  if (charge) {
    const chargeIntent = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
    if (chargeIntent !== intent.id || charge.amount !== amount || charge.currency !== intent.currency) {
      throw new Error('provider_charge_mismatch')
    }
  }
  return { amount, fee, charge }
}

export function providerSnapshot(payment: ProviderPayment, intent: Stripe.PaymentIntent, readStartedAt: string, leaseId: string | null = null) {
  const { amount, fee, charge } = verifyProviderPayment(payment, intent)
  if (!Number.isFinite(Date.parse(readStartedAt))) throw new Error('invalid_provider_observation')
  const deadline = charge?.payment_method_details?.card?.capture_before
  // A missing deadline is unknown, not a guessed seven-day authorization.
  const captureBefore = typeof deadline === 'number' && Number.isSafeInteger(deadline) && deadline > 0
    ? new Date(deadline * 1000).toISOString() : null
  return {
    p_payment_id: payment.id,
    p_intent_id: intent.id,
    p_provider_status: intent.status,
    p_amount_cents: amount,
    p_platform_fee_cents: fee,
    p_currency: intent.currency,
    p_amount_capturable: intent.amount_capturable,
    p_amount_received: intent.amount_received,
    p_capture_before: captureBefore,
    p_read_started_at: readStartedAt,
    p_lease_id: leaseId,
  }
}
