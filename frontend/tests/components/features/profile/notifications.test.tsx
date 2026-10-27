import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NotificationsPage from '@/app/dashboard/notifications/page'
import { useUnreadNotifications } from '@/lib/notifications/use-unread-notifications'
import type { NotificationPage, NotificationRow } from '@/lib/services/notification-service'

const state = vi.hoisted(() => ({
  userId: 'one' as string | null, locale: 'en', load: vi.fn(), mark: vi.fn(), count: vi.fn(), remove: vi.fn(),
  events: [] as { filter: string; callback: () => void }[],
}))
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: state.userId ? { id: state.userId } : null, isInitialized: true }) }))
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ locale: state.locale, formatDate: (date: string) => new Intl.DateTimeFormat(state.locale).format(new Date(date)) }) }))
vi.mock('@/lib/services/notification-service', () => ({ getNotifications: state.load, markNotificationRead: state.mark, getUnreadNotificationCount: state.count }))
vi.mock('@/lib/supabase/client', () => ({ supabase: {
  channel: () => ({ on(_type: string, options: { filter: string }, callback: () => void) { state.events.push({ filter: options.filter, callback }); return this }, subscribe() { return this } }),
  removeChannel: state.remove,
} }))

const first: NotificationRow = { id: '10000000-0000-4000-8000-000000000001', type: 'payment_sent', read: false, payload: { payment_id: '20000000-0000-4000-8000-000000000001', request_id: 'internal-secret' }, created_at: '2026-10-19T12:00:00Z' }
const second = { ...first, id: '10000000-0000-4000-8000-000000000002', type: 'dispute_opened', created_at: '2026-10-18T12:00:00Z' }
const page = (userId = 'one', rows = [first], nextCursor: NotificationPage['nextCursor'] = null): NotificationPage => ({ userId, profileId: `profile-${userId}`, rows, nextCursor })
function Badge() { const count = useUnreadNotifications(); return <output aria-label="Unread count">{count.data?.count ?? 'unavailable'}</output> }
const clients: QueryClient[] = []
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })
  clients.push(client)
  const tree = () => <QueryClientProvider client={client}><Badge /><NotificationsPage /></QueryClientProvider>
  const view = render(tree())
  return { ...view, client, update: () => view.rerender(tree()) }
}
beforeEach(() => {
  vi.clearAllMocks(); state.userId = 'one'; state.locale = 'en'; state.events = []
  state.load.mockReset().mockImplementation(async (userId: string) => page(userId))
  state.mark.mockReset().mockResolvedValue({ ...first, read: true })
  state.count.mockReset().mockImplementation(async (userId: string) => ({ userId, profileId: `profile-${userId}`, count: 1 }))
})
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.useRealTimers() })

describe('notification journeys', () => {
  it('separates loading, failed fetch with retry, and a genuinely empty account', async () => {
    let reject!: (error: Error) => void
    state.load.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail })).mockResolvedValue(page('one', []))
    mount()
    expect(screen.getByText('Loading notifications…')).toHaveAttribute('role', 'status')
    expect(screen.queryByText('No notifications yet')).toBeNull()
    await act(async () => reject(new Error('Database unavailable')))
    expect(await screen.findByRole('alert')).toHaveTextContent('Notifications could not be loaded')
    expect(screen.queryByText('No notifications yet')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('No notifications yet')).toBeInTheDocument()
  })
  it('shows Greek event messages and safe navigation instead of raw JSON', async () => {
    state.locale = 'el'; mount()
    expect(await screen.findByText('Η πληρωμή σου ολοκληρώθηκε')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ειδοποιήσεις' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Προβολή παραγγελίας' })).toHaveAttribute('href', '/dashboard/orders/20000000-0000-4000-8000-000000000001')
    expect(screen.queryByText(/internal-secret|payment_sent|payment_id/)).toBeNull()
  })
  it.each([
    ['en', 'New message', 'Open conversation'],
    ['el', 'Νέο μήνυμα', 'Άνοιγμα συνομιλίας'],
  ])('opens the exact conversation from a new-message notification in %s', async (locale, title, linkLabel) => {
    state.locale = locale
    const chatId = '30000000-0000-4000-8000-000000000001'
    state.load.mockResolvedValue(page('one', [{ ...first, type: 'chat_message', payload: {
      chat_id: chatId, message_id: 'private-message-id', sender_id: 'private-sender-id', content: 'Private message content',
    } }]))
    mount()
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: linkLabel })).toHaveAttribute('href', `/chat?chat=${chatId}`)
    expect(screen.queryByText(/private-message-id|private-sender-id|Private message content/)).toBeNull()
    expect(state.mark).not.toHaveBeenCalled()
  })
  it('awaits mark-read, preserves unread on failure, then refreshes the shared badge and overview on success', async () => {
    let reject!: (error: Error) => void
    state.mark.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail }))
    const view = mount()
    const invalidate = vi.spyOn(view.client, 'invalidateQueries')
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as read' }))
    expect(screen.getByText('Unread')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByLabelText('Unread count')).toHaveTextContent('1')
    await act(async () => reject(new Error('Write failed')))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be marked as read')
    expect(screen.getByText('Unread')).toBeInTheDocument()
    state.load.mockResolvedValue(page('one', [{ ...first, read: true }]))
    state.count.mockResolvedValue({ userId: 'one', profileId: 'profile-one', count: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }))
    expect(await screen.findByText('Read')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Unread count')).toHaveTextContent('0'))
    expect(state.mark).toHaveBeenCalledWith('one', first.id)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['profile-overview', 'one'] })
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('loads older rows and retains current rows if loading more fails', async () => {
    const cursor = { id: first.id, createdAt: first.created_at }
    state.load.mockResolvedValueOnce(page('one', [first], cursor)).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(page('one', [second]))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Load older notifications' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Your payment completed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('A dispute was opened')).toBeInTheDocument()
    expect(screen.getByText('Your payment completed')).toBeInTheDocument()
    expect(state.load).toHaveBeenLastCalledWith('one', expect.any(AbortSignal), cursor)
  })
  it('hides the old account immediately and ignores its delayed results and event callbacks', async () => {
    let resolveOld!: (data: NotificationPage) => void
    state.load.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve })).mockResolvedValueOnce(page('two', [second]))
    const view = mount()
    await waitFor(() => expect(state.load).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(state.events.length).toBeGreaterThan(0))
    const oldEvents = [...state.events]
    state.userId = 'two'; view.update()
    expect(screen.queryByText('Your payment completed')).toBeNull()
    await screen.findByText('A dispute was opened')
    await act(async () => resolveOld(page()))
    expect(screen.queryByText('Your payment completed')).toBeNull()
    const before = state.load.mock.calls.length
    await act(async () => oldEvents.forEach(event => event.callback()))
    expect(state.load).toHaveBeenCalledTimes(before)
    expect(state.remove).toHaveBeenCalled()
  })
  it('refreshes both notifications and badge after a scoped realtime event', async () => {
    mount(); await screen.findByText('Your payment completed')
    state.load.mockResolvedValue(page('one', [second, first]))
    state.count.mockResolvedValue({ userId: 'one', profileId: 'profile-one', count: 2 })
    expect(state.events.every(event => event.filter === 'user_id=eq.profile-one')).toBe(true)
    await act(async () => state.events[0].callback())
    await screen.findByText('A dispute was opened')
    await waitFor(() => expect(screen.getByLabelText('Unread count')).toHaveTextContent('2'))
  })
  it.each(['success', 'failure'])('keeps a delayed previous-account mark-read %s out of the new account', async outcome => {
    let finish!: () => void
    state.mark.mockReturnValueOnce(new Promise((resolve, reject) => {
      finish = () => outcome === 'success' ? resolve({ ...first, read: true }) : reject(new Error('Old account write failed'))
    }))
    const view = mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as read' }))
    await screen.findByRole('button', { name: 'Saving…' })
    state.load.mockResolvedValue(page('two', [second]))
    state.userId = 'two'; view.update()
    await screen.findByText('A dispute was opened')
    expect(screen.getByRole('button', { name: 'Mark as read' })).toBeEnabled()
    await act(async () => finish())
    expect(screen.queryByText('Your payment completed')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Unread')).toBeInTheDocument()
    expect(screen.getByLabelText('Unread count')).toHaveTextContent('1')
  })
  it('polls for updates even when realtime delivers no events', async () => {
    vi.useFakeTimers()
    mount()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(screen.getByText('Your payment completed')).toBeInTheDocument()
    state.load.mockResolvedValue(page('one', [second, first]))
    await act(async () => { await vi.advanceTimersByTimeAsync(30_001) })
    expect(screen.getByText('A dispute was opened')).toBeInTheDocument()
  })
})
