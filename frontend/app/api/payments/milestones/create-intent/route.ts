import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTradeParties, requirePayer } from '@/lib/payments/transaction-context'
import { listingRequiresAgreedTotal, RATE_PRICE_PAYMENT_ERROR } from '@/lib/listings/price-display'
import { requireTransferCapability } from '@/lib/stripe/connect'
import { stripe } from '@/lib/stripe/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { withApiErrorHandler, ErrorFactory, createValidationError } from '@/lib/utils/error-handler'
import { log } from '@/lib/utils/logger'
import { rateLimitEnhanced, RateLimitConfigs } from '@/lib/utils/rate-limit-enhanced'

const createMilestoneSchema = z.object({
  listingId: z.string().uuid(),
  chatId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  amount: z.number().positive().max(10000).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001),
  milestoneId: z.string().uuid().optional(),
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
  const paymentsEnabled = paymentsEnabledEnv || !!flag.data?.enabled
  if (!paymentsEnabled) {
    throw ErrorFactory.authorization('Payments are currently disabled')
  }
  const milestoneFlag = await supabaseAdmin.from('feature_flags').select('enabled').eq('key', 'milestones_enabled').single()
  if (milestoneFlag.error || milestoneFlag.data?.enabled !== true) {
    throw ErrorFactory.authorization('Milestones are currently disabled')
  }

  const body = await request.json()
  const validation = createMilestoneSchema.safeParse(body)
  if (!validation.success) {
    throw createValidationError('listingId', 'Invalid request data')
  }

  const { listingId, title, amount, milestoneId, chatId } = validation.data
  const { data: listing, error: listingError } = await supabaseAdmin
    .from('listings')
    .select('id, price, description, seller_id, title, status, main_category, sub_category')
    .eq('id', listingId)
    .eq('status', 'active')
    .single()
  if (listingError || !listing) {
    throw ErrorFactory.businessLogic('Listing not found or unavailable', { userMessage: 'Listing not found or unavailable' })
  }
  if (listingRequiresAgreedTotal(listing.description)) throw createValidationError('listingId', RATE_PRICE_PAYMENT_ERROR)

  const { data: buyerProfile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()
  if (profileError || !buyerProfile) {
    throw ErrorFactory.businessLogic('Profile not found')
  }
  if (amount > Number(listing.price)) {
    throw createValidationError('amount', 'Milestone amount cannot exceed listing price')
  }

  const { data: existingMilestones, error: milestonesError } = await supabaseAdmin
    .from('milestones')
    .select('id, amount, title, stripe_payment_intent, status, seller_id, chat_id')
    .eq('listing_id', listingId)
    .eq('buyer_id', buyerProfile.id)
    .order('created_at', { ascending: false })
  if (milestonesError) throw ErrorFactory.database('Could not load existing milestones')
  const savedProposal = milestoneId ? existingMilestones?.find(m => m.id === milestoneId) : null
  if (milestoneId && (!savedProposal || savedProposal.title !== title || Number(savedProposal.amount) !== amount)) {
    throw createValidationError('milestoneId', 'Milestone proposal not found or does not match')
  }
  if (savedProposal?.chat_id && chatId && savedProposal.chat_id !== chatId) {
    throw createValidationError('chatId', 'The conversation does not match this milestone')
  }
  const parties = await resolveTradeParties(listing, buyerProfile.id, savedProposal?.chat_id || chatId)
  requirePayer(parties, buyerProfile.id)
  if (savedProposal && savedProposal.seller_id !== parties.sellerId) {
    throw createValidationError('milestoneId', 'The provider does not match this milestone')
  }
  const { data: seller, error: sellerError } = await supabaseAdmin
    .from('profiles').select('id, stripe_account_id, display_name').eq('id', parties.sellerId).single()
  if (sellerError || !seller?.stripe_account_id) throw createValidationError('listingId', 'Seller not set up for payments')
  const partyMilestones = existingMilestones?.filter(m => m.seller_id === parties.sellerId) || []
  const existingTotal = partyMilestones.reduce((sum: number, m: { amount: number; status: string }) => sum + (m.status === 'failed' ? 0 : Number(m.amount)), 0)
  const newTotal = existingTotal + amount
  const proposal = partyMilestones.find((m: { id: string; title: string; amount: number }) =>
    (!milestoneId || m.id === milestoneId) && m.title === title && Number(m.amount) === amount)
  if (milestoneId && !proposal) throw createValidationError('milestoneId', 'Milestone proposal not found or does not match')
  const isRetry = !!proposal
  if (!isRetry && newTotal > Number(listing.price)) {
    throw createValidationError('amount', 'Total milestone amount would exceed listing price')
  }

  const amountCents = Math.round(amount * 100)
  const platformFee = Math.round(amount * 0.05 * 100)
  const sellerAmount = amountCents - platformFee

  await supabaseAdmin.from('payment_audit_logs').insert({ action: 'milestone_intent_created', buyer_id: buyerProfile.id, seller_id: seller.id, listing_id: listing.id, amount: amount, platform_fee: platformFee / 100, metadata: { milestone_title: title, ip, user_agent: request.headers.get('user-agent'), existing_milestone_total: existingTotal, request_id: requestId } })

  let idempotencyKey = `milestone:eur:${buyerProfile.id}:${listing.id}:${proposal?.id || title}:${amountCents}`
  if (parties.isRequest) idempotencyKey += `:provider:${seller.id}`
  let reusableIntent
  if (proposal?.stripe_payment_intent) {
    const previous = await stripe.paymentIntents.retrieve(proposal.stripe_payment_intent)
    if (previous.status === 'canceled') {
      const retired = await supabaseAdmin.from('payments').update({ status: 'failed' }).eq('stripe_payment_intent', previous.id).eq('buyer_id', buyerProfile.id)
      if (retired.error) throw ErrorFactory.database('Could not retire canceled payment')
      const failed = await supabaseAdmin.from('milestones').update({ status: 'failed' }).eq('id', proposal.id).eq('buyer_id', buyerProfile.id)
      if (failed.error) throw ErrorFactory.database('Could not retire canceled milestone')
      idempotencyKey += `:after:${previous.id}`
    } else if (['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(previous.status)) {
      if (previous.currency !== 'eur' || previous.amount !== amountCents) throw createValidationError('amount', 'Existing payment amount or currency differs from this milestone')
      reusableIntent = previous
    } else {
      return NextResponse.json({ error: 'This milestone payment is already authorized or completed. View it in your dashboard.' }, { status: 409 })
    }
  }
  if (!reusableIntent) await requireTransferCapability(seller.stripe_account_id)
  const intent = reusableIntent || await stripe.paymentIntents.create({
    amount: amountCents,
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
      milestone_title: title,
      milestone_type: 'milestone',
      platform_fee_percent: '5',
    },
    description: `Milestone: ${title} for ${listing.title}`,
  }, { idempotencyKey })

  const { data: records, error: milestoneError } = await supabaseAdmin.rpc('create_milestone_payment', {
    p_listing_id: listing.id,
    p_buyer_id: buyerProfile.id,
    p_seller_id: seller.id,
    p_title: title,
    p_amount: amount,
    p_platform_fee: platformFee / 100,
    p_intent_id: intent.id,
    p_milestone_id: proposal?.id || null,
    p_chat_id: parties.chatId,
  })
  if (milestoneError) {
    // A transport timeout can occur after commit. Do not cancel a possibly
    // persisted intent; deterministic SQL validation failures are safe to undo.
    if (milestoneError.code === 'P0001' || milestoneError.code?.startsWith('23')) {
      await stripe.paymentIntents.cancel(intent.id)
    }
    throw ErrorFactory.database('Failed to create milestone record')
  }
  if (!records?.milestone_id || !records?.payment_id) throw ErrorFactory.database('Invalid milestone creation result')

  log('info', 'milestone_intent_created', { intent_id: intent.id, milestone_title: title, buyer_id: buyerProfile.id, seller_id: seller.id, listing_id: listing.id, amount: amount, ip, requestId })

  return NextResponse.json({ clientSecret: intent.client_secret, milestoneId: records.milestone_id, paymentId: records.payment_id, intentId: intent.id, platformFee: platformFee / 100, totalAmount: amount, sellerAmount: sellerAmount / 100, title: title, requestId })
})
