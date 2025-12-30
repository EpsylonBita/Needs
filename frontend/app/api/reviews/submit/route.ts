import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { withApiErrorHandler, ErrorFactory, createValidationError } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic'

export const POST = withApiErrorHandler(async (request: NextRequest) => {
  try {
    const auth = request.headers.get('authorization') || request.headers.get('Authorization') || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!token) throw ErrorFactory.authentication('missing_token')
    const u = await supabaseAdmin.auth.getUser(token)
    const user = u.data.user
    if (!user) throw ErrorFactory.authentication('invalid_token')

    const body = await request.json()
    const { listingId, rating, comment } = body as { listingId: string; rating: number; comment?: string }
    if (!listingId) throw createValidationError('listingId', 'listingId is required')
    if (!rating || rating < 1 || rating > 5) throw createValidationError('rating', 'rating must be 1..5')

    const { data: profile } = await supabaseAdmin.from('profiles').select('id').eq('user_id', user.id).limit(1).single()
    const reviewerId = profile?.id
    if (!reviewerId) throw ErrorFactory.businessLogic('profile_not_found')

    const { data: listing } = await supabaseAdmin.from('listings').select('id, seller_id').eq('id', listingId).limit(1).single()
    if (!listing?.id) throw ErrorFactory.businessLogic('listing_not_found')

    const { data: payment } = await supabaseAdmin
      .from('payments')
      .select('id')
      .eq('listing_id', listingId)
      .eq('buyer_id', reviewerId)
      .eq('status', 'completed')
      .limit(1)
      .single()
    if (!payment?.id) throw ErrorFactory.authorization('not_eligible')

    const { error } = await supabaseAdmin
      .from('reviews')
      .insert({ listing_id: listingId, seller_id: listing.seller_id, reviewer_id: reviewerId, rating, comment: comment || '' })
    if (error) throw ErrorFactory.database(error.message)
    return NextResponse.json({ success: true })
  } catch (e: any) {
    throw e
  }
})
