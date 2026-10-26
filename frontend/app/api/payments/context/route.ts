import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/server'
import { resolveTradeParties } from '@/lib/payments/transaction-context'
import { withApiErrorHandler, ErrorFactory, createValidationError } from '@/lib/utils/error-handler'

export const dynamic = 'force-dynamic'

export const GET = withApiErrorHandler(async (request: NextRequest) => {
  const auth = request.headers.get('authorization') || ''
  if (!auth.startsWith('Bearer ')) throw ErrorFactory.authentication('Authentication required')
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(auth.slice(7))
  if (error || !user) throw ErrorFactory.authentication('Invalid authentication')
  const input = z.object({ listingId: z.string().uuid(), chatId: z.string().uuid() }).safeParse({
    listingId: request.nextUrl.searchParams.get('listingId'), chatId: request.nextUrl.searchParams.get('chatId'),
  })
  if (!input.success) throw createValidationError('chatId', 'Choose a listing conversation')
  const { data: me, error: profileError } = await supabaseAdmin.from('profiles').select('id').eq('user_id', user.id).single()
  if (profileError || !me) throw ErrorFactory.businessLogic('Profile not found')
  const { data: listing, error: listingError } = await supabaseAdmin.from('listings')
    .select('id,seller_id,title,price,main_category,sub_category').eq('id', input.data.listingId).eq('status', 'active').single()
  if (listingError || !listing) throw ErrorFactory.businessLogic('Listing not found or unavailable')
  const parties = await resolveTradeParties(listing, me.id, input.data.chatId)
  const { data: seller, error: sellerError } = await supabaseAdmin.from('profiles').select('stripe_account_id').eq('id', parties.sellerId).single()
  if (sellerError || !seller) throw ErrorFactory.database('Could not load the provider')
  const { data: paymentFlag, error: paymentFlagError } = await supabaseAdmin.from('feature_flags').select('enabled').eq('key', 'payments_enabled').single()
  const { data: milestoneFlag, error: milestoneFlagError } = await supabaseAdmin.from('feature_flags').select('enabled').eq('key', 'milestones_enabled').single()
  return NextResponse.json({
    listingId: listing.id, chatId: parties.chatId, buyerId: parties.buyerId, sellerId: parties.sellerId,
    currentProfileId: me.id, isFree: parties.isFree, canPay: !parties.isFree && parties.buyerId === me.id,
    sellerOnboarded: !!seller.stripe_account_id,
    paymentsEnabled: (process.env.NEXT_PUBLIC_PAYMENTS_ENABLED || '').toLowerCase() === 'true' || (!paymentFlagError && !!paymentFlag?.enabled),
    milestonesEnabled: !milestoneFlagError && !!milestoneFlag?.enabled,
    title: listing.title, amount: Number(listing.price), subCategory: listing.sub_category,
  }, { headers: { 'Cache-Control': 'private, no-store' } })
})
