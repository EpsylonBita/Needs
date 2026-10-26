import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfileStats } from '@/components/features/profile/profile-stats'
import { ProfileTabs } from '@/components/features/profile/profile-tabs'
import type { ProfileOverview } from '@/lib/services/profile-overview-service'

const state = vi.hoisted(() => ({ userId: 'one' as string | null, locale: 'en', params: 'tab=dashboard', load: vi.fn(), replace: vi.fn() }))
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: state.userId ? { id: state.userId } : null, isInitialized: true }) }))
vi.mock('@/lib/services/profile-overview-service', () => ({ getProfileOverview: state.load }))
// These children have their own auth/form coverage; keep this suite on the overview query and tab contract.
vi.mock('@/components/features/profile/profile-settings', () => ({ ProfileSettings: () => <section aria-label="Profile settings" /> }))
vi.mock('@/components/features/ads/new-listing-button', () => ({ NewListingButton: () => <button type="button">New listing</button> }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(state.params), useRouter: () => ({ replace: state.replace }) }))
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({
  locale: state.locale, formatNumber: (value: number) => new Intl.NumberFormat(state.locale).format(value),
  formatCurrency: (value: number, currency: string) => new Intl.NumberFormat(state.locale, { style: 'currency', currency }).format(value),
  formatDate: (value: string) => new Intl.DateTimeFormat(state.locale).format(new Date(value)),
}) }))

const example = (userId = 'one'): ProfileOverview => ({
  userId, activeListings: 2, conversations: 3, receivedReviews: 4, unreadNotifications: 5,
  listings: [{ id: 'desk', title: 'My desk', price: 12, status: 'active', moderation_suspended: false }],
  reviews: [{ id: 'review', rating: 5, comment: 'Reliable service', created_at: '2026-10-19T12:00:00Z' }],
})
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const tree = () => <QueryClientProvider client={client}><ProfileStats /><ProfileTabs /></QueryClientProvider>
  const view = render(tree())
  return { ...view, update: () => view.rerender(tree()) }
}
beforeEach(() => {
  vi.clearAllMocks()
  state.userId = 'one'
  state.locale = 'en'
  state.params = 'tab=dashboard'
  state.load.mockResolvedValue(example())
})
afterEach(cleanup)

describe('real profile dashboard', () => {
  it('renders the redirected dashboard tab with real counts and working management links, without mock finances', async () => {
    mount()
    await screen.findByText('My desk')
    for (const count of ['2', '3', '4', '5']) expect(screen.getByText(count)).toBeInTheDocument()
    expect(screen.getByRole('tabpanel', { name: 'Dashboard' })).toHaveTextContent('Your activity')
    expect(screen.getByRole('link', { name: 'Open conversations' })).toHaveAttribute('href', '/chat')
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveAttribute('href', '/dashboard/orders')
    expect(screen.queryByText('$45,231.89')).toBeNull()
    expect(screen.queryByText(/265 sales/)).toBeNull()
    expect(screen.queryByText('4.8')).toBeNull()
    expect(state.load).toHaveBeenCalledTimes(1)
  })

  it('shows loading and failure with retry instead of invented zeros', async () => {
    let reject!: (error: Error) => void
    state.load.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail }))
    mount()
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
    expect(screen.queryByText('0')).toBeNull()
    await act(async () => reject(new Error('Offline')))
    expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent('could not be loaded')
    expect(screen.queryByText('0')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'Try again' })[0])
    await screen.findByText('My desk')
  })

  it('shows honest empty counts and listing/review empty states', async () => {
    state.load.mockResolvedValue({ ...example(), activeListings: 0, conversations: 0, receivedReviews: 0, unreadNotifications: 0, listings: [], reviews: [] })
    const view = mount()
    await screen.findByText('You have not created any listings yet. Offer something, ask for what you need, or explore your neighbourhood.')
    expect(screen.getAllByText('0')).toHaveLength(4)
    state.params = 'tab=reviews'
    view.update()
    expect(screen.getByRole('tabpanel', { name: 'Reviews' })).toHaveTextContent('You have not received any reviews yet.')
  })

  it('follows URL tab changes without remounting and displays actual received reviews', async () => {
    const view = mount()
    await screen.findByText('My desk')
    state.params = 'tab=reviews'
    view.update()
    expect(screen.getByRole('tabpanel', { name: 'Reviews' })).toHaveTextContent('Reliable service')
    state.params = 'tab=dashboard'
    view.update()
    expect(screen.getByRole('tabpanel', { name: 'Dashboard' })).toHaveTextContent('Your activity')
  })

  it('uses Greek labels and EUR prices for the Greek locale', async () => {
    state.locale = 'el'
    mount()
    await screen.findByText('My desk')
    expect(screen.getByText('Ενεργές αγγελίες')).toBeInTheDocument()
    expect(screen.getByRole('tabpanel', { name: 'Πίνακας ελέγχου' })).toHaveTextContent('Η δραστηριότητά σου')
    expect(screen.getByText(/12,00\s+€/)).toBeInTheDocument()
  })

  it('immediately hides the previous account and ignores its delayed response after switching', async () => {
    let finishFirst!: (data: ProfileOverview) => void
    state.load.mockReturnValueOnce(new Promise(resolve => { finishFirst = resolve }))
      .mockResolvedValueOnce({ ...example('two'), activeListings: 9, listings: [{ ...example().listings[0], title: 'Second account listing' }] })
    const view = mount()
    await waitFor(() => expect(state.load).toHaveBeenCalledTimes(1))
    state.userId = 'two'
    view.update()
    expect(screen.queryByText('My desk')).toBeNull()
    await screen.findByText('Second account listing')
    await act(async () => finishFirst(example()))
    expect(screen.queryByText('My desk')).toBeNull()
    expect(screen.getByText('9')).toBeInTheDocument()
    state.userId = null
    view.update()
    expect(screen.queryByText('Second account listing')).toBeNull()
    expect(screen.queryByText('9')).toBeNull()
  })

  it('does not display already loaded values while the next account is loading', async () => {
    const view = mount()
    await screen.findByText('My desk')
    state.load.mockReturnValueOnce(new Promise(() => {}))
    state.userId = 'two'
    view.update()
    expect(screen.queryByText('My desk')).toBeNull()
    expect(screen.queryByText('2')).toBeNull()
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
  })
})
