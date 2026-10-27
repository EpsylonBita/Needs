import { supabaseAdmin } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/server'
import { currentPaymentRefunds } from '@/lib/stripe/refunds'
import { ErrorFactory } from '@/lib/utils/error-handler'
import { providerSnapshot, type ProviderPayment } from './provider-state'

export const providerPaymentColumns = 'id,listing_id,buyer_id,seller_id,amount,platform_fee,currency,stripe_payment_intent,agreement_id,milestone_id,cancel_claim_id,stripe_canceled_at,status'
const providerRequest = { timeout: 12_000, maxNetworkRetries: 0 }

export class LifecycleConflict extends Error {
  constructor(message: string, readonly status: 403 | 409 = 409) { super(message) }
}

export async function lifecycleRpc(name: string, parameters: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.rpc(name, parameters)
  if (error?.code === '42501') throw new LifecycleConflict('This order does not belong to your account.', 403)
  if (error && ['P0001', '23514', '22023', '40001', '23505'].includes(error.code)) {
    throw new LifecycleConflict('The payment state changed. Refresh its status and try again.')
  }
  if (error || data === null) throw ErrorFactory.database('Payment state could not be verified')
  return data
}

export async function getProviderPayment(paymentId: string): Promise<ProviderPayment> {
  const { data, error } = await supabaseAdmin.from('payments').select(providerPaymentColumns).eq('id', paymentId).single()
  if (error || !data?.stripe_payment_intent) throw new LifecycleConflict('Payment not found.', 403)
  return data as ProviderPayment
}

export async function orderForUser(paymentId: string, userId: string) {
  const value = await lifecycleRpc('get_order_for_user', { p_payment_id: paymentId, p_user_id: userId })
  if (!value || value.id !== paymentId || !['buyer', 'seller'].includes(value.my_role)) {
    throw ErrorFactory.database('Order details could not be verified')
  }
  return value
}

/** Retrieve current provider truth; a browser cannot submit financial state. */
export async function reconcilePayment(payment: ProviderPayment, leaseId: string | null = null) {
  const readStarted = new Date().toISOString()
  const intent = await stripe.paymentIntents.retrieve(payment.stripe_payment_intent!, { expand: ['latest_charge'] }, providerRequest)
  const observation = await lifecycleRpc('reconcile_order_provider', providerSnapshot(payment, intent, readStarted, leaseId))
  if (observation?.applied !== true) throw new LifecycleConflict('A newer payment check is in progress. Refresh its status again.')
  // Pending/failed refunds can have amount_refunded=0, so every captured payment
  // needs a canonical refund read when reconciling missed provider notifications.
  if (intent.status === 'succeeded') {
    // Bank disputes can arrive after capture, including when their webhook was lost.
    // Read them before refunds so an open bank case retains precedence in the UI.
    const disputeReadStarted = new Date().toISOString()
    const disputes = await stripe.disputes.list({ payment_intent: intent.id, limit: 100 }, providerRequest)
    if (disputes.has_more) throw new Error('Payment dispute history requires manual review')
    if (disputes.data.some(dispute => (typeof dispute.payment_intent === 'string'
      ? dispute.payment_intent : dispute.payment_intent?.id) !== intent.id)) {
      throw new Error('Provider dispute identity mismatch')
    }
    const disputeObservation = await lifecycleRpc('reconcile_order_disputes', {
      p_payment_id: payment.id, p_intent_id: intent.id, p_read_started_at: disputeReadStarted,
      p_disputes: disputes.data.map(dispute => ({ id: dispute.id, amount: dispute.amount, currency: dispute.currency, status: dispute.status, reason: dispute.reason })),
    })
    if (disputeObservation?.applied !== true) throw new LifecycleConflict('A newer dispute check is in progress. Refresh its status again.')
    const refundReadStarted = new Date().toISOString()
    const refunds = await currentPaymentRefunds(intent.id, providerRequest, 100)
    const refundObservation = await lifecycleRpc('reconcile_order_refunds', {
      p_payment_id: payment.id, p_intent_id: intent.id, p_read_started_at: refundReadStarted,
      p_refunds: refunds.map(refund => ({ id: refund.id, amount: refund.amount, currency: refund.currency, status: refund.status, failure_reason: refund.failure_reason || null })),
    })
    if (refundObservation?.applied !== true) throw new LifecycleConflict('A newer refund check is in progress. Refresh its status again.')
  }
  return intent
}

export type CancellationClaim = { payment_id: string; intent_id: string; claim_id: string | null; status: 'claimed' | 'canceled' }

/** A durable consent/admin claim MUST already exist before asking Stripe to release funds. */
export async function releaseClaimedPayment(payment: ProviderPayment, claim: CancellationClaim, leaseId: string | null = null) {
  if (claim.payment_id !== payment.id || claim.intent_id !== payment.stripe_payment_intent
    || !['claimed', 'canceled'].includes(claim.status) || (claim.status === 'claimed' && !claim.claim_id)) {
    throw ErrorFactory.database('Cancellation authorization could not be verified')
  }
  let intent = await reconcilePayment(payment, leaseId)
  if (intent.status === 'canceled') return { released: true, pending: false }
  if (intent.status === 'succeeded') throw new LifecycleConflict('This payment was captured. Use the refund procedure.')
  if (claim.status !== 'claimed') throw new LifecycleConflict('The cancellation state needs review.')
  if (!['requires_payment_method', 'requires_confirmation', 'requires_action', 'requires_capture'].includes(intent.status)) {
    return { released: false, pending: true }
  }
  try {
    // Never retry with another key after a timeout. The worker resumes this same claim.
    await stripe.paymentIntents.cancel(intent.id, { cancellation_reason: 'requested_by_customer' }, {
      ...providerRequest, idempotencyKey: `order-cancel:${payment.id}:${claim.claim_id}`,
    })
  } catch {
    // The provider can have accepted cancellation before the connection failed.
    // A current read, not the thrown error, decides whether money was released.
  }
  try { intent = await reconcilePayment(payment, leaseId) }
  catch { return { released: false, pending: true } }
  if (intent.status === 'succeeded') throw new LifecycleConflict('This payment was captured. Use the refund procedure.')
  return { released: intent.status === 'canceled', pending: intent.status !== 'canceled' }
}
