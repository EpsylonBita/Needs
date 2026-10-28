import { supabase } from '@/lib/supabase/client'
import { DEMO_TRANSACTION_ERROR, isDemoListing } from '@/lib/listings/demo-policy'

export type ChatParticipant = { profile_id: string; display_name: string | null; avatar_url: string | null; left_at: string | null }
export type ChatMessage = {
  id: string; chat_id: string; sender_id: string; content: string | null; attachments?: unknown
  reply_to?: string | null; created_at: string; sequence: number; client_message_id?: string | null
}
export type ChatItem = {
  chat_id: string
  chats: { id: string; title: string | null; type: string; listing_id: string | null; created_at: string }
  participants: ChatParticipant[]
  last_message: ChatMessage | null
  unread_count: number
  last_read_at: string | null
  left_at: string | null
  can_send: boolean
  other_left: boolean
}
export type InboxData = { userId: string; profileId: string; chats: ChatItem[] }
export type MessagePage = { userId: string; chatId: string; rows: ChatMessage[]; nextCursor: number | null }
export type ChatReadResult = { chat_id: string; last_read_at: string | null; last_read_message_id: string | null; unread_count: number }
export type ChatMembershipResult = { chat_id: string; left_at: string | null }
export const MESSAGE_PAGE_SIZE = 50
export const MESSAGE_MAX_LENGTH = 4000

type InboxRow = Omit<ChatItem, 'chats'> & ChatItem['chats']

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(typeof error === 'object' && error && 'message' in error ? String(error.message) : 'Chat request failed')
}

async function requireUser(expectedUserId?: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const { data, error } = await supabase.auth.getUser()
  signal?.throwIfAborted()
  if (error) throw asError(error)
  if (!data.user) throw new Error('Sign in to use chat')
  if (expectedUserId && data.user.id !== expectedUserId) throw new Error('Your session changed. Please try again.')
  return data.user
}

/** Every new RPC checks this identity in the database, as well as on both sides of the await. */
async function scopedRpc(name: string, parameters: Record<string, unknown>, expectedUserId: string, signal?: AbortSignal) {
  await requireUser(expectedUserId, signal)
  let request = supabase.rpc(name, { ...parameters, p_expected_user_id: expectedUserId })
  if (signal) request = request.abortSignal(signal)
  const { data, error } = await request
  await requireUser(expectedUserId, signal)
  if (error) throw asError(error)
  return data as unknown
}

export async function getInbox(expectedUserId: string, signal: AbortSignal): Promise<InboxData> {
  await requireUser(expectedUserId, signal)
  const profile = await supabase.from('profiles').select('id').eq('user_id', expectedUserId).abortSignal(signal).maybeSingle()
  await requireUser(expectedUserId, signal)
  if (profile.error) throw asError(profile.error)
  if (!profile.data?.id) throw new Error('Complete your profile before using chat')
  const data = await scopedRpc('get_my_chats', {}, expectedUserId, signal)
  if (!Array.isArray(data)) throw new Error('Conversations could not be loaded')
  const chats = (data as InboxRow[]).map(row => ({
    chat_id: row.chat_id,
    chats: { id: row.chat_id, title: row.title, type: row.type, listing_id: row.listing_id, created_at: row.created_at },
    participants: row.participants,
    last_message: row.last_message,
    unread_count: Number(row.unread_count),
    last_read_at: row.last_read_at, left_at: row.left_at, can_send: row.can_send, other_left: row.other_left,
  }))
  if (chats.some(chat => !chat.chat_id || !Array.isArray(chat.participants) || !Number.isSafeInteger(chat.unread_count) || chat.unread_count < 0)) {
    throw new Error('Conversations could not be loaded')
  }
  return { userId: expectedUserId, profileId: profile.data.id, chats }
}

/** The server's per-chat sequence also defines the exact mark-read watermark. */
export async function getMessagePage(expectedUserId: string, chatId: string, signal: AbortSignal, beforeSequence: number | null = null): Promise<MessagePage> {
  if (!chatId || (beforeSequence !== null && (!Number.isSafeInteger(beforeSequence) || beforeSequence <= 0))) throw new Error('Invalid conversation cursor')
  const data = await scopedRpc('get_chat_messages', { p_chat_id: chatId, p_before_sequence: beforeSequence, p_limit: MESSAGE_PAGE_SIZE + 1 }, expectedUserId, signal)
  if (!Array.isArray(data)) throw new Error('Messages could not be loaded')
  const rows = (data as ChatMessage[]).slice(0, MESSAGE_PAGE_SIZE).map(row => ({ ...row, sequence: Number(row.sequence) }))
  if (rows.some(row => row.chat_id !== chatId || !Number.isSafeInteger(row.sequence) || row.sequence <= 0)) throw new Error('Messages could not be loaded')
  return { userId: expectedUserId, chatId, rows, nextCursor: data.length > MESSAGE_PAGE_SIZE ? rows.at(-1)!.sequence : null }
}

// Keep existing callers compatible while routing them through the same authorized operations.
export async function listChats(expectedUserId?: string): Promise<ChatItem[]> {
  const user = await requireUser(expectedUserId)
  return (await getInbox(user.id, new AbortController().signal)).chats
}

export async function listMessages(chatId: string, expectedUserId?: string): Promise<ChatMessage[]> {
  const user = await requireUser(expectedUserId)
  return (await getMessagePage(user.id, chatId, new AbortController().signal)).rows.slice().reverse()
}

export async function sendMessage(chatId: string, content: string, expectedUserId?: string, clientMessageId = crypto.randomUUID()): Promise<ChatMessage> {
  const text = content.trim()
  if (!chatId || !text) throw new Error('A conversation and message are required')
  if (Array.from(text).length > MESSAGE_MAX_LENGTH) throw new Error('Messages must be at most 4000 characters')
  const user = await requireUser(expectedUserId)
  const data = await scopedRpc('send_chat_message', { p_chat_id: chatId, p_content: text, p_client_message_id: clientMessageId }, user.id)
  if (!data || typeof data !== 'object' || !('id' in data) || !('chat_id' in data) || data.chat_id !== chatId) throw new Error('The message could not be sent')
  return data as ChatMessage
}

export async function markChatRead(expectedUserId: string, chatId: string, messageId: string): Promise<ChatReadResult> {
  const data = await scopedRpc('mark_chat_read', { p_chat_id: chatId, p_message_id: messageId }, expectedUserId) as ChatReadResult | null
  if (!data || data.chat_id !== chatId || !Number.isSafeInteger(Number(data.unread_count)) || Number(data.unread_count) < 0) throw new Error('Messages could not be marked as read')
  return { ...data, unread_count: Number(data.unread_count) }
}

async function updateMembership(name: 'leave_chat' | 'rejoin_chat', expectedUserId: string, chatId: string): Promise<ChatMembershipResult> {
  const data = await scopedRpc(name, { p_chat_id: chatId }, expectedUserId) as ChatMembershipResult | null
  if (!data || data.chat_id !== chatId || (name === 'leave_chat' ? !data.left_at : data.left_at !== null)) throw new Error('Conversation membership could not be updated')
  return data
}
export const leaveChat = (expectedUserId: string, chatId: string) => updateMembership('leave_chat', expectedUserId, chatId)
export const rejoinChat = (expectedUserId: string, chatId: string) => updateMembership('rejoin_chat', expectedUserId, chatId)

async function openChat(parameters: { p_listing_id?: string; p_other_profile_id?: string }, expectedUserId?: string, signal?: AbortSignal) {
  if (isDemoListing(parameters.p_listing_id)) throw new Error(DEMO_TRANSACTION_ERROR)
  const user = await requireUser(expectedUserId, signal)
  // The three-argument overload rejects an account switch before creating anything.
  const result = await scopedRpc('get_or_create_direct_chat', {
    p_listing_id: parameters.p_listing_id ?? null,
    p_other_profile_id: parameters.p_other_profile_id ?? null,
  }, user.id, signal)
  if (typeof result !== 'string' || !result) throw new Error('The conversation could not be opened')
  return result
}
export function getOrCreateListingChat(listingId: string, expectedUserId?: string, signal?: AbortSignal) {
  return openChat({ p_listing_id: listingId }, expectedUserId, signal)
}
export function createDirectChat(otherProfileId: string, expectedUserId?: string, signal?: AbortSignal) {
  return openChat({ p_other_profile_id: otherProfileId }, expectedUserId, signal)
}
