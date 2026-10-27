import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { syncConnectedAccount } from '@/lib/stripe/connect'
import { currentPaymentRefunds } from '@/lib/stripe/refunds'
import { stripe } from '@/lib/stripe/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { withApiErrorHandler, ErrorFactory } from '@/lib/utils/error-handler'
import { log } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'

const webhookEventSchema = z.object({
  id: z.string().min(1), type: z.string(), data: z.object({ object: z.record(z.string(), z.unknown()) }),
}).passthrough()
const reference = z.union([z.string(), z.object({ id: z.string() })]).nullable().optional()
const paymentIntentSchema = z.object({
  id: z.string(), amount: z.number().int().nonnegative(),
  application_fee_amount: z.number().int().nonnegative().nullable().optional(),
  metadata: z.record(z.string(), z.string()).default({}),
})
const chargeSchema = z.object({ id: z.string(), payment_intent: reference, amount_refunded: z.number().int().nonnegative().optional() })
const transferSchema = z.object({ id: z.string(), amount: z.number().int().nonnegative(), source_transaction: reference })
const disputeSchema = z.object({ id: z.string(), charge: reference, status: z.string() })
const disputeEvents = ['charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed', 'charge.dispute.funds_reinstated']

function referenceId(value: z.infer<typeof reference>): string | null {
  return typeof value === 'string' ? value : value?.id ?? null
}

// Stripe transfer source_transaction points to a charge, not a PaymentIntent.
// Read external references before entering the database transaction.
async function paymentIntentFor(event: z.infer<typeof webhookEventSchema>) {
  switch (event.type) {
    case 'payment_intent.succeeded':
    case 'payment_intent.payment_failed':
    case 'payment_intent.canceled':
    case 'payment_intent.amount_capturable_updated':
      return paymentIntentSchema.parse(event.data.object).id
    case 'charge.refunded':
      return referenceId(chargeSchema.parse(event.data.object).payment_intent)
    case 'refund.created':
    case 'refund.updated':
    case 'refund.failed': {
      const refund = z.object({ payment_intent: reference, charge: reference }).parse(event.data.object)
      const intentId = referenceId(refund.payment_intent)
      if (intentId) return intentId
      const chargeId = referenceId(refund.charge)
      return chargeId ? referenceId(chargeSchema.parse(await stripe.charges.retrieve(chargeId)).payment_intent) : null
    }
    case 'transfer.created':
    case 'transfer.failed': {
      const chargeId = referenceId(transferSchema.parse(event.data.object).source_transaction)
      if (!chargeId) return null
      return referenceId(chargeSchema.parse(await stripe.charges.retrieve(chargeId)).payment_intent)
    }
    case 'charge.dispute.created':
    case 'charge.dispute.updated':
    case 'charge.dispute.closed':
    case 'charge.dispute.funds_reinstated': {
      const chargeId = referenceId(disputeSchema.parse(event.data.object).charge)
      if (!chargeId) return null
      const charge = chargeSchema.parse(await stripe.charges.retrieve(chargeId, {}, { timeout: 12_000, maxNetworkRetries: 0 }))
      if (charge.id !== chargeId) throw new Error('Dispute charge identity mismatch')
      return referenceId(charge.payment_intent)
    }
    default: return null
  }
}

export const POST = withApiErrorHandler(async (request: NextRequest) => {
  const requestId = crypto.randomUUID()
  const signature = request.headers.get('stripe-signature')
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!signature || !secret) {
    log('error', 'stripe_webhook_missing_signature', { requestId, hasSignature: !!signature, hasSecret: !!secret })
    throw ErrorFactory.validation('Missing webhook signature or secret', undefined, { userMessage: 'Missing webhook signature or secret' })
  }
  const rawBody = await request.text()
  let event: z.infer<typeof webhookEventSchema>
  try {
    event = webhookEventSchema.parse(stripe.webhooks.constructEvent(rawBody, signature, secret))
  } catch (cause) {
    log('error', 'stripe_webhook_signature_error', { requestId, message: cause instanceof Error ? cause.message : String(cause) })
    throw ErrorFactory.validation('Webhook signature verification failed', undefined, { userMessage: 'Webhook signature verification failed' })
  }
  try {
    if (event.type === 'account.updated') {
      const account = z.object({ id: z.string().startsWith('acct_') }).parse(event.data.object)
      // Read the current account, not the possibly out-of-order event snapshot.
      // This update is idempotent; a failed marker write can safely retry it.
      await syncConnectedAccount(account.id)
    }
    const paymentIntent = await paymentIntentFor(event)
    // Event completion and financial effects share one transaction: errors roll
    // back both so a later Stripe retry can safely try the same event again.
    const isRefund = ['charge.refunded', 'refund.created', 'refund.updated', 'refund.failed'].includes(event.type)
    const refundRecords = isRefund && paymentIntent ? await currentPaymentRefunds(paymentIntent) : null
    const isDispute = disputeEvents.includes(event.type)
    let disputeSnapshot: { readStartedAt: string; records: { id: string; amount: number; currency: string; status: string; reason: string }[] } | null = null
    if (isDispute) {
      if (!paymentIntent) throw new Error('Bank dispute payment reference missing')
      // Event snapshots can arrive late, including a lost decision followed by
      // a rare late win. Fetch the complete current list before the atomic RPC.
      const readStartedAt = new Date().toISOString()
      const current = await stripe.disputes.list({ payment_intent: paymentIntent, limit: 100 }, { timeout: 12_000, maxNetworkRetries: 0 })
      if (current.has_more || !current.data.some(dispute => dispute.id === event.data.object.id)
        || current.data.some(dispute => referenceId(dispute.payment_intent) !== paymentIntent)) {
        throw new Error('Incomplete or mismatched canonical dispute snapshot')
      }
      disputeSnapshot = { readStartedAt, records: current.data.map(dispute => ({
        id: dispute.id, amount: dispute.amount, currency: dispute.currency, status: dispute.status, reason: dispute.reason,
      })) }
    }
    const { data: result, error } = await supabaseAdmin.rpc(
      disputeSnapshot ? 'process_stripe_dispute_event' : refundRecords ? 'process_stripe_refund_event' : 'process_stripe_webhook_event', {
        p_event: event, p_payment_intent: paymentIntent, p_request_id: requestId,
        ...(refundRecords ? { p_refunds: refundRecords.map(refund => ({ id: refund.id, amount: refund.amount, currency: refund.currency, status: refund.status, failure_reason: refund.failure_reason || null })) } : {}),
        ...(disputeSnapshot ? { p_disputes: disputeSnapshot.records, p_read_started_at: disputeSnapshot.readStartedAt } : {}),
      })
    if (error || !result || typeof result !== 'object' || typeof result.duplicate !== 'boolean') {
      throw new Error(error?.message || 'Invalid webhook processing result')
    }
    log('info', result.duplicate ? 'stripe_webhook_duplicate' : 'stripe_webhook_processed', { requestId, eventId: event.id, eventType: event.type, result })
    return NextResponse.json(
      { received: true, ...(result.duplicate ? { duplicate: true } : { processed: true }), requestId },
      { headers: { 'X-Request-Id': requestId } },
    )
  } catch (cause) {
    log('error', 'stripe_webhook_processing_error', { requestId, eventId: event.id, eventType: event.type, message: cause instanceof Error ? cause.message : String(cause) })
    throw ErrorFactory.system('Webhook processing failed')
  }
})
