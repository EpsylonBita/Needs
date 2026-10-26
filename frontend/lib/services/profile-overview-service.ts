import { supabase } from '@/lib/supabase/client'

export type OverviewListing = {
  id: string; title: string; price: number; status: string; moderation_suspended: boolean
}
export type OverviewReview = { id: string; rating: number; comment: string | null; created_at: string }
export type ProfileOverview = {
  userId: string
  activeListings: number
  conversations: number
  receivedReviews: number
  unreadNotifications: number
  listings: OverviewListing[]
  reviews: OverviewReview[]
}

/** Resolve auth identity first; never accept a caller-supplied profile ID. */
export async function getProfileOverview(expectedUserId: string, signal: AbortSignal): Promise<ProfileOverview> {
  const auth = await supabase.auth.getUser()
  signal.throwIfAborted()
  if (auth.error || !auth.data.user || auth.data.user.id !== expectedUserId) throw new Error('Your session changed. Please try again.')
  const profile = await supabase.from('profiles').select('id').eq('user_id', expectedUserId).abortSignal(signal).maybeSingle()
  if (profile.error || !profile.data?.id) throw new Error('Your profile could not be loaded.')
  const profileId = profile.data.id as string
  const [listings, chats, reviews, notifications, recentListings, recentReviews] = await Promise.all([
    supabase.from('listings').select('id', { count: 'exact', head: true }).eq('seller_id', profileId).eq('status', 'active').abortSignal(signal),
    supabase.from('chat_participants').select('chat_id', { count: 'exact', head: true }).eq('user_id', profileId).abortSignal(signal),
    supabase.from('reviews').select('id', { count: 'exact', head: true }).eq('seller_id', profileId).abortSignal(signal),
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', profileId).eq('read', false).abortSignal(signal),
    supabase.from('listings').select('id,title,price,status,moderation_suspended').eq('seller_id', profileId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(5).abortSignal(signal),
    supabase.from('reviews').select('id,rating,comment,created_at').eq('seller_id', profileId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(5).abortSignal(signal),
  ])
  signal.throwIfAborted()
  function count(result: { count: number | null; error: unknown }) {
    if (result.error || result.count === null || !Number.isSafeInteger(result.count) || result.count < 0) throw new Error('Your activity could not be loaded.')
    return result.count
  }
  if (recentListings.error || recentReviews.error || !Array.isArray(recentListings.data) || !Array.isArray(recentReviews.data)) {
    throw new Error('Your recent activity could not be loaded.')
  }
  return {
    userId: expectedUserId,
    activeListings: count(listings), conversations: count(chats), receivedReviews: count(reviews), unreadNotifications: count(notifications),
    listings: recentListings.data as OverviewListing[], reviews: recentReviews.data as OverviewReview[],
  }
}
