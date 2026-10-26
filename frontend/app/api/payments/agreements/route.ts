import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/server'
import { resolveTradeParties } from '@/lib/payments/transaction-context'
import { serviceAgreementEligible, AGREEMENT_CHANGED } from '@/lib/payments/service-agreements'
import { rateLimitEnhanced } from '@/lib/utils/rate-limit-enhanced'
import { stripe } from '@/lib/stripe/server'
import { withApiErrorHandler, ErrorFactory, createValidationError } from '@/lib/utils/error-handler'

const base = { listingId: z.string().uuid(), chatId: z.string().uuid() }
const schema = z.discriminatedUnion('action', [
  z.object({ ...base, action: z.literal('propose'), amount: z.number().finite().min(0.5).max(999999.99).multipleOf(0.01), expectedAgreementId: z.string().uuid().nullable() }).strict(),
  ...(['accept', 'reject', 'withdraw', 'reconcile'] as const).map(action => z.object({ ...base, action: z.literal(action), agreementId: z.string().uuid() }).strict()),
])
export const dynamic = 'force-dynamic'

export const POST = withApiErrorHandler(async (request: NextRequest) => {
  const auth = request.headers.get('authorization') || ''
  if (!auth.startsWith('Bearer ')) throw ErrorFactory.authentication('Authentication required')
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(auth.slice(7))
  if (error || !user) throw ErrorFactory.authentication('Invalid authentication')
  const input = schema.safeParse(await request.json())
  if (!input.success) throw createValidationError('amount', 'Enter a total between €0.50 and €999,999.99, with at most two decimals.')
  const limit = await rateLimitEnhanced(`service-agreements:${user.id}`, 30, 60 * 60 * 1000, { failClosed: true, burstLimit: 8, burstWindowMs: 60000 })
  if (!limit.allowed) return NextResponse.json({ error: 'Too many agreement changes. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter || 60) } })
  const { data: me, error: profileError } = await supabaseAdmin.from('profiles').select('id').eq('user_id', user.id).single()
  if (profileError || !me) throw ErrorFactory.businessLogic('Profile not found')
  const { listingId, chatId } = input.data
  const { data: listing, error: listingError } = await supabaseAdmin.from('listings')
    .select('id,seller_id,title,description,price,main_category,sub_category').eq('id', listingId).eq('status', 'active').single()
  if (listingError || !listing) throw createValidationError('listingId', 'Listing not found or unavailable')
  await resolveTradeParties(listing, me.id, chatId)
  if (!serviceAgreementEligible(listing)) throw createValidationError('listingId', 'Agreed totals are available for services charged per unit.')
  const args = input.data.action === 'propose'
    ? { p_listing_id: listingId, p_chat_id: chatId, p_actor_id: me.id, p_amount: input.data.amount, p_expected_agreement_id: input.data.expectedAgreementId }
    : { p_agreement_id: input.data.agreementId, p_actor_id: me.id, p_action: input.data.action }
  // Bound every response to the requested conversation before invoking the atomic RPC.
  if (input.data.action !== 'propose') {
    const { data: agreement, error: readError } = await supabaseAdmin.from('service_price_agreements').select('id,buyer_id')
      .eq('id', input.data.agreementId).eq('chat_id', chatId).eq('listing_id', listingId).maybeSingle()
    if (readError) throw ErrorFactory.database('Could not load service agreement')
    if (!agreement) throw createValidationError('agreementId', AGREEMENT_CHANGED)
    if (input.data.action === 'reconcile') {
      const { data: payment, error: paymentError } = await supabaseAdmin.from('payments').select('stripe_payment_intent')
        .eq('agreement_id', agreement.id).eq('buyer_id', agreement.buyer_id).is('stripe_canceled_at', null)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (paymentError) throw ErrorFactory.database('Could not load agreement payment')
      if (payment?.stripe_payment_intent) {
        const intent = await stripe.paymentIntents.retrieve(payment.stripe_payment_intent)
        if (intent.status === 'canceled') {
          const { error: retirementError } = await supabaseAdmin.rpc('retire_service_agreement_payment', {
            p_agreement_id: agreement.id, p_buyer_id: agreement.buyer_id, p_intent_id: intent.id,
          })
          if (retirementError) throw ErrorFactory.database('Canceled payment could not be reconciled')
        }
      }
      return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } })
    }
  }
  const { error: mutationError } = await supabaseAdmin.rpc(input.data.action === 'propose' ? 'propose_service_price_agreement' : 'respond_service_price_agreement', args)
  if (mutationError) {
    if (mutationError.code === 'P0001' || mutationError.code?.startsWith('23') || mutationError.code === '42501') {
      return NextResponse.json({ error: AGREEMENT_CHANGED }, { status: 409 })
    }
    throw ErrorFactory.database('Agreement action could not be saved', { userMessage: 'The agreement could not be saved. Refresh the conversation and try again.' })
  }
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } })
})
