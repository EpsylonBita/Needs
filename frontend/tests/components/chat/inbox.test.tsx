import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem, ChatMessage } from '@/lib/services/chat-service'

const state = vi.hoisted(() => ({
  userId: 'account-one' as string | null, locale: 'en', query: '',
  inbox: vi.fn(), send: vi.fn(), leave: vi.fn(), rejoin: vi.fn(), markRead: vi.fn(),
  refresh: vi.fn(), select: vi.fn(), loadOlder: vi.fn(), directSend: vi.fn(),
  router: { replace: vi.fn() },
}))
vi.mock('next/navigation', () => ({ useRouter: () => state.router, useSearchParams: () => new URLSearchParams(state.query) }))
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: state.userId ? { id: state.userId } : null, isInitialized: true }) }))
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ locale: state.locale, t: (_key: string, fallback: string) => fallback }) }))
vi.mock('@/lib/chat/use-inbox', () => ({ useInbox: state.inbox }))
vi.mock('@/lib/services/chat-service', () => ({ MESSAGE_MAX_LENGTH: 4000, sendMessage: state.directSend }))
vi.mock('@/components/features/chat/chat-transaction-panel', () => ({ ChatTransactionPanel: () => <div>Transaction controls</div> }))
vi.mock('@/components/ui/avatar', () => ({
  Avatar: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  AvatarFallback: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  // eslint-disable-next-line @next/next/no-img-element -- Observe avatar props without Radix's asynchronous image-loading gate.
  AvatarImage: ({ src, alt }: { src?: string; alt: string }) => src ? <img src={src} alt={alt} /> : null,
}))

import ChatPage from '@/app/chat/page'

const chatId = '10000000-0000-4000-8000-000000000001'
const message: ChatMessage = { id: '20000000-0000-4000-8000-000000000001', chat_id: chatId, sender_id: 'other-profile', content: 'Can we meet tomorrow?', created_at: '2026-10-19T12:00:00Z', sequence: 1 }
const first: ChatItem = {
  chat_id: chatId, chats: { id: chatId, title: 'Bicycle repair', type: 'direct', listing_id: null, created_at: '2026-10-19T11:00:00Z' },
  participants: [{ profile_id: 'other-profile', display_name: 'Maria Papadopoulou', avatar_url: 'https://example.com/maria.png', left_at: null }],
  last_message: message, unread_count: 2, last_read_at: null, left_at: null, can_send: true, other_left: false,
}
function inbox() {
  return {
    chats: [first], activeChat: first as ChatItem | null, activeChatId: chatId as string | null, profileId: 'own-profile', messages: [message],
    signedIn: true, authReady: true, initialized: true, loading: false, chatsError: null as Error | null, openingError: null as Error | null,
    messagesError: null as Error | null, messagesLoading: false, hasOlder: false, isFetchingOlder: false, isRefreshing: false,
    send: state.send, sending: false, leave: state.leave, rejoin: state.rejoin, leaving: false, rejoining: false,
    markRead: state.markRead, markReadError: null as Error | null, markingRead: false,
    refresh: state.refresh, selectChat: state.select, loadOlder: state.loadOlder,
  }
}
const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState')
function visibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value })
}
beforeEach(() => {
  vi.resetAllMocks()
  state.userId = 'account-one'; state.locale = 'en'; state.query = `chat=${chatId}`
  for (const callback of [state.send, state.leave, state.rejoin, state.markRead, state.refresh, state.loadOlder, state.directSend]) callback.mockResolvedValue(undefined)
  state.inbox.mockReturnValue(inbox())
  visibility('visible')
})
afterEach(() => {
  cleanup()
  if (visibilityDescriptor) Object.defineProperty(document, 'visibilityState', visibilityDescriptor)
  else Reflect.deleteProperty(document, 'visibilityState')
})

describe('Inbox user journeys', () => {
  it('passes the notification deep link and shows the member, avatar and unread conversation preview', () => {
    render(<ChatPage />)
    expect(state.inbox).toHaveBeenCalledWith({ requestedChatId: chatId, requestedListingId: null })
    const list = screen.getByRole('complementary', { name: 'Inbox' })
    expect(within(list).getByText('Maria Papadopoulou')).toBeInTheDocument()
    expect(within(list).getByAltText('')).toHaveAttribute('src', 'https://example.com/maria.png')
    expect(within(list).getByLabelText('2 unread')).toBeInTheDocument()
    expect(within(list).getByText('Bicycle repair')).toBeInTheDocument()
    expect(within(list).getByText('Can we meet tomorrow?')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View member profile' })).toHaveAttribute('href', '/profile/other-profile')
  })

  it('preserves a failed draft and clears it only after a successful retry', async () => {
    const user = userEvent.setup()
    state.send.mockRejectedValueOnce(new Error('Network unavailable'))
    render(<ChatPage />)
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Tomorrow works for me.')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Your message was not sent')
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Tomorrow works for me.')
    expect(state.send).toHaveBeenLastCalledWith('Tomorrow works for me.')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(''))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(state.send).toHaveBeenCalledTimes(2)
  })

  it('keeps a newer edit when an earlier send completes', async () => {
    let finish!: () => void
    state.send.mockReturnValue(new Promise<void>(resolve => { finish = resolve }))
    const user = userEvent.setup()
    render(<ChatPage />)
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'First draft')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    // Simulate an edit already queued when the pending mutation disabled the composer.
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Later draft' } })
    await act(async () => finish())
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Later draft')
  })

  it('requires Leave confirmation and calls membership persistence without a fake leave message', async () => {
    const user = userEvent.setup()
    render(<ChatPage />)
    await user.click(screen.getByRole('button', { name: 'Leave conversation' }))
    const dialog = screen.getByRole('dialog', { name: 'Leave this conversation?' })
    expect(state.leave).not.toHaveBeenCalled()
    expect(within(dialog).getByText(/Its history and any transactions are kept/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Leave conversation' }))
    await waitFor(() => expect(state.leave).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(state.send).not.toHaveBeenCalled()
    expect(state.directSend).not.toHaveBeenCalled()
  })

  it('retains the Leave dialog after a failed membership change', async () => {
    const user = userEvent.setup()
    state.leave.mockRejectedValue(new Error('Database unavailable'))
    render(<ChatPage />)
    await user.click(screen.getByRole('button', { name: 'Leave conversation' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Leave conversation' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The change could not be saved')
    expect(dialog).toBeInTheDocument()
    expect(state.send).not.toHaveBeenCalled()
  })

  it('finds retained history in Left conversations and lets the member return', async () => {
    const departed: ChatItem = { ...first, chat_id: 'left-chat', chats: { ...first.chats, id: 'left-chat' }, left_at: '2026-10-19T13:00:00Z', can_send: false }
    const value = { ...inbox(), chats: [departed], activeChat: null, activeChatId: null, messages: [] as ChatMessage[] }
    state.query = ''
    state.inbox.mockReturnValue(value)
    const user = userEvent.setup()
    const view = render(<ChatPage />)
    const sidebar = screen.getByRole('complementary', { name: 'Inbox' })
    expect(within(sidebar).queryByText('Maria Papadopoulou')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Left conversations' }))
    await user.click(within(sidebar).getByRole('button', { name: /Maria Papadopoulou/ }))
    expect(state.select).toHaveBeenCalledWith('left-chat')
    expect(state.router.replace).toHaveBeenCalledWith('/chat?chat=left-chat', { scroll: false })
    state.inbox.mockReturnValue({ ...value, activeChat: departed, activeChatId: departed.chat_id, messages: [{ ...message, chat_id: departed.chat_id }] })
    view.rerender(<ChatPage />)
    expect(screen.getByText('You have left this conversation. Its history is still available.')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument()
    expect(screen.getAllByText(message.content!)).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Return to conversation' }))
    await waitFor(() => expect(state.rejoin).toHaveBeenCalledTimes(1))
    expect(state.send).not.toHaveBeenCalled()
  })

  it('does not mark cached messages as read in a hidden tab, then marks the rendered watermark when visible', async () => {
    visibility('hidden')
    render(<ChatPage />)
    expect(screen.getAllByText(message.content!)).toHaveLength(2)
    expect(state.markRead).not.toHaveBeenCalled()
    visibility('visible')
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() => expect(state.markRead).toHaveBeenCalledWith(message.id))
    expect(state.markRead).toHaveBeenCalledTimes(1)
  })

  it('never acknowledges cached messages from another conversation', () => {
    state.inbox.mockReturnValue({ ...inbox(), messages: [{ ...message, chat_id: 'previous-chat' }] })
    render(<ChatPage />)
    expect(state.markRead).not.toHaveBeenCalled()
  })

  it('preserves a notification chat deep link when redirecting a signed-out visitor', async () => {
    state.userId = null
    render(<ChatPage />)
    await waitFor(() => expect(state.router.replace).toHaveBeenCalledWith(`/login?redirectTo=${encodeURIComponent(`/chat?chat=${chatId}`)}`))
    expect(state.inbox).not.toHaveBeenCalled()
    expect(state.markRead).not.toHaveBeenCalled()
  })

  it('offers a route back to the inbox after a listing conversation fails to open', async () => {
    state.query = 'listing=unavailable-listing'
    state.inbox.mockReturnValue({ ...inbox(), activeChat: null, activeChatId: null, messages: [], openingError: new Error('Listing unavailable') })
    const user = userEvent.setup()
    render(<ChatPage />)
    expect(state.inbox).toHaveBeenCalledWith({ requestedChatId: null, requestedListingId: 'unavailable-listing' })
    expect(screen.getByRole('heading', { name: 'This conversation is unavailable.' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to conversations' }))
    expect(state.select).toHaveBeenCalledWith(null)
    expect(state.router.replace).toHaveBeenCalledWith('/chat', { scroll: false })
  })

  it('resets drafts when switching accounts and ignores an older send failure', async () => {
    let fail!: (error: Error) => void
    state.send.mockReturnValueOnce(new Promise<void>((_resolve, reject) => { fail = reject }))
    const user = userEvent.setup()
    const view = render(<ChatPage />)
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Private account A draft')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    state.userId = 'account-two'
    state.inbox.mockReturnValue({ ...inbox(), profileId: 'second-own-profile' })
    view.rerender(<ChatPage />)
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('')
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Account B draft')
    await act(async () => fail(new Error('Previous account send failed')))
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Account B draft')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the inbox, membership and send controls in Greek', async () => {
    state.locale = 'el'
    const user = userEvent.setup()
    render(<ChatPage />)
    expect(screen.getByRole('heading', { name: 'Μηνύματα', level: 1 })).toBeInTheDocument()
    expect(screen.getByLabelText('2 μη αναγνωσμένα')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Μήνυμα' }), 'Γεια σου')
    expect(screen.getByRole('button', { name: 'Αποστολή' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Αποχώρηση' }))
    expect(screen.getByRole('dialog', { name: 'Αποχώρηση από τη συνομιλία;' })).toBeInTheDocument()
    expect(state.leave).not.toHaveBeenCalled()
  })
})
