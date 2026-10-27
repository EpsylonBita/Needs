import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'
import { currentPaymentRefunds } from '@/lib/stripe/refunds'
import { stripe } from '@/lib/stripe/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { withApiErrorHandler, ErrorFactory } from '@/lib/utils/error-handler'
import { log } from '@/lib/utils/logger'
import { rateLimitEnhanced, RateLimitConfigs } from '@/lib/utils/rate-limit-enhanced'
import { lifecycleRpc, LifecycleConflict } from '@/lib/payments/lifecycle'

export const dynamic = 'force-dynamic'

export const POST = withApiErrorHandler(async (req: NextRequest) => {
  const auth = await requireAdmin(req)
  if (!auth.allowed) throw ErrorFactory.authorization(auth.reason || 'forbidden')
  const ip = req.headers.get('x-forwarded-for') || 'unknown'
  const rl = await rateLimitEnhanced(RateLimitConfigs.ADMIN.key(`refund:${ip}`), RateLimitConfigs.ADMIN.limit, RateLimitConfigs.ADMIN.windowMs, { message: RateLimitConfigs.ADMIN.message, failClosed: true })
  if (!rl.allowed) throw ErrorFactory.rateLimit('rate_limited')
  const segments = req.nextUrl.pathname.split('/')
  const id = segments[segments.length - 2]
  log('info', 'ADMIN refund', { id, email: auth.user?.email })
  const { data: dispute } = await supabaseAdmin.from('disputes').select('payment_id, stripe_dispute_id').eq('id', id).single()
  if (!dispute?.payment_id) throw ErrorFactory.businessLogic('Not found')
  if (dispute.stripe_dispute_id) return NextResponse.json({ error: 'Bank disputes must be managed through Stripe.' }, { status: 409 })
  const { data: payment } = await supabaseAdmin
    .from('payments')
    .select('id, stripe_payment_intent')
    .eq('id', dispute.payment_id)
    .single()
  if (!payment?.stripe_payment_intent) throw ErrorFactory.validation('No payment intent')
  const intent = await stripe.paymentIntents.retrieve(payment.stripe_payment_intent, { expand: ['latest_charge'] })
  if (intent.status !== 'succeeded') return NextResponse.json({ error: 'Only captured payments can be refunded.' }, { status: 409 })
  const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null
  if (charge?.disputed) return NextResponse.json({ error: 'Bank disputes must be managed through Stripe.' }, { status: 409 })
  const refunds = await currentPaymentRefunds(intent.id)
  if (refunds.some(refund => refund.status === 'failed' || refund.status === 'canceled')) {
    return NextResponse.json({ error: 'A previous refund failed or was canceled. Review it in Stripe before retrying.' }, { status: 409 })
  }
  if (refunds.some(refund => refund.status === 'pending' || refund.status === 'requires_action')) {
    return NextResponse.json({ success: true, status: 'pending' })
  }
  if (refunds.reduce((sum, refund) => sum + (refund.status === 'succeeded' ? refund.amount : 0), 0) >= intent.amount) {
    return NextResponse.json({ success: true, refunded: true, status: 'succeeded' })
  }
  try {
    // A durable reservation under the payment row lock excludes a simultaneous
    // seller-recovery approval. Keep it if Stripe's outcome is uncertain.
    await lifecycleRpc('reserve_admin_payment_refund', { p_payment_id: payment.id, p_admin_user_id: auth.user?.id })
  } catch (error) {
    if (error instanceof LifecycleConflict) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
  const refund = await stripe.refunds.create({
    payment_intent: payment.stripe_payment_intent,
    // Destination funds and the platform fee must return with the customer's
    // refund; otherwise the platform pays while the seller keeps the proceeds.
    ...(intent.transfer_data?.destination ? {
      reverse_transfer: true,
      ...(intent.application_fee_amount ? { refund_application_fee: true } : {}),
    } : {}),
  }, { idempotencyKey: `refund:${payment.stripe_payment_intent}` })
  if (refund.status === 'failed' || refund.status === 'canceled') throw ErrorFactory.businessLogic('Stripe could not complete the refund')
  const { error: auditError } = await supabaseAdmin.from('payment_audit_logs').insert({ payment_id: payment.id, action: 'admin_refund', actor_type: 'admin', metadata: { dispute_id: id, admin_email: auth.user?.email, refund_id: refund.id } })
  if (auditError) throw ErrorFactory.database('Refund requested but the audit could not be recorded; retry safely')
  return NextResponse.json({ success: true, status: refund.status })
})
