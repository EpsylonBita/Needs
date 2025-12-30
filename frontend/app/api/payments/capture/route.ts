import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { rateLimitEnhanced, RateLimitConfigs } from '@/lib/utils/rate-limit-enhanced'
import { withApiErrorHandler, ErrorFactory, createValidationError } from '@/lib/utils/error-handler'

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

  const body = await request.json()
  const { intentId } = body as { intentId: string }
  if (!intentId) {
    throw createValidationError('intentId', 'intentId required')
  }

  const { data: payment, error: paymentError } = await supabaseAdmin
    .from('payments')
    .select('id, buyer_confirmed, seller_confirmed, buyer_id, seller_id')
    .eq('stripe_payment_intent', intentId)
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
  if (!payment.buyer_confirmed || !payment.seller_confirmed) {
    return NextResponse.json({ error: 'Both parties must confirm before capture' }, { status: 409 })
  }

  const pi = await stripe.paymentIntents.capture(intentId, undefined, { idempotencyKey: `capture:${intentId}` })
  await supabaseAdmin.from('payment_audit_logs').insert({ payment_id: payment.id, action: 'intent_captured', actor_type: 'user', metadata: { intent_id: intentId } })
  return NextResponse.json({ captured: true, status: pi.status })
})
