import { supabase } from '@/lib/supabase/client'

export type NotificationRow = { id: string; type: string; payload: unknown; read: boolean; created_at: string }
export type NotificationCursor = { createdAt: string; id: string }
export type NotificationPage = { userId: string; profileId: string; rows: NotificationRow[]; nextCursor: NotificationCursor | null }
export const NOTIFICATION_PAGE_SIZE = 20
const columns = 'id,type,payload,read,created_at'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/

async function currentProfile(expectedUserId: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const auth = await supabase.auth.getUser()
  signal?.throwIfAborted()
  if (auth.error || !auth.data.user || auth.data.user.id !== expectedUserId) throw new Error('Your session changed. Please try again.')
  let query = supabase.from('profiles').select('id').eq('user_id', expectedUserId)
  if (signal) query = query.abortSignal(signal)
  const profile = await query.maybeSingle()
  signal?.throwIfAborted()
  if (profile.error || !profile.data?.id) throw new Error('Your profile could not be loaded.')
  return profile.data.id as string
}

/** The timestamp/id cursor remains stable when newer notifications arrive. */
export async function getNotifications(expectedUserId: string, signal: AbortSignal, cursor: NotificationCursor | null = null): Promise<NotificationPage> {
  if (cursor && (!uuid.test(cursor.id) || !timestamp.test(cursor.createdAt) || !Number.isFinite(Date.parse(cursor.createdAt)))) {
    throw new Error('Notifications could not be loaded.')
  }
  const profileId = await currentProfile(expectedUserId, signal)
  let query = supabase.from('notifications').select(columns).eq('user_id', profileId)
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .limit(NOTIFICATION_PAGE_SIZE + 1).abortSignal(signal)
  if (cursor) query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`)
  const result = await query
  signal.throwIfAborted()
  if (result.error || !Array.isArray(result.data)) throw new Error('Notifications could not be loaded.')
  const rows = (result.data as NotificationRow[]).slice(0, NOTIFICATION_PAGE_SIZE)
  const last = rows.at(-1)
  return {
    userId: expectedUserId, profileId, rows,
    nextCursor: result.data.length > NOTIFICATION_PAGE_SIZE && last ? { createdAt: last.created_at, id: last.id } : null,
  }
}

export async function markNotificationRead(expectedUserId: string, id: string): Promise<NotificationRow> {
  if (!uuid.test(id)) throw new Error('Notification could not be updated.')
  const profileId = await currentProfile(expectedUserId)
  const result = await supabase.from('notifications').update({ read: true })
    .eq('id', id).eq('user_id', profileId).select(columns).maybeSingle()
  if (result.error || !result.data || result.data.read !== true) throw new Error('Notification could not be updated.')
  return result.data as NotificationRow
}

export async function getUnreadNotificationCount(expectedUserId: string, signal: AbortSignal) {
  const profileId = await currentProfile(expectedUserId, signal)
  const result = await supabase.from('notifications').select('id', { count: 'exact', head: true })
    .eq('user_id', profileId).eq('read', false).abortSignal(signal)
  signal.throwIfAborted()
  if (result.error || result.count === null || !Number.isSafeInteger(result.count) || result.count < 0) {
    throw new Error('Notification count could not be loaded.')
  }
  return { userId: expectedUserId, profileId, count: result.count }
}
