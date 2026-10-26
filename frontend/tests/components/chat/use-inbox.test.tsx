import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useInbox } from '@/lib/chat/use-inbox'
import type { ChatItem, ChatMessage, InboxData, MessagePage } from '@/lib/services/chat-service'

const state = vi.hoisted(() => ({
  userId: 'one' as string | null, getInbox: vi.fn(), getMessages: vi.fn(), open: vi.fn(), send: vi.fn(), leave: vi.fn(), rejoin: vi.fn(), read: vi.fn(), remove: vi.fn(),
  events: [] as { table: string; filter?: string; callback: () => void }[],
}))
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: state.userId ? { id: state.userId } : null, isInitialized: true }) }))
vi.mock('@/lib/services/chat-service', () => ({ getInbox: state.getInbox, getMessagePage: state.getMessages, getOrCreateListingChat: state.open, sendMessage: state.send, leaveChat: state.leave, rejoinChat: state.rejoin, markChatRead: state.read }))
vi.mock('@/lib/supabase/client', () => ({ supabase: {
  channel: () => ({ on(_kind: string, options: { table: string; filter?: string }, callback: () => void) { state.events.push({ ...options, callback }); return this }, subscribe() { return this } }),
  removeChannel: state.remove,
} }))

const chat = (id: string, extra: Partial<ChatItem> = {}): ChatItem => ({ chat_id: id, chats: { id, type: 'direct', title: null, listing_id: null, created_at: '2026-10-19T12:00:00Z' }, participants: [{ profile_id: 'other', display_name: 'Maria', avatar_url: null, left_at: null }], last_message: null, unread_count: 2, last_read_at: null, left_at: null, can_send: true, other_left: false, ...extra })
const message = (chatId = 'alpha', sequence = 2): ChatMessage => ({ id: `${chatId}-${sequence}`, chat_id: chatId, sender_id: 'other', content: `${chatId} message ${sequence}`, created_at: '2026-10-19T12:00:00Z', sequence })
const inbox = (userId = 'one', chats = [chat('alpha'), chat('beta')]): InboxData => ({ userId, profileId: `profile-${userId}`, chats })
const page = (userId = 'one', chatId = 'alpha', rows = [message(chatId)], nextCursor: number | null = null): MessagePage => ({ userId, chatId, rows, nextCursor })
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }
const clients: QueryClient[] = []
function mount(initialProps: { requestedChatId?: string | null; requestedListingId?: string | null } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } })
  clients.push(client)
  const view = renderHook(props => useInbox(props), { initialProps, wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> })
  return { ...view, client }
}
beforeEach(() => {
  vi.clearAllMocks(); state.userId = 'one'; state.events = []
  state.getInbox.mockReset().mockImplementation(async (userId: string) => inbox(userId))
  state.getMessages.mockReset().mockImplementation(async (userId: string, chatId: string) => page(userId, chatId))
  state.open.mockReset().mockResolvedValue('beta')
  state.send.mockReset().mockResolvedValue(message())
  state.leave.mockReset().mockResolvedValue({ chat_id: 'alpha', left_at: '2026-10-19T13:00:00Z' })
  state.rejoin.mockReset().mockResolvedValue({ chat_id: 'alpha', left_at: null })
  state.read.mockReset().mockResolvedValue({ chat_id: 'alpha', last_read_at: '2026-10-19T12:00:00Z', last_read_message_id: 'alpha-2', unread_count: 0 })
})
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); focusManager.setFocused(undefined); vi.useRealTimers() })

describe('real inbox state and actions', () => {
  it('does not open a listing or load data while signed out', () => {
    state.userId = null
    const view = mount({ requestedListingId: 'listing-one' })
    expect(view.result.current.signedIn).toBe(false)
    expect(view.result.current.activeChatId).toBeNull()
    expect(state.getInbox).not.toHaveBeenCalled()
    expect(state.open).not.toHaveBeenCalled()
  })
  it('waits for explicit selection and opens exact chat or listing deep links', async () => {
    const view = mount()
    await waitFor(() => expect(view.result.current.chats).toHaveLength(2))
    expect(view.result.current.activeChat).toBeNull()
    expect(state.getMessages).not.toHaveBeenCalled()
    view.rerender({ requestedChatId: 'beta' })
    await waitFor(() => expect(view.result.current.messages[0]?.chat_id).toBe('beta'))
    act(() => view.result.current.selectChat(null))
    expect(view.result.current.activeChat).toBeNull()
    expect(view.result.current.messages).toEqual([])
    view.rerender({ requestedListingId: 'listing-one' })
    await waitFor(() => expect(view.result.current.activeChat?.chat_id).toBe('beta'))
    expect(state.open).toHaveBeenCalledWith('listing-one', 'one', expect.any(AbortSignal))
  })

  it('separates initial loading, failed list with retry, and actual empty data', async () => {
    const request = deferred<InboxData>()
    state.getInbox.mockReturnValueOnce(request.promise).mockResolvedValueOnce(inbox('one', []))
    const view = mount()
    expect(view.result.current.loading).toBe(true)
    await act(async () => request.reject(new Error('Offline')))
    await waitFor(() => expect(view.result.current.chatsError?.message).toBe('Offline'))
    expect(view.result.current.loading).toBe(false)
    await act(async () => view.result.current.refresh())
    await waitFor(() => expect(view.result.current.chatsError).toBeNull())
    expect(view.result.current.chats).toEqual([])
  })

  it('reopens a previously visited listing explicitly and refreshes its membership, without reopening on focus', async () => {
    const view = mount({ requestedListingId: 'listing-one' })
    await waitFor(() => expect(view.result.current.activeChat?.chat_id).toBe('beta'))
    await waitFor(() => expect(state.open).toHaveBeenCalledTimes(1))
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true) })
    expect(state.open).toHaveBeenCalledTimes(1)
    view.rerender({ requestedChatId: 'alpha' })
    await waitFor(() => expect(view.result.current.activeChat?.chat_id).toBe('alpha'))
    state.getInbox.mockResolvedValue(inbox('one', [chat('alpha'), chat('beta', { participants: [{ profile_id: 'other', display_name: 'Reopened member', avatar_url: null, left_at: null }] })]))
    view.rerender({ requestedListingId: 'listing-one' })
    await waitFor(() => expect(state.open).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(view.result.current.activeChat?.participants[0].display_name).toBe('Reopened member'))
  })

  it('isolates rapid conversation switches and ignores the late previous response', async () => {
    const delayed = deferred<MessagePage>()
    state.getMessages.mockImplementation((userId: string, chatId: string) => chatId === 'alpha' ? delayed.promise : Promise.resolve(page(userId, chatId)))
    const view = mount({ requestedChatId: 'alpha' })
    await waitFor(() => expect(state.getMessages).toHaveBeenCalledTimes(1))
    view.rerender({ requestedChatId: 'beta' })
    expect(view.result.current.messages).toEqual([])
    await waitFor(() => expect(view.result.current.messages[0]?.chat_id).toBe('beta'))
    await act(async () => delayed.resolve(page()))
    expect(view.result.current.messages.map(row => row.chat_id)).toEqual(['beta'])
  })

  it('hides old-account data immediately and disposes its realtime callbacks', async () => {
    const view = mount({ requestedChatId: 'alpha' })
    await waitFor(() => expect(view.result.current.messages).toHaveLength(1))
    const oldEvents = [...state.events]
    const delayed = deferred<InboxData>()
    state.getInbox.mockReturnValueOnce(delayed.promise)
    state.userId = 'two'; view.rerender({ requestedChatId: 'alpha' })
    expect(view.result.current.chats).toEqual([])
    expect(view.result.current.messages).toEqual([])
    expect(view.result.current.profileId).toBeUndefined()
    await act(async () => delayed.resolve(inbox('two', [chat('beta')])))
    await waitFor(() => expect(view.result.current.chats[0]?.chat_id).toBe('beta'))
    const calls = state.getInbox.mock.calls.length
    await act(async () => oldEvents.forEach(event => event.callback()))
    expect(state.getInbox).toHaveBeenCalledTimes(calls)
    expect(state.remove).toHaveBeenCalled()
  })

  it('loads older messages by cursor, deduplicates them and preserves history on load failure', async () => {
    state.getMessages.mockResolvedValueOnce(page('one', 'alpha', [message('alpha', 3), message('alpha', 2)], 2))
      .mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(page('one', 'alpha', [message('alpha', 2), message('alpha', 1)]))
    const view = mount({ requestedChatId: 'alpha' })
    await waitFor(() => expect(view.result.current.hasOlder).toBe(true))
    await act(async () => { await expect(view.result.current.loadOlder()).rejects.toThrow('Offline') })
    await waitFor(() => expect(view.result.current.messagesError?.message).toBe('Offline'))
    expect(view.result.current.messages.map(row => row.sequence)).toEqual([2, 3])
    await act(async () => view.result.current.loadOlder())
    await waitFor(() => expect(view.result.current.messages.map(row => row.sequence)).toEqual([1, 2, 3]))
    expect(state.getMessages).toHaveBeenLastCalledWith('one', 'alpha', expect.any(AbortSignal), 2)
  })

  it('reuses a nonce after uncertain failure, coalesces double submit and allows a new intentional message', async () => {
    const request = deferred<ChatMessage>()
    state.send.mockReturnValueOnce(request.promise).mockResolvedValue(message())
    const view = mount({ requestedChatId: 'alpha' })
    await waitFor(() => expect(view.result.current.activeChat).not.toBeNull())
    let first!: Promise<void>; let double!: Promise<void>
    act(() => { first = view.result.current.send(' Hello '); double = view.result.current.send(' Hello ') })
    expect(first).toBe(double)
    await expect(view.result.current.send('A different message')).rejects.toThrow(/current message/)
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1))
    await act(async () => { request.reject(new Error('Response lost')); await expect(first).rejects.toThrow('Response lost') })
    const nonce = state.send.mock.calls[0][3]
    await act(async () => view.result.current.send('Hello'))
    expect(state.send.mock.calls[1]).toEqual(['alpha', 'Hello', 'one', nonce])
    await act(async () => view.result.current.send('Hello'))
    expect(state.send.mock.calls[2][3]).not.toBe(nonce)
  })

  it('marks only loaded messages, preserves unread on failure, then invalidates the notification badge', async () => {
    const request = deferred<unknown>()
    state.read.mockReturnValueOnce(request.promise)
    const view = mount({ requestedChatId: 'alpha' })
    const invalidation = vi.spyOn(view.client, 'invalidateQueries')
    await waitFor(() => expect(view.result.current.messages).toHaveLength(1))
    await expect(view.result.current.markRead('unseen-new-message')).rejects.toThrow(/loaded/)
    expect(state.read).not.toHaveBeenCalled()
    let pending!: Promise<void>
    act(() => { pending = view.result.current.markRead('alpha-2') })
    expect(view.result.current.activeChat?.unread_count).toBe(2)
    await act(async () => { request.reject(new Error('Cannot mark read')); await expect(pending).rejects.toThrow() })
    await waitFor(() => expect(view.result.current.markReadError).not.toBeNull())
    expect(view.result.current.activeChat?.unread_count).toBe(2)
    state.getInbox.mockResolvedValue(inbox('one', [chat('alpha', { unread_count: 0 })]))
    await act(async () => view.result.current.markRead('alpha-2'))
    await waitFor(() => expect(view.result.current.activeChat?.unread_count).toBe(0))
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ['notification-unread', 'one'] })
  })

  it('waits for real leave/rejoin results and retains the conversation history', async () => {
    const request = deferred<{ chat_id: string; left_at: string }>()
    state.leave.mockReturnValueOnce(request.promise)
    const view = mount({ requestedChatId: 'alpha' })
    await waitFor(() => expect(view.result.current.messages).toHaveLength(1))
    let pending!: Promise<void>
    act(() => { pending = view.result.current.leave() })
    expect(view.result.current.activeChat?.can_send).toBe(true)
    state.getInbox.mockResolvedValue(inbox('one', [chat('alpha', { left_at: '2026-10-19T13:00:00Z', can_send: false })]))
    await act(async () => { request.resolve({ chat_id: 'alpha', left_at: '2026-10-19T13:00:00Z' }); await pending })
    await waitFor(() => expect(view.result.current.activeChat?.can_send).toBe(false))
    expect(view.result.current.messages).toHaveLength(1)
    expect(state.send).not.toHaveBeenCalled()
    await expect(view.result.current.send('Must not send')).rejects.toThrow()
    state.getInbox.mockResolvedValue(inbox())
    await act(async () => view.result.current.rejoin())
    await waitFor(() => expect(view.result.current.activeChat?.can_send).toBe(true))
  })

  it('keeps a previous-account send completion and read failure out of the new account', async () => {
    const send = deferred<ChatMessage>(); const read = deferred<unknown>()
    state.send.mockReturnValueOnce(send.promise); state.read.mockReturnValueOnce(read.promise)
    const view = mount({ requestedChatId: 'alpha' })
    await waitFor(() => expect(view.result.current.messages).toHaveLength(1))
    let sending!: Promise<void>; let reading!: Promise<void>
    act(() => { sending = view.result.current.send('One only'); reading = view.result.current.markRead('alpha-2') })
    state.userId = 'two'; view.rerender({ requestedChatId: 'beta' })
    await waitFor(() => expect(view.result.current.messages[0]?.chat_id).toBe('beta'))
    expect(view.result.current.sending).toBe(false)
    await act(async () => { send.resolve(message()); await sending; read.reject(new Error('Old failure')); await expect(reading).rejects.toThrow() })
    expect(view.result.current.messages[0]?.chat_id).toBe('beta')
    expect(view.result.current.markReadError).toBeNull()
    expect(view.result.current.activeChat?.unread_count).toBe(2)
  })

  it('requeries authoritative data for realtime events, focus and the foreground fallback', async () => {
    vi.useFakeTimers()
    const view = mount({ requestedChatId: 'alpha' })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    state.getInbox.mockResolvedValue(inbox('one', [chat('beta'), chat('alpha')]))
    const participant = state.events.find(event => event.table === 'chat_participants' && event.filter === 'user_id=eq.profile-one')
    expect(participant).toBeDefined()
    await act(async () => { participant!.callback(); await vi.advanceTimersByTimeAsync(10) })
    expect(view.result.current.chats[0].chat_id).toBe('beta')
    const count = state.getInbox.mock.calls.length
    focusManager.setFocused(false)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_001) })
    expect(state.getInbox).toHaveBeenCalledTimes(count)
    await act(async () => { focusManager.setFocused(true); await vi.advanceTimersByTimeAsync(10) })
    expect(state.getInbox.mock.calls.length).toBeGreaterThan(count)
    const afterFocus = state.getInbox.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(30_001) })
    expect(state.getInbox.mock.calls.length).toBeGreaterThan(afterFocus)
  })
})
