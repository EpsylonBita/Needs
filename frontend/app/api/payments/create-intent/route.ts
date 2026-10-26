import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTradeParties, requirePayer } from '@/lib/payments/transaction-context'
import { listingRequiresAgreedTotal, RATE_PRICE_PAYMENT_ERROR } from '@/lib/listings/price-display'
import { latestServiceAgreement, requireAcceptedAgreement, serviceAgreementEligible, AGREEMENT_CHANGED } from '@/lib/payments/service-agreements'
import { requireTransferCapability } from '@/lib/stripe/connect'
import { stripe } from '@/lib/stripe/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { withApiErrorHandler, ErrorFactory, createValidationError } from '@/lib/utils/error-handler'
import { log } from '@/lib/utils/logger'
import { rateLimitEnhanced, RateLimitConfigs } from '@/lib/utils/rate-limit-enhanced'

const createIntentSchema = z.object({
  listingId: z.string().uuid(),
  chatId: z.string().uuid().optional(),
  agreementId: z.string().uuid().optional(),
})

export const dynamic = 'force-dynamic'

export const POST = withApiErrorHandler(async (request: NextRequest) => {
  const requestId = crypto.randomUUID()
  const ip = request.headers.get('x-forwarded-for') || 'unknown'

  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    throw ErrorFactory.authentication('Authentication required', { userMessage: 'Authentication required' })
  }

  const token = authHeader.split(' ')[1]
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) {
    throw ErrorFactory.authentication('Invalid authentication', { userMessage: 'Invalid authentication' })
  }

  const flag = await supabaseAdmin.from('feature_flags').select('enabled').eq('key', 'payments_enabled').single()
  const paymentsEnabledEnv = (process.env.NEXT_PUBLIC_PAYMENTS_ENABLED || '').toLowerCase() === 'true'
  const paymentsEnabled = paymentsEnabledEnv || !!flag.data?.enabled
  if (!paymentsEnabled) throw ErrorFactory.authorization('Payments are currently disabled', { userMessage: 'Payments are currently disabled' })

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

  const { listingId, chatId, agreementId } = validation.data
  const { data: listing, error: listingError } = await supabaseAdmin
    .from('listings')
    .select('id, price, description, seller_id, title, main_category, sub_category')
    .eq('id', listingId)
    .eq('status', 'active')
    .single()
  if (listingError || !listing) {
    throw ErrorFactory.businessLogic('Listing not found or unavailable', { userMessage: 'Listing not found or unavailable' })
  }
  const isRate = listingRequiresAgreedTotal(listing.description)
  if (isRate && (!serviceAgreementEligible(listing) || !chatId || !agreementId)) throw createValidationError('agreementId', RATE_PRICE_PAYMENT_ERROR)
  if (agreementId && !isRate) throw createValidationError('agreementId', AGREEMENT_CHANGED)

  const { data: buyerProfile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()
  if (profileError || !buyerProfile) {
    throw ErrorFactory.businessLogic('Profile not found')
  }

  const parties = await resolveTradeParties(listing, buyerProfile.id, chatId)
  // A legacy missing rate is not a free transaction once both parties agree a positive total.
  if (isRate) {
    if (parties.buyerId !== buyerProfile.id) throw ErrorFactory.authorization('Only the buyer can pay for this agreement')
  } else requirePayer(parties, buyerProfile.id)
  const agreement = isRate ? requireAcceptedAgreement(await latestServiceAgreement(listing.id, chatId!), listing, agreementId!, parties.buyerId, parties.sellerId) : null

  const { data: seller, error: sellerError } = await supabaseAdmin
    .from('profiles')
    .select('id, stripe_account_id, display_name')
    .eq('id', parties.sellerId)
    .single()
  if (sellerError || !seller?.stripe_account_id) {
    throw createValidationError('listingId', 'Seller not set up for payments')
  }

  const amount = Math.round(Number(agreement?.amount ?? listing.price) * 100)
  if (!Number.isFinite(amount) || amount <= 0) throw createValidationError('listingId', 'This listing does not require a payment')
  const platformFee = Math.round(amount / 20)
  const sellerAmount = amount - platformFee
  let idempotencyKey = `intent:eur:${buyerProfile.id}:${listing.id}:${amount}`
  if (parties.isRequest) idempotencyKey += `:provider:${seller.id}`
  if (agreement) idempotencyKey = `service-agreement:eur:${agreement.id}:${amount}`

  // Stripe's idempotency cache is temporary. The persisted buyer/listing payment
  // is the durable reference for abandoned checkouts and authorization expiry.
  let previousQuery = supabaseAdmin.from('payments')
    .select('id,stripe_payment_intent,amount,platform_fee,currency,seller_id')
    .eq('buyer_id', buyerProfile.id).eq('seller_id', seller.id).eq('listing_id', listing.id).is('milestone_id', null)
  previousQuery = agreement ? previousQuery.eq('agreement_id', agreement.id) : previousQuery.is('agreement_id', null)
  const { data: previous, error: previousError } = await previousQuery.order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (previousError) throw ErrorFactory.database('Previous payment could not be loaded')
  if (previous?.stripe_payment_intent) {
    const existingIntent = await stripe.paymentIntents.retrieve(previous.stripe_payment_intent)
    if (existingIntent.status === 'canceled') {
      const { error: retirementError } = agreement
        ? await supabaseAdmin.rpc('retire_service_agreement_payment', { p_agreement_id: agreement.id, p_buyer_id: buyerProfile.id, p_intent_id: existingIntent.id })
        : await supabaseAdmin.from('payments').update({ status: 'failed', failed_at: new Date().toISOString() })
          .eq('id', previous.id).eq('stripe_payment_intent', existingIntent.id)
      if (retirementError) throw ErrorFactory.database('Expired payment could not be closed')
      // Concurrent retries of the same canceled attempt share the same next key.
      idempotencyKey += `:after:${existingIntent.id}`
    } else {
      if (existingIntent.status === 'succeeded') {
        return NextResponse.json({ error: 'This payment is already completed. View it in Payments.' }, { status: 409 })
      }
      if (existingIntent.status === 'requires_capture' || existingIntent.status === 'processing') {
        return NextResponse.json({ error: 'This payment is already authorized or processing. View it in Payments.' }, { status: 409 })
      }
      if (previous.seller_id !== seller.id || Math.round(Number(previous.amount) * 100) !== amount || previous.currency !== 'eur') {
        return NextResponse.json({ error: 'This checkout has different payment details. Resolve the existing payment before starting another.' }, { status: 409 })
      }
      if (agreement && (existingIntent.amount !== amount || existingIntent.currency !== 'eur'
        || existingIntent.application_fee_amount !== platformFee || existingIntent.metadata?.service_agreement_id !== agreement.id
        || existingIntent.transfer_data?.destination !== seller.stripe_account_id)) {
        return NextResponse.json({ error: 'This checkout has different payment details. Resolve the existing payment before starting another.' }, { status: 409 })
      }
      if (!existingIntent.client_secret) throw ErrorFactory.system('Existing checkout could not be resumed')
      return NextResponse.json({
        clientSecret: existingIntent.client_secret, paymentId: existingIntent.id,
        platformFee: Number(previous.platform_fee), totalAmount: Number(previous.amount),
        sellerAmount: Number(previous.amount) - Number(previous.platform_fee), requestId,
      }, { headers: { 'X-Request-Id': requestId } })
    }
  }

  await requireTransferCapability(seller.stripe_account_id)

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
      currency: 'eur',
      application_fee_amount: platformFee,
      transfer_data: { destination: seller.stripe_account_id },
      capture_method: 'manual',
      ...(user.email_confirmed_at && user.email ? { receipt_email: user.email } : {}),
      metadata: {
        listing_id: listing.id,
        seller_profile_id: seller.id,
        buyer_profile_id: buyerProfile.id,
        listing_title: listing.title,
        platform_fee_percent: '5',
        ...(agreement ? { service_agreement_id: agreement.id, chat_id: chatId! } : {}),
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

  const { data: paymentRecord, error: paymentError } = agreement
    ? await supabaseAdmin.rpc('create_agreed_service_payment', { p_agreement_id: agreement.id, p_buyer_id: buyerProfile.id, p_intent_id: intent.id })
    : await supabaseAdmin.rpc('create_listing_payment', {
    p_listing_id: listing.id, p_buyer_id: buyerProfile.id, p_seller_id: seller.id,
    p_amount: amount / 100, p_platform_fee: platformFee / 100, p_intent_id: intent.id,
    p_chat_id: parties.chatId,
  })
  if (paymentError) {
    if (paymentError.code === 'P0001' || paymentError.code?.startsWith('23')) {
      await stripe.paymentIntents.cancel(intent.id)
    }
    await supabaseAdmin.from('payment_audit_logs').insert({
      action: 'payment_persistence_failed',
      buyer_id: buyerProfile.id,
      seller_id: seller.id,
      listing_id: listing.id,
      amount: amount / 100,
      platform_fee: platformFee / 100,
      metadata: { ip, user_agent: request.headers.get('user-agent'), request_id: requestId, intent_id: intent.id }
    })
    throw new Error('Failed to create payment record')
  }
  if (!paymentRecord?.payment_id) throw ErrorFactory.database('Invalid payment creation result')

  log('info', 'payment_intent_created', { intent_id: intent.id, buyer_id: buyerProfile.id, seller_id: seller.id, listing_id: listing.id, amount: amount / 100, ip, requestId })

  return new NextResponse(JSON.stringify({ clientSecret: intent.client_secret, paymentId: intent.id, platformFee: platformFee / 100, totalAmount: amount / 100, sellerAmount: sellerAmount / 100, requestId }), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId, 'X-RateLimit-Remaining': (rateLimitResult.remaining || 0).toString() } })
})
