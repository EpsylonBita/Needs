import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_LISTING_IDS, DEMO_PROJECT_ID } from '@/lib/listings/demo-policy'

const boundary = vi.hoisted(() => ({ user: { id: 'auth-user' } as { id: string } | null, rpc: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: boundary.user }, error: null }) },
  rpc: (...args: unknown[]) => Object.assign(boundary.rpc(...args), { abortSignal() { return this } }),
  from: boundary.from,
} }))

import { createDirectChat, getOrCreateListingChat, getInbox, getMessagePage, sendMessage, markChatRead, leaveChat, rejoinChat } from '@/lib/services/chat-service'

beforeEach(() => {
  boundary.user = { id: 'auth-user' }
  boundary.rpc.mockReset().mockResolvedValue({ data: 'target-chat', error: null })
  boundary.from.mockReset()
  boundary.from.mockImplementation(() => {
    const query = { select: () => query, eq: () => query, abortSignal: () => query, maybeSingle: async () => ({ data: { id: 'profile-one' }, error: null }) }
    return query
  })
})

const signal = () => new AbortController().signal
afterEach(() => vi.unstubAllEnvs())
const message = (sequence = 1) => ({ id: `message-${sequence}`, chat_id: 'chat-one', sender_id: 'profile-other', content: 'Hello', created_at: '2026-10-19T12:00:00Z', sequence })

describe('authenticated inbox persistence', () => {
  it('returns actual participant, unread and last-message data, including left history', async () => {
    boundary.rpc.mockResolvedValue({ data: [{ chat_id: 'chat-one', title: null, type: 'direct', listing_id: null, created_at: '2026-10-19T11:00:00Z', participants: [{ profile_id: 'profile-other', display_name: 'Maria', avatar_url: null, left_at: null }], last_message: message(), unread_count: 3, last_read_at: null, left_at: '2026-10-19T11:30:00Z', can_send: false, other_left: false }], error: null })
    const inbox = await getInbox('auth-user', signal())
    expect(inbox).toMatchObject({ userId: 'auth-user', profileId: 'profile-one', chats: [{ chat_id: 'chat-one', chats: { id: 'chat-one' }, participants: [{ display_name: 'Maria' }], unread_count: 3, can_send: false, left_at: '2026-10-19T11:30:00Z' }] })
    expect(boundary.rpc).toHaveBeenCalledWith('get_my_chats', { p_expected_user_id: 'auth-user' })
  })

  it('rejects account changes both before a request and after its delayed response', async () => {
    await expect(getInbox('other-account', signal())).rejects.toThrow(/session changed/i)
    expect(boundary.rpc).not.toHaveBeenCalled()
    boundary.rpc.mockImplementation(async () => { boundary.user = { id: 'other-account' }; return { data: [], error: null } })
    await expect(getInbox('auth-user', signal())).rejects.toThrow(/session changed/i)
  })

  it('uses a bounded descending sequence cursor without losing messages sharing a timestamp', async () => {
    boundary.rpc.mockResolvedValue({ data: Array.from({ length: 51 }, (_, i) => message(100 - i)), error: null })
    const page = await getMessagePage('auth-user', 'chat-one', signal(), 101)
    expect(page.rows).toHaveLength(50)
    expect(page.rows[0].sequence).toBe(100)
    expect(page.nextCursor).toBe(51)
    expect(boundary.rpc).toHaveBeenCalledWith('get_chat_messages', { p_chat_id: 'chat-one', p_before_sequence: 101, p_limit: 51, p_expected_user_id: 'auth-user' })
    await expect(getMessagePage('auth-user', 'chat-one', signal(), NaN)).rejects.toThrow()
  })

  it('sends trimmed text with the supplied retry nonce and expected identity; invalid text never writes', async () => {
    boundary.rpc.mockResolvedValue({ data: message(), error: null })
    await sendMessage('chat-one', '  Hello  ', 'auth-user', 'nonce-one')
    expect(boundary.rpc).toHaveBeenCalledWith('send_chat_message', { p_chat_id: 'chat-one', p_content: 'Hello', p_client_message_id: 'nonce-one', p_expected_user_id: 'auth-user' })
    boundary.rpc.mockClear()
    await expect(sendMessage('chat-one', ' ', 'auth-user')).rejects.toThrow()
    await expect(sendMessage('chat-one', 'x'.repeat(4001), 'auth-user')).rejects.toThrow(/4000/)
    expect(boundary.rpc).not.toHaveBeenCalled()
  })

  it('marks only the submitted visible message and uses dedicated leave/rejoin operations', async () => {
    boundary.rpc.mockResolvedValueOnce({ data: { chat_id: 'chat-one', last_read_message_id: 'message-7', last_read_at: '2026-10-19T12:00:00Z', unread_count: 2 }, error: null })
      .mockResolvedValueOnce({ data: { chat_id: 'chat-one', left_at: '2026-10-19T12:00:00Z' }, error: null })
      .mockResolvedValueOnce({ data: { chat_id: 'chat-one', left_at: null }, error: null })
    await expect(markChatRead('auth-user', 'chat-one', 'message-7')).resolves.toMatchObject({ unread_count: 2 })
    await leaveChat('auth-user', 'chat-one')
    await rejoinChat('auth-user', 'chat-one')
    expect(boundary.rpc.mock.calls.map(call => call[0])).toEqual(['mark_chat_read', 'leave_chat', 'rejoin_chat'])
    expect(boundary.rpc).toHaveBeenCalledWith('mark_chat_read', { p_chat_id: 'chat-one', p_message_id: 'message-7', p_expected_user_id: 'auth-user' })
  })

  it('preserves database failures and cancellation instead of claiming empty data or successful writes', async () => {
    boundary.rpc.mockResolvedValue({ data: null, error: { message: 'Unavailable' } })
    await expect(getInbox('auth-user', signal())).rejects.toThrow('Unavailable')
    await expect(leaveChat('auth-user', 'chat-one')).rejects.toThrow('Unavailable')
    const aborted = new AbortController(); aborted.abort()
    boundary.rpc.mockClear()
    await expect(getMessagePage('auth-user', 'chat-one', aborted.signal)).rejects.toThrow()
    expect(boundary.rpc).not.toHaveBeenCalled()
  })
})

describe('starting a conversation', () => {
  it('rejects a verified demo before creating a conversation, while unrelated records stay usable', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', `https://${DEMO_PROJECT_ID}.supabase.co`)
    await expect(getOrCreateListingChat(DEMO_LISTING_IDS[0])).rejects.toThrow('not available for transactions')
    expect(boundary.rpc).not.toHaveBeenCalled()
    await expect(getOrCreateListingChat('real-listing-same-owner')).resolves.toBe('target-chat')
  })
  it('returns the authenticated listing conversation through the atomic RPC', async () => {
    await expect(getOrCreateListingChat('listing-id')).resolves.toBe('target-chat')
    expect(boundary.rpc).toHaveBeenCalledWith('get_or_create_direct_chat', { p_listing_id: 'listing-id', p_other_profile_id: null, p_expected_user_id: 'auth-user' })
    expect(boundary.from).not.toHaveBeenCalled()
  })

  it('does not start a chat when the user is signed out', async () => {
    boundary.user = null
    await expect(getOrCreateListingChat('listing-id')).rejects.toThrow(/sign in|authenticated/i)
    expect(boundary.rpc).not.toHaveBeenCalled()
  })

  it('propagates an authorization rejection without creating orphan chat rows', async () => {
    boundary.rpc.mockResolvedValue({ data: null, error: { message: 'You cannot contact yourself' } })
    await expect(createDirectChat('self-profile')).rejects.toThrow('You cannot contact yourself')
    expect(boundary.from).not.toHaveBeenCalled()
  })
})
