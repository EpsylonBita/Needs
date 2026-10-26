import { supabaseAdmin } from '@/lib/supabase/server'
import { ErrorFactory, createValidationError } from '@/lib/utils/error-handler'

export type TradeListing = {
  id: string
  seller_id: string
  main_category: string
  sub_category: string
  price: number | string | null
}

/** seller_id on a listing is its publisher; payment seller_id is the provider. */
export async function resolveTradeParties(listing: TradeListing, actorId: string, chatId?: string | null) {
  const isRequest = (listing.main_category === 'Items' && listing.sub_category === 'Buy')
    || (listing.main_category === 'Services' && listing.sub_category === 'I want')
  const valid = listing.main_category === 'Items'
    ? ['Buy', 'Sell', 'Free'].includes(listing.sub_category)
    : listing.main_category === 'Services' && ['I want', 'I will', 'I can'].includes(listing.sub_category)
  if (!valid) throw createValidationError('listingId', 'This listing has an invalid transaction category')
  const isFree = listing.sub_category === 'Free' || Number(listing.price) <= 0
  let otherId = actorId
  if (chatId) {
    const { data: chat, error: chatError } = await supabaseAdmin.from('chats')
      .select('id,listing_id,type').eq('id', chatId).single()
    if (chatError || !chat || chat.listing_id !== listing.id || chat.type !== 'direct') {
      throw ErrorFactory.authorization('Choose a conversation for this listing')
    }
    const { data: members, error } = await supabaseAdmin.from('chat_participants')
      .select('user_id,left_at').eq('chat_id', chatId)
    const ids = new Set<string>((members || []).filter((member: { left_at?: string | null }) => !member.left_at).map((member: { user_id: string }) => member.user_id))
    if (error || ids.size !== 2 || members?.some((member: { left_at?: string | null }) => !!member.left_at) || !ids.has(actorId) || !ids.has(listing.seller_id)) {
      throw ErrorFactory.authorization('You cannot use this conversation for a transaction')
    }
    otherId = [...ids].find(id => id !== listing.seller_id)!
  } else if (isRequest) {
    throw createValidationError('chatId', 'Choose the provider conversation before paying for your request')
  } else if (actorId === listing.seller_id) {
    throw createValidationError('listingId', 'Cannot purchase your own listing')
  }
  return {
    buyerId: isRequest ? listing.seller_id : otherId,
    sellerId: isRequest ? otherId : listing.seller_id,
    chatId: chatId || null,
    isRequest,
    isFree,
  }
}

export function requirePayer(parties: Awaited<ReturnType<typeof resolveTradeParties>>, actorId: string) {
  if (parties.isFree) throw createValidationError('listingId', 'This listing does not require a payment')
  if (parties.buyerId !== actorId) throw ErrorFactory.authorization('Only the buyer can pay for this agreement')
}
