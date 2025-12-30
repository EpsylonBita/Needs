import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { log } from '@/lib/utils/logger'
import { rateLimitEnhanced, RateLimitConfigs } from '@/lib/utils/rate-limit-enhanced'
import { withApiErrorHandler, ErrorFactory, createValidationError } from '@/lib/utils/error-handler'
import { z } from 'zod'

const createMilestoneSchema = z.object({
  listingId: z.string().uuid(),
  title: z.string().min(1).max(200),
  amount: z.number().positive().max(10000),
})

export const dynamic = 'force-dynamic'

export const POST = withApiErrorHandler(async (request: NextRequest) => {
  const requestId = crypto.randomUUID()
  const ip = request.headers.get('x-forwarded-for') || 'unknown'

  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    throw ErrorFactory.authentication('Authentication required')
  }
  const token = authHeader.split(' ')[1]
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) {
    throw ErrorFactory.authentication('Invalid authentication')
  }

  const rateLimitKey = RateLimitConfigs.MILESTONES.key(`${user.id}:${ip}`)
  const rateLimitResult = await rateLimitEnhanced(
    rateLimitKey,
    RateLimitConfigs.MILESTONES.sustainedLimit,
    RateLimitConfigs.MILESTONES.sustainedWindowMs,
    {
      message: RateLimitConfigs.MILESTONES.message,
      burstLimit: RateLimitConfigs.MILESTONES.burstLimit,
      burstWindowMs: RateLimitConfigs.MILESTONES.burstWindowMs,
      failClosed: true
    }
  )
  if (!rateLimitResult.allowed) {
    log('warn', 'milestone_rate_limit_exceeded', { requestId, endpoint: 'create-milestone-intent', ip, retryAfter: rateLimitResult.retryAfter })
    return NextResponse.json({ error: 'Too many milestone creation attempts. Please try again later.', requestId }, { status: 429, headers: { 'Retry-After': (rateLimitResult.retryAfter || 0).toString(), 'X-RateLimit-Remaining': '0' } })
  }

  const flag = await supabaseAdmin.from('feature_flags').select('enabled').eq('key', 'payments_enabled').single()
  const paymentsEnabledEnv = (process.env.NEXT_PUBLIC_PAYMENTS_ENABLED || '').toLowerCase() === 'true'
  const paymentsEnabled = paymentsEnabledEnv || ((flag as any)?.data?.enabled ?? true)
  if (!paymentsEnabled) {
    throw ErrorFactory.authorization('Payments are currently disabled')
  }

  const body = await request.json()
  const validation = createMilestoneSchema.safeParse(body)
  if (!validation.success) {
    throw createValidationError('listingId', 'Invalid request data')
  }

  const { listingId, title, amount } = validation.data
  const { data: listing, error: listingError } = await supabaseAdmin
    .from('listings')
    .select('id, price, seller_id, title, status')
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
    throw ErrorFactory.businessLogic('Cannot create milestone for your own listing')
  }
  if (amount > Number(listing.price)) {
    throw ErrorFactory.validation('Milestone amount cannot exceed listing price')
  }

  const { data: seller, error: sellerError } = await supabaseAdmin
    .from('profiles')
    .select('id, stripe_account_id, display_name')
    .eq('id', listing.seller_id)
    .single()
  if (sellerError || !seller?.stripe_account_id) {
    throw ErrorFactory.businessLogic('Seller not set up for payments')
  }

  const { data: existingMilestones } = await supabaseAdmin
    .from('milestones')
    .select('amount')
    .eq('listing_id', listingId)
    .eq('status', 'pending')
  const existingTotal = existingMilestones?.reduce((sum: number, m: { amount: number }) => sum + Number(m.amount), 0) || 0
  const newTotal = existingTotal + amount
  if (newTotal > Number(listing.price)) {
    throw ErrorFactory.validation('Total milestone amount would exceed listing price')
  }

  const amountCents = Math.round(amount * 100)
  const platformFee = Math.round(amount * 0.05 * 100)
  const sellerAmount = amountCents - platformFee

  await supabaseAdmin.from('payment_audit_logs').insert({ action: 'milestone_intent_created', buyer_id: buyerProfile.id, seller_id: seller.id, listing_id: listing.id, amount: amount, platform_fee: platformFee / 100, metadata: { milestone_title: title, ip, user_agent: request.headers.get('user-agent'), existing_milestone_total: existingTotal, request_id: requestId } })

  const idempotencyKey = `milestone:${buyerProfile.id}:${listing.id}:${title}:${amountCents}`
  const intent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    application_fee_amount: platformFee,
    transfer_data: { destination: seller.stripe_account_id },
    capture_method: 'manual',
    metadata: {
      listing_id: listing.id,
      seller_profile_id: seller.id,
      buyer_profile_id: buyerProfile.id,
      listing_title: listing.title,
      milestone_title: title,
      milestone_type: 'milestone',
      platform_fee_percent: '5',
    },
    description: `Milestone: ${title} for ${listing.title}`,
  }, { idempotencyKey })

  const { error: milestoneError } = await supabaseAdmin
    .from('milestones')
    .insert({
      listing_id: listing.id,
      buyer_id: buyerProfile.id,
      seller_id: seller.id,
      title: title,
      amount: amount,
      stripe_payment_intent: intent.id,
      status: 'pending',
      buyer_confirmed: false,
      seller_confirmed: false,
    })
  if (milestoneError) {
    await stripe.paymentIntents.cancel(intent.id)
    throw ErrorFactory.database('Failed to create milestone record')
  }

  log('info', 'milestone_intent_created', { intent_id: intent.id, milestone_title: title, buyer_id: buyerProfile.id, seller_id: seller.id, listing_id: listing.id, amount: amount, ip, requestId })

  return NextResponse.json({ clientSecret: intent.client_secret, milestoneId: intent.id, platformFee: platformFee / 100, totalAmount: amount, sellerAmount: sellerAmount / 100, title: title, requestId })
})
