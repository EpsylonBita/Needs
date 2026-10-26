import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/server'
import { withApiErrorHandler, ErrorFactory, createValidationError } from '@/lib/utils/error-handler'
import { assertOrderUser } from '@/lib/orders/server'

export const dynamic = 'force-dynamic'

const reviewSchema = z.object({
  expectedUserId: z.string().uuid().optional(),
  paymentId: z.string().uuid().optional(),
  listingId: z.string().uuid().optional(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(4000).optional(),
}).refine(value => !!value.paymentId || !!value.listingId, { message: 'Choose a completed payment to review' })

export const POST = withApiErrorHandler(async (request: NextRequest) => {
  const auth = request.headers.get('authorization') || request.headers.get('Authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) throw ErrorFactory.authentication('missing_token')
  const u = await supabaseAdmin.auth.getUser(token)
  const user = u.data.user
  if (u.error || !user) throw ErrorFactory.authentication('invalid_token')

  const validation = reviewSchema.safeParse(await request.json().catch(() => null))
  if (!validation.success) throw createValidationError('review', 'Choose a payment and an integer rating from 1 to 5; comments may contain up to 4000 characters')
  assertOrderUser(validation.data.expectedUserId, user.id)
  const { paymentId, listingId, rating, comment } = validation.data

  const { data: profile, error: profileError } = await supabaseAdmin.from('profiles').select('id').eq('user_id', user.id).maybeSingle()
  if (profileError) throw ErrorFactory.database('Could not load your profile')
  const reviewerId = profile?.id
  if (!reviewerId) throw ErrorFactory.businessLogic('profile_not_found')

  let eligible = supabaseAdmin
    .from('payments')
    .select('id, listing_id')
    .eq('buyer_id', reviewerId)
    .eq('status', 'completed')
  if (paymentId) eligible = eligible.eq('id', paymentId)
  if (listingId) eligible = eligible.eq('listing_id', listingId)
  const { data: payments, error: paymentError } = await eligible.limit(2)
  if (paymentError) throw ErrorFactory.database('Could not load eligible payments')
  if (!payments?.length) throw ErrorFactory.authorization('not_eligible', { userMessage: 'Only the payer can review a completed payment.' })
  // Old clients may identify a listing. Do not silently choose a provider or a
  // milestone when that listing has more than one eligible transaction.
  if (payments.length !== 1) return NextResponse.json({ error: 'Choose the specific completed payment to review.', code: 'AMBIGUOUS_PAYMENT' }, { status: 409 })

  const { data: reviewId, error } = await supabaseAdmin.rpc('submit_payment_review', {
    p_payment_id: payments[0].id, p_reviewer_id: reviewerId, p_rating: rating, p_comment: comment || '',
  })
  if (error?.code === '23505') return NextResponse.json({ error: 'You have already reviewed this payment.', code: 'REVIEW_EXISTS' }, { status: 409 })
  if (error?.code === '42501') throw ErrorFactory.authorization('not_eligible', { userMessage: 'This payment is no longer eligible for a review.' })
  if (error?.code === '22023') throw createValidationError('review', error.message)
  if (error || !reviewId) throw ErrorFactory.database('Could not save your review')
  return NextResponse.json({ success: true, reviewId })
})
