import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { log } from '@/lib/utils/logger'
import { z } from 'zod'
import { withApiErrorHandler, ErrorFactory } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic'

const webhookEventSchema = z.object({ id: z.string(), type: z.string(), data: z.object({ object: z.record(z.any()) }) })
const paymentIntentSchema = z.object({ id: z.string(), amount: z.number(), application_fee_amount: z.number().optional(), metadata: z.object({ listing_id: z.string().optional(), milestone_id: z.string().optional(), seller_profile_id: z.string().optional(), buyer_profile_id: z.string().optional() }).passthrough() })
const chargeSchema = z.object({ id: z.string(), payment_intent: z.string().optional(), amount_refunded: z.number().optional() })
const transferSchema = z.object({ id: z.string(), amount: z.number(), source_transaction: z.string().optional() })
const disputeSchema = z.object({ id: z.string(), charge: z.string(), reason: z.string().optional(), status: z.string() })

export const POST = withApiErrorHandler(async (request: NextRequest) => {
  const requestId = crypto.randomUUID()
  try {
    const sig = request.headers.get('stripe-signature')
    const secret = process.env.STRIPE_WEBHOOK_SECRET
    if (!sig || !secret) {
      log('error', 'stripe_webhook_missing_signature', { requestId, hasSignature: !!sig, hasSecret: !!secret })
      throw ErrorFactory.validation('Missing webhook signature or secret')
    }
    const rawBody = await request.text()
    let event: z.infer<typeof webhookEventSchema>
    let stripeSignature: string
    try {
      const verifiedEvent = stripe.webhooks.constructEvent(rawBody, sig, secret)
      stripeSignature = verifiedEvent.id
      event = webhookEventSchema.parse(verifiedEvent)
      const { data: existingEvent } = await supabaseAdmin.from('webhook_events').select('id, processed_at').eq('id', stripeSignature).single()
      if (existingEvent) {
        log('info', 'stripe_webhook_duplicate', { requestId, eventId: stripeSignature, processedAt: existingEvent.processed_at })
        return NextResponse.json({ received: true, duplicate: true, requestId })
      }
      await supabaseAdmin.from('webhook_events').insert({ id: stripeSignature, source: 'stripe', event_type: event.type, payload: event, processed_at: new Date().toISOString() })
    } catch (err: any) {
      log('error', 'stripe_webhook_signature_error', { requestId, message: err.message, type: err.type })
      throw ErrorFactory.validation('Webhook signature verification failed')
    }

    try {
      const result = await processWebhookEvent(event, requestId)
      await supabaseAdmin.from('webhook_events').update({ processed_at: new Date().toISOString(), processing_result: result }).eq('id', stripeSignature)
      log('info', 'stripe_webhook_processed', { requestId, eventId: stripeSignature, eventType: event.type, result })
      return NextResponse.json({ received: true, processed: true, requestId })
    } catch (err: any) {
      log('error', 'stripe_webhook_processing_error', { requestId, eventId: stripeSignature, eventType: event.type, message: err.message, stack: err.stack })
      await supabaseAdmin.from('webhook_events').update({ processed_at: new Date().toISOString(), processing_error: { message: err.message, stack: err.stack } }).eq('id', stripeSignature)
      throw ErrorFactory.system('Webhook processing failed')
    }
  } catch (err: any) {
    log('error', 'stripe_webhook_unexpected_error', { requestId, message: err.message, stack: err.stack })
    throw err
  }
})

async function processWebhookEvent(event: z.infer<typeof webhookEventSchema>, requestId: string): Promise<any> {
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = paymentIntentSchema.parse(event.data.object)
      return await handlePaymentIntentSucceeded(pi, requestId)
    }
    case 'payment_intent.payment_failed': {
      const pi = paymentIntentSchema.parse(event.data.object)
      return await handlePaymentIntentFailed(pi, requestId)
    }
    case 'charge.refunded': {
      const charge = chargeSchema.parse(event.data.object)
      return await handleChargeRefunded(charge, requestId)
    }
    case 'transfer.created': {
      const transfer = transferSchema.parse(event.data.object)
      return await handleTransferCreated(transfer, requestId)
    }
    case 'transfer.failed': {
      const transfer = transferSchema.parse(event.data.object)
      return await handleTransferFailed(transfer, requestId)
    }
    case 'charge.dispute.created': {
      const dispute = disputeSchema.parse(event.data.object)
      return await handleDisputeCreated(dispute, requestId)
    }
    case 'charge.dispute.closed': {
      const dispute = disputeSchema.parse(event.data.object)
      return await handleDisputeClosed(dispute, requestId)
    }
    default:
      log('info', 'stripe_webhook_unhandled_event', { requestId, eventType: event.type })
      return { action: 'ignored', reason: 'unhandled_event_type' }
  }
}

async function handlePaymentIntentSucceeded(pi: z.infer<typeof paymentIntentSchema>, requestId: string) {
  const { listing_id, milestone_id } = pi.metadata
  const amount = pi.amount / 100
  const fee = (pi.application_fee_amount || 0) / 100
  const { data: payment } = await supabaseAdmin.from('payments').select('id, buyer_id, seller_id, status').eq('stripe_payment_intent', pi.id).single()
  if (!payment) {
    log('warn', 'payment_intent_succeeded_no_payment', { requestId, intentId: pi.id, amount, metadata: pi.metadata })
    return { action: 'ignored', reason: 'payment_not_found' }
  }
  if (payment.status === 'completed') {
    log('warn', 'payment_intent_succeeded_already_completed', { requestId, paymentId: payment.id, intentId: pi.id })
    return { action: 'ignored', reason: 'payment_already_completed' }
  }
  const { error: rpcError } = await supabaseAdmin.rpc('payment_complete_atomic', { pi_id: pi.id, amount, fee, milestone: milestone_id || null })
  if (rpcError) {
    throw new Error(`Failed to complete payment atomically: ${rpcError.message}`)
  }
  if (milestone_id) {
    const { error: milestoneError } = await supabaseAdmin.from('milestones').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', milestone_id)
    if (milestoneError) {
      log('warn', 'milestone_completion_failed', { requestId, paymentId: payment.id, milestoneId: milestone_id, error: milestoneError.message })
    }
  }
  const notifications: any[] = []
  if (payment.seller_id) {
    notifications.push({ user_id: payment.seller_id, type: 'payment_completed', payload: { payment_id: payment.id, amount, buyer_id: payment.buyer_id } })
  }
  if (payment.buyer_id) {
    notifications.push({ user_id: payment.buyer_id, type: 'payment_sent', payload: { payment_id: payment.id, amount, seller_id: payment.seller_id } })
  }
  if (notifications.length > 0) {
    const { error: notificationError } = await supabaseAdmin.from('notifications').insert(notifications)
    if (notificationError) {
      log('warn', 'notification_creation_failed', { requestId, paymentId: payment.id, error: notificationError.message })
    }
  }
  await createPaymentAuditLog({ payment_id: payment.id, action: 'payment_completed', actor_type: 'system', metadata: { stripe_intent_id: pi.id, amount, fee, milestone_id, request_id: requestId } })
  log('info', 'payment_intent_succeeded_processed', { requestId, paymentId: payment.id, intentId: pi.id, amount, fee })
  return { action: 'payment_completed', paymentId: payment.id, amount, fee }
}

async function handlePaymentIntentFailed(pi: z.infer<typeof paymentIntentSchema>, requestId: string) {
  const amount = pi.amount / 100
  const { data: payment } = await supabaseAdmin.from('payments').select('id, status').eq('stripe_payment_intent', pi.id).single()
  if (!payment) {
    log('warn', 'payment_intent_failed_no_payment', { requestId, intentId: pi.id, amount })
    return { action: 'ignored', reason: 'payment_not_found' }
  }
  const { error: rpcErrorFailed } = await supabaseAdmin.rpc('payment_fail_atomic', { pi_id: pi.id, amount })
  if (rpcErrorFailed) {
    throw new Error(`Failed to mark payment failed atomically: ${rpcErrorFailed.message}`)
  }
  await createPaymentAuditLog({ payment_id: payment.id, action: 'payment_failed', actor_type: 'system', metadata: { stripe_intent_id: pi.id, amount, request_id: requestId } })
  log('warn', 'payment_intent_failed_processed', { requestId, paymentId: payment.id, intentId: pi.id, amount })
  return { action: 'payment_failed', paymentId: payment.id, amount }
}

async function handleChargeRefunded(charge: z.infer<typeof chargeSchema>, requestId: string) {
  const piId = charge.payment_intent
  if (!piId) {
    return { action: 'ignored', reason: 'no_payment_intent' }
  }
  const amountRefunded = (charge.amount_refunded || 0) / 100
  const { data: payment } = await supabaseAdmin.from('payments').select('id, status').eq('stripe_payment_intent', piId).single()
  if (!payment) {
    log('warn', 'charge_refunded_no_payment', { requestId, chargeId: charge.id, paymentIntentId: piId, amountRefunded })
    return { action: 'ignored', reason: 'payment_not_found' }
  }
  const { error: rpcErrorRefund } = await supabaseAdmin.rpc('payment_refund_atomic', { pi_id: piId, amount: amountRefunded })
  if (rpcErrorRefund) {
    throw new Error(`Failed to refund payment atomically: ${rpcErrorRefund.message}`)
  }
  await createPaymentAuditLog({ payment_id: payment.id, action: 'payment_refunded', actor_type: 'system', metadata: { stripe_charge_id: charge.id, stripe_payment_intent_id: piId, amount_refunded: amountRefunded, request_id: requestId } })
  log('info', 'charge_refunded_processed', { requestId, paymentId: payment.id, chargeId: charge.id, amountRefunded })
  return { action: 'payment_refunded', paymentId: payment.id, amountRefunded }
}

async function handleTransferCreated(transfer: z.infer<typeof transferSchema>, requestId: string) {
  const piId = transfer.source_transaction
  if (!piId) {
    return { action: 'ignored', reason: 'no_source_transaction' }
  }
  const amount = transfer.amount / 100
  const { data: payment } = await supabaseAdmin.from('payments').select('id, seller_id').eq('stripe_payment_intent', piId).single()
  if (!payment) {
    log('warn', 'transfer_created_no_payment', { requestId, transferId: transfer.id, paymentIntentId: piId, amount })
    return { action: 'ignored', reason: 'payment_not_found' }
  }
  const { error: transactionError } = await supabaseAdmin.from('transactions').insert({ payment_id: payment.id, type: 'transfer', amount, status: 'created', metadata: { stripe_transfer_id: transfer.id, stripe_payment_intent_id: piId } })
  if (transactionError) {
    throw new Error(`Failed to create transaction: ${transactionError.message}`)
  }
  if (payment.seller_id) {
    const { error: notificationError } = await supabaseAdmin.from('notifications').insert({ user_id: payment.seller_id, type: 'transfer_created', payload: { payment_id: payment.id, amount, transfer_id: transfer.id } })
    if (notificationError) {
      log('warn', 'transfer_notification_failed', { requestId, paymentId: payment.id, sellerId: payment.seller_id, error: notificationError.message })
    }
  }
  await createPaymentAuditLog({ payment_id: payment.id, action: 'transfer_created', actor_type: 'system', metadata: { stripe_transfer_id: transfer.id, stripe_payment_intent_id: piId, amount, request_id: requestId } })
  log('info', 'transfer_created_processed', { requestId, paymentId: payment.id, transferId: transfer.id, amount })
  return { action: 'transfer_created', paymentId: payment.id, amount }
}

async function handleTransferFailed(transfer: z.infer<typeof transferSchema>, requestId: string) {
  const piId = transfer.source_transaction
  if (!piId) {
    return { action: 'ignored', reason: 'no_source_transaction' }
  }
  const amount = transfer.amount / 100
  const { data: payment } = await supabaseAdmin.from('payments').select('id').eq('stripe_payment_intent', piId).single()
  if (!payment) {
    log('warn', 'transfer_failed_no_payment', { requestId, transferId: transfer.id, paymentIntentId: piId, amount })
    return { action: 'ignored', reason: 'payment_not_found' }
  }
  const { error: transactionError } = await supabaseAdmin.from('transactions').insert({ payment_id: payment.id, type: 'transfer', amount, status: 'failed', metadata: { stripe_transfer_id: transfer.id, stripe_payment_intent_id: piId } })
  if (transactionError) {
    throw new Error(`Failed to create transaction: ${transactionError.message}`)
  }
  await createPaymentAuditLog({ payment_id: payment.id, action: 'transfer_failed', actor_type: 'system', metadata: { stripe_transfer_id: transfer.id, stripe_payment_intent_id: piId, amount, request_id: requestId } })
  log('warn', 'transfer_failed_processed', { requestId, paymentId: payment.id, transferId: transfer.id, amount })
  return { action: 'transfer_failed', paymentId: payment.id, amount }
}

async function handleDisputeCreated(dispute: z.infer<typeof disputeSchema>, requestId: string) {
  const chargeId = dispute.charge
  let charge: z.infer<typeof chargeSchema>
  try {
    const stripeCharge = await stripe.charges.retrieve(chargeId)
    charge = chargeSchema.parse(stripeCharge)
  } catch (err: any) {
    throw new Error(`Failed to retrieve charge: ${err.message}`)
  }
  const piId = charge.payment_intent
  if (!piId) {
    return { action: 'ignored', reason: 'no_payment_intent' }
  }
  const { data: payment } = await supabaseAdmin.from('payments').select('id, seller_id, buyer_id, status, amount').eq('stripe_payment_intent', piId).single()
  if (!payment) {
    log('warn', 'dispute_created_no_payment', { requestId, disputeId: dispute.id, chargeId, paymentIntentId: piId })
    return { action: 'ignored', reason: 'payment_not_found' }
  }
  const { error: disputeError } = await supabaseAdmin.from('disputes').insert({ payment_id: payment.id, stripe_dispute_id: dispute.id, reason: dispute.reason || 'unknown', status: 'open', amount: payment.amount, created_at: new Date().toISOString() })
  if (disputeError) {
    throw new Error(`Failed to create dispute: ${disputeError.message}`)
  }
  const { error: updateError } = await supabaseAdmin.from('payments').update({ status: 'disputed', disputed_at: new Date().toISOString() }).eq('id', payment.id)
  if (updateError) {
    throw new Error(`Failed to update payment status: ${updateError.message}`)
  }
  const notifications: any[] = []
  if (payment.seller_id) {
    notifications.push({ user_id: payment.seller_id, type: 'dispute_opened', payload: { payment_id: payment.id, dispute_id: dispute.id, reason: dispute.reason } })
  }
  if (payment.buyer_id) {
    notifications.push({ user_id: payment.buyer_id, type: 'dispute_opened', payload: { payment_id: payment.id, dispute_id: dispute.id, reason: dispute.reason } })
  }
  if (notifications.length > 0) {
    const { error: notificationError } = await supabaseAdmin.from('notifications').insert(notifications)
    if (notificationError) {
      log('warn', 'dispute_notification_failed', { requestId, paymentId: payment.id, disputeId: dispute.id, error: notificationError.message })
    }
  }
  await createPaymentAuditLog({ payment_id: payment.id, action: 'dispute_opened', actor_type: 'system', metadata: { stripe_dispute_id: dispute.id, stripe_charge_id: chargeId, reason: dispute.reason, amount: payment.amount, request_id: requestId } })
  log('warn', 'dispute_created_processed', { requestId, paymentId: payment.id, disputeId: dispute.id, reason: dispute.reason })
  return { action: 'dispute_opened', paymentId: payment.id, disputeId: dispute.id }
}

async function handleDisputeClosed(dispute: z.infer<typeof disputeSchema>, requestId: string) {
  const chargeId = dispute.charge
  let charge: z.infer<typeof chargeSchema>
  try {
    const stripeCharge = await stripe.charges.retrieve(chargeId)
    charge = chargeSchema.parse(stripeCharge)
  } catch (err: any) {
    throw new Error(`Failed to retrieve charge: ${err.message}`)
  }
  const piId = charge.payment_intent
  if (!piId) {
    return { action: 'ignored', reason: 'no_payment_intent' }
  }
  const { data: payment } = await supabaseAdmin.from('payments').select('id, seller_id, buyer_id').eq('stripe_payment_intent', piId).single()
  if (!payment) {
    log('warn', 'dispute_closed_no_payment', { requestId, disputeId: dispute.id, chargeId, paymentIntentId: piId })
    return { action: 'ignored', reason: 'payment_not_found' }
  }
  const { error: disputeError } = await supabaseAdmin.from('disputes').update({ status: dispute.status === 'won' ? 'won' : 'lost', resolved_at: new Date().toISOString() }).eq('payment_id', payment.id)
  if (disputeError) {
    throw new Error(`Failed to update dispute: ${disputeError.message}`)
  }
  const notifications: any[] = []
  if (payment.seller_id) {
    notifications.push({ user_id: payment.seller_id, type: 'dispute_resolved', payload: { payment_id: payment.id, dispute_id: dispute.id, status: dispute.status } })
  }
  if (payment.buyer_id) {
    notifications.push({ user_id: payment.buyer_id, type: 'dispute_resolved', payload: { payment_id: payment.id, dispute_id: dispute.id, status: dispute.status } })
  }
  if (notifications.length > 0) {
    const { error: notificationError } = await supabaseAdmin.from('notifications').insert(notifications)
    if (notificationError) {
      log('warn', 'dispute_resolution_notification_failed', { requestId, paymentId: payment.id, disputeId: dispute.id, error: notificationError.message })
    }
  }
  await createPaymentAuditLog({ payment_id: payment.id, action: 'dispute_resolved', actor_type: 'system', metadata: { stripe_dispute_id: dispute.id, stripe_charge_id: chargeId, status: dispute.status, request_id: requestId } })
  log('info', 'dispute_closed_processed', { requestId, paymentId: payment.id, disputeId: dispute.id, status: dispute.status })
  return { action: 'dispute_resolved', paymentId: payment.id, disputeId: dispute.id, status: dispute.status }
}

async function createPaymentAuditLog(params: { payment_id: string; action: string; actor_type: string; metadata?: any }) {
  const { error } = await supabaseAdmin.from('payment_audit_logs').insert({ payment_id: params.payment_id, action: params.action, actor_type: params.actor_type, metadata: params.metadata, created_at: new Date().toISOString() })
  if (error) {
    log('warn', 'audit_log_creation_failed', { paymentId: params.payment_id, action: params.action, error: error.message })
  }
}
