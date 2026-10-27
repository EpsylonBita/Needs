import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { withApiErrorHandler, ErrorFactory, createValidationError } from '@/lib/utils/error-handler'
import { rateLimitEnhanced, RateLimitConfigs } from '@/lib/utils/rate-limit-enhanced'
import { assertOrderUser, requireOrderPaymentsEnabled } from '@/lib/orders/server'

export const dynamic = 'force-dynamic'

export const POST = withApiErrorHandler(async (request: NextRequest) => {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'

  const authHeader = request.headers.get('Authorization') || ''
  if (!authHeader.startsWith('Bearer ')) {
    throw ErrorFactory.authentication('Unauthorized')
  }
  const token = authHeader.slice(7)
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) {
    throw ErrorFactory.authentication('Unauthorized')
  }
  const body = await request.json().catch(() => null)
  if (!body || (typeof body.paymentId !== 'string' && typeof body.intentId !== 'string')) {
    throw createValidationError('paymentId', 'Choose a payment to complete')
  }
  assertOrderUser(body.expectedUserId, user.id)
  await requireOrderPaymentsEnabled()

  const rateLimitKey = RateLimitConfigs.PAYMENTS.key(`${user.id}:${ip}`)
  const rl = await rateLimitEnhanced(rateLimitKey, RateLimitConfigs.PAYMENTS.sustainedLimit, RateLimitConfigs.PAYMENTS.sustainedWindowMs, { burstLimit: RateLimitConfigs.PAYMENTS.burstLimit, burstWindowMs: RateLimitConfigs.PAYMENTS.burstWindowMs, message: RateLimitConfigs.PAYMENTS.message, failClosed: true })
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many payment attempts. Please try again later.' }, { status: 429, headers: { 'Retry-After': (rl.retryAfter || 0).toString(), 'X-RateLimit-Remaining': '0' } })
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()
  if (profileError || !profile) {
    throw ErrorFactory.businessLogic('Profile not found')
  }

  const { data: payment, error: paymentError } = await supabaseAdmin
    .from('payments')
    .select('id, listing_id, amount, currency, platform_fee, status, stripe_payment_intent, buyer_id, seller_id, role_review_required')
    .eq(body.paymentId ? 'id' : 'stripe_payment_intent', body.paymentId || body.intentId)
    .single()
  if (paymentError) {
    throw ErrorFactory.database('Database error')
  }
  if (!payment) {
    throw ErrorFactory.businessLogic('Payment not found for intent')
  }
  if (payment.buyer_id !== profile.id && payment.seller_id !== profile.id) {
    throw ErrorFactory.authorization('Forbidden - not your payment')
  }
  if (payment.role_review_required) {
    return NextResponse.json({ error: 'This older request payment needs administrator review before it can be captured.' }, { status: 409 })
  }
  const intentId = payment.stripe_payment_intent
  if (!intentId || (body.intentId && body.intentId !== intentId)) throw createValidationError('paymentId', 'The payment does not match this order')
  if (!['requires_capture', 'completed'].includes(payment.status)) {
    return NextResponse.json({ error: 'This payment cannot be captured in its current state.' }, { status: 409 })
  }
  const verifyIntent = (intent: Awaited<ReturnType<typeof stripe.paymentIntents.retrieve>>) => {
    const amount = Number(payment.amount)
    if (intent.id !== intentId || !Number.isFinite(amount) || amount <= 0 || intent.amount !== Math.round(amount * 100)
      || intent.currency !== String(payment.currency).toLowerCase() || intent.capture_method !== 'manual'
      || intent.metadata?.listing_id !== payment.listing_id || intent.metadata?.buyer_profile_id !== payment.buyer_id
      || intent.metadata?.seller_profile_id !== payment.seller_id) {
      throw ErrorFactory.businessLogic('The Stripe payment does not match this order', { userMessage: 'The payment details need administrator review before completion.' })
    }
  }
  const expiredAuthorization = (value: Awaited<ReturnType<typeof stripe.paymentIntents.retrieve>>) => {
    const charge = typeof value.latest_charge === 'object' ? value.latest_charge : null
    const deadline = charge?.payment_method_details?.card?.capture_before
    return value.status === 'requires_capture' && typeof deadline === 'number' && deadline * 1000 <= Date.now()
  }
  let intent = await stripe.paymentIntents.retrieve(intentId, { expand: ['latest_charge'] })
  verifyIntent(intent)
  if (expiredAuthorization(intent)) {
    return NextResponse.json({ error: 'The authorization deadline has passed. Refresh the order to check the release of funds.' }, { status: 409 })
  }
  // The row lock checks both confirmations, trusted authorization evidence and
  // complaints together. A pending claim blocks complaints until reconciliation.
  const { data: claim, error: claimError } = await supabaseAdmin.rpc('claim_order_capture', { p_payment_id: payment.id, p_user_id: user.id })
  if (claimError?.code === '42501') throw ErrorFactory.authorization('This payment cannot be captured by your account')
  if (claimError && ['P0001', '23514', '22023'].includes(claimError.code)) return NextResponse.json({ error: claimError.message }, { status: 409 })
  if (claimError || !claim || claim.payment_id !== payment.id || claim.intent_id !== intentId
    || !['claimed', 'completed'].includes(claim.status) || (claim.status === 'claimed' && !claim.claim_id)) {
    throw ErrorFactory.database('The payment capture request could not be verified')
  }
  const resolveClaim = async (outcome: 'captured' | 'not_captured') => {
    if (!claim.claim_id) return
    const { error } = await supabaseAdmin.rpc('resolve_order_capture', { p_payment_id: payment.id, p_claim_id: claim.claim_id, p_outcome: outcome })
    if (error) throw ErrorFactory.database('Payment reconciliation is pending', { userMessage: 'The payment result is being checked. Refresh its status before trying again.' })
  }
  // The authorization can change while acquiring the shared reservation. Read
  // again after the claim; a stale pre-claim snapshot cannot justify a release.
  try { intent = await stripe.paymentIntents.retrieve(intentId, { expand: ['latest_charge'] }); verifyIntent(intent) }
  catch { return NextResponse.json({ captured: false, pending: true, status: 'verification_pending' }, { status: 202 }) }
  const result = async () => {
    if (intent.status === 'succeeded') {
      await resolveClaim('captured')
      // Only the trusted webhook updates financial state; this acknowledges Stripe.
      return NextResponse.json({ captured: true, pending: payment.status !== 'completed', status: intent.status })
    }
    if (intent.status === 'canceled') {
      await resolveClaim('not_captured')
      return NextResponse.json({ error: 'This payment is not authorized for capture. Refresh its status before continuing.' }, { status: 409 })
    }
    // Other requires_* states are mutable. A concurrent request can advance
    // them; clearing the shared reservation would admit a racing complaint.
    return NextResponse.json({ captured: false, pending: true, status: intent.status }, { status: 202 })
  }
  if (claim.status === 'completed' || intent.status !== 'requires_capture') return result()
  if (expiredAuthorization(intent)) {
    return NextResponse.json({ error: 'The authorization deadline has passed. Refresh the order to check the release of funds.' }, { status: 409 })
  }
  if (intent.amount_capturable !== Math.round(Number(payment.amount) * 100)) {
    // A reduced/expired authorization needs review; keep the claim to avoid a
    // complaint racing an already submitted or partial capture.
    return NextResponse.json({ error: 'The authorized amount needs administrator review before completion.' }, { status: 409 })
  }
  try {
    intent = await stripe.paymentIntents.capture(intentId, undefined, { idempotencyKey: `capture:${intentId}` })
    verifyIntent(intent)
  } catch {
    // Timeouts can happen after Stripe accepted the capture. Reconcile through a
    // fresh read, never clear a reservation based only on a thrown HTTP error.
    try { intent = await stripe.paymentIntents.retrieve(intentId); verifyIntent(intent) }
    catch { return NextResponse.json({ captured: false, pending: true, status: 'verification_pending' }, { status: 202 }) }
  }
  return result()
})
