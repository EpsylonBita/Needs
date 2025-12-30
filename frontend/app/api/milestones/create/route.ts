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
    const { listingId, title, amount } = body as { listingId: string; title: string; amount: string | number }
    if (!listingId) throw createValidationError('listingId', 'listingId is required')
    if (!title) throw createValidationError('title', 'title is required')
    if (!amount) throw createValidationError('amount', 'amount is required')
    const flag = await supabaseAdmin.from('feature_flags').select('enabled').eq('key','milestones_enabled').limit(1).single()
    if (flag.data?.enabled === false) throw ErrorFactory.authorization('feature_disabled')
    const { data: me } = await supabaseAdmin.from('profiles').select('id').eq('user_id', user.id).limit(1).single()
    const buyerId = me?.id
    if (!buyerId) throw ErrorFactory.businessLogic('profile_not_found')
    const { data: listing } = await supabaseAdmin.from('listings').select('id,seller_id').eq('id', listingId).limit(1).single()
    if (!listing?.seller_id) throw ErrorFactory.businessLogic('listing_not_found')
    const amt = typeof amount === 'string' ? Number(String(amount).replace(/[^0-9.]/g,'')) : Number(amount)
    const { data, error } = await supabaseAdmin
      .from('milestones')
      .insert({ listing_id: listingId, buyer_id: buyerId, seller_id: listing.seller_id, title, amount: amt })
      .select('id')
      .single()
    if (error) throw ErrorFactory.database(error.message)
    return NextResponse.json({ success: true, id: data?.id })
  } catch (e: any) {
    throw e
  }
})
