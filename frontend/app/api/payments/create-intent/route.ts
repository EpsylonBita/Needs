import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { log } from '@/lib/utils/logger'
import { rateLimitEnhanced, RateLimitConfigs } from '@/lib/utils/rate-limit-enhanced'
import { withApiErrorHandler, ErrorFactory, createValidationError } from '@/lib/utils/error-handler'
import { z } from 'zod'

const createIntentSchema = z.object({
  listingId: z.string().uuid(),
})

export const dynamic = 'force-dynamic'

export const POST = withApiErrorHandler(async (request: NextRequest) => {
  const requestId = crypto.randomUUID()
  const ip = request.headers.get('x-forwarded-for') || 'unknown'

  const flag = await supabaseAdmin.from('feature_flags').select('enabled').eq('key', 'payments_enabled').single()
  const paymentsEnabledEnv = (process.env.NEXT_PUBLIC_PAYMENTS_ENABLED || '').toLowerCase() === 'true'
  const paymentsEnabled = paymentsEnabledEnv || !!flag.data?.enabled
  if (!paymentsEnabled) {
    throw ErrorFactory.authorization('Payments are currently disabled')
  }

  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    throw ErrorFactory.authentication('Authentication required')
  }

  const token = authHeader.split(' ')[1]
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) {
    throw ErrorFactory.authentication('Invalid authentication')
  }

  const rateLimitKey = RateLimitConfigs.PAYMENTS.key(`${user.id}:${ip}`)
  const rateLimitResult = await rateLimitEnhanced(
    rateLimitKey,
    RateLimitConfigs.PAYMENTS.sustainedLimit,
    RateLimitConfigs.PAYMENTS.sustainedWindowMs,
    {
      message: RateLimitConfigs.PAYMENTS.message,
      burstLimit: RateLimitConfigs.PAYMENTS.burstLimit,
      burstWindowMs: RateLimitConfigs.PAYMENTS.burstWindowMs,
      failClosed: true
    }
  )

  if (!rateLimitResult.allowed) {
    log('warn', 'payment_rate_limit_exceeded', { requestId, endpoint: 'create-payment-intent', ip, retryAfter: rateLimitResult.retryAfter })
    return new NextResponse(JSON.stringify({ error: 'Too many payment attempts. Please try again later.', requestId }), { status: 429, headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId, 'Retry-After': (rateLimitResult.retryAfter || 0).toString(), 'X-RateLimit-Remaining': '0' } })
  }

  const body = await request.json()
  const validation = createIntentSchema.safeParse(body)
  if (!validation.success) {
    throw createValidationError('listingId', 'Invalid request data')
  }

  const { listingId } = validation.data
  const { data: listing, error: listingError } = await supabaseAdmin
    .from('listings')
    .select('id, price, seller_id, title')
    .eq('id', listingId)
    .eq('status', 'active')
    .single()
  if (listingError || !listing) {
    throw ErrorFactory.businessLogic('Listing not found or unavailable')
  }

  const { data: buyerProfile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, stripe_customer_id')
    .eq('user_id', user.id)
    .single()
  if (profileError || !buyerProfile) {
    throw ErrorFactory.businessLogic('Profile not found')
  }

  if (listing.seller_id === buyerProfile.id) {
    throw ErrorFactory.businessLogic('Cannot purchase your own listing')
  }

  const { data: seller, error: sellerError } = await supabaseAdmin
    .from('profiles')
    .select('id, stripe_account_id, display_name')
    .eq('id', listing.seller_id)
    .single()
  if (sellerError || !seller?.stripe_account_id) {
    throw ErrorFactory.businessLogic('Seller not set up for payments')
  }

  const amount = Math.round(Number(listing.price) * 100)
  const platformFee = Math.round(Number(listing.price) * 0.05 * 100)
  const sellerAmount = amount - platformFee
  const idempotencyKey = `intent:${buyerProfile.id}:${listing.id}:${amount}`

  await supabaseAdmin.from('payment_audit_logs').insert({
    action: 'intent_creation_attempt',
    buyer_id: buyerProfile.id,
    seller_id: seller.id,
    listing_id: listing.id,
    amount: amount / 100,
    platform_fee: platformFee / 100,
    metadata: { ip, user_agent: request.headers.get('user-agent'), request_id: requestId }
  })

  let intent
  try {
    intent = await stripe.paymentIntents.create({
      amount,
      currency: 'usd',
      application_fee_amount: platformFee,
      transfer_data: { destination: seller.stripe_account_id },
      capture_method: 'manual',
      metadata: {
        listing_id: listing.id,
        seller_profile_id: seller.id,
        buyer_profile_id: buyerProfile.id,
        listing_title: listing.title,
        platform_fee_percent: '5',
      },
      description: `Purchase: ${listing.title}`,
    }, { idempotencyKey })
  } catch (e) {
    await supabaseAdmin.from('payment_audit_logs').insert({
      action: 'intent_creation_failed',
      buyer_id: buyerProfile.id,
      seller_id: seller.id,
      listing_id: listing.id,
      amount: amount / 100,
      platform_fee: platformFee / 100,
      metadata: { ip, user_agent: request.headers.get('user-agent'), request_id: requestId }
    })
    throw e
  }

  await supabaseAdmin.from('payment_audit_logs').insert({
    action: 'intent_created',
    buyer_id: buyerProfile.id,
    seller_id: seller.id,
    listing_id: listing.id,
    amount: amount / 100,
    platform_fee: platformFee / 100,
    metadata: { ip, user_agent: request.headers.get('user-agent'), request_id: requestId, intent_id: intent.id }
  })

  const { error: paymentError } = await supabaseAdmin
    .from('payments')
    .insert({
      listing_id: listing.id,
      buyer_id: buyerProfile.id,
      seller_id: seller.id,
      amount: amount / 100,
      platform_fee: platformFee / 100,
      stripe_payment_intent: intent.id,
      status: 'requires_capture',
      buyer_confirmed: false,
      seller_confirmed: false,
    })
  if (paymentError) {
    await stripe.paymentIntents.cancel(intent.id)
    await supabaseAdmin.from('payment_audit_logs').insert({
      action: 'intent_cancelled_on_db_error',
      buyer_id: buyerProfile.id,
      seller_id: seller.id,
      listing_id: listing.id,
      amount: amount / 100,
      platform_fee: platformFee / 100,
      metadata: { ip, user_agent: request.headers.get('user-agent'), request_id: requestId, intent_id: intent.id }
    })
    throw new Error('Failed to create payment record')
  }

  log('info', 'payment_intent_created', { intent_id: intent.id, buyer_id: buyerProfile.id, seller_id: seller.id, listing_id: listing.id, amount: amount / 100, ip, requestId })

  return new NextResponse(JSON.stringify({ clientSecret: intent.client_secret, paymentId: intent.id, platformFee: platformFee / 100, totalAmount: amount / 100, sellerAmount: sellerAmount / 100, requestId }), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId, 'X-RateLimit-Remaining': (rateLimitResult.remaining || 0).toString() } })
})
