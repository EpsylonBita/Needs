import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  payments: [] as { id: string; listing_id: string; amount: number; currency: string }[],
  reviewed: [] as { payment_id: string }[],
  request: vi.fn(),
  profileLoad: vi.fn(),
  profileId: 'actual-provider',
  currentUser: 'auth-payer' as string | null,
  sessionUser: 'auth-payer',
  locale: 'en',
  listings: [] as { id: string; title: string; price: number; status: string }[],
  listingsError: false,
}))
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ locale: state.locale }) }))
vi.mock('next/navigation', () => ({ useParams: () => ({ id: state.profileId }) }))
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: state.currentUser ? { id: state.currentUser } : null }) }))
vi.mock('@/lib/utils/csrf', () => ({ withCsrfHeaders: async (headers: Record<string, string>) => ({ ...headers, 'X-CSRF-Token': 'csrf' }) }))
vi.mock('@/lib/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: state.currentUser ? { id: state.currentUser } : null } }), getSession: async () => ({ data: { session: { access_token: 'session', user: { id: state.sessionUser } } }, error: null }) },
  from: (table: string) => {
    let columns = ''
    let isOwnProfile = false
    let profileId = ''
    const chain = {
      select: (value: string) => { columns = value; return chain },
      eq: (column: string, value: string) => { if (column === 'user_id') isOwnProfile = true; if (column === 'id') profileId = value; return chain },
      order: () => chain, limit: () => chain, in: () => chain,
      single: async () => isOwnProfile ? { data: { id: 'payer' }, error: null } : state.profileLoad(profileId),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({
        data: table === 'payments' ? state.payments : table === 'reviews' && columns === 'payment_id' ? state.reviewed : table === 'listings' ? state.listings : [],
        error: table === 'listings' && state.listingsError ? new Error('Offline') : null,
      }).then(resolve),
    }
    return chain
  },
} }))
import PublicProfilePage from '@/app/profile/[id]/page'

const paymentOne = '10000000-0000-4000-8000-000000000001'
const paymentTwo = '20000000-0000-4000-8000-000000000002'
beforeEach(() => {
  vi.clearAllMocks()
  state.profileId = 'actual-provider'
  state.currentUser = 'auth-payer'
  state.sessionUser = 'auth-payer'
  state.locale = 'en'
  state.listings = []
  state.listingsError = false
  state.profileLoad.mockImplementation(async (id: string) => ({ data: { id, display_name: id === 'actual-provider' ? 'Service provider' : 'Second provider' }, error: null }))
  state.payments = [
    { id: paymentOne, listing_id: 'request-listing', amount: 10, currency: 'eur' },
    { id: paymentTwo, listing_id: 'request-listing', amount: 15, currency: 'eur' },
  ]
  state.reviewed = []
  state.request.mockResolvedValue({ ok: true, json: async () => ({ success: true, reviewId: 'review' }) })
  vi.stubGlobal('fetch', state.request)
})
afterEach(() => vi.unstubAllGlobals())

describe('Public profile reviews use the actual completed payment', () => {
  it('does not invent an empty member profile when the profile is unavailable', async () => {
    state.profileLoad.mockResolvedValue({ data: null, error: { code: 'PGRST116' } })
    render(<PublicProfilePage />)
    expect(await screen.findByRole('heading', { name: 'This profile is not available.' })).toBeInTheDocument()
    expect(screen.queryByText('No public listings.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit Review' })).not.toBeInTheDocument()
  })

  it('shows a retryable error instead of an empty listing history on failure', async () => {
    state.listingsError = true
    render(<PublicProfilePage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded')
    expect(screen.queryByText('No public listings.')).not.toBeInTheDocument()
    state.listingsError = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Service provider' })).toBeInTheDocument()
  })

  it('localizes public listing status, currency, review fields and actions in Greek', async () => {
    state.locale = 'el'
    state.listings = [{ id: 'listing', title: 'Ποδήλατο', price: 25, status: 'active' }]
    render(<PublicProfilePage />)
    expect(await screen.findByRole('link', { name: 'Ποδήλατο' })).toHaveAttribute('href', '/listings/listing')
    expect(screen.getByText('Διαθέσιμη')).toBeInTheDocument()
    expect(screen.queryByText('active')).not.toBeInTheDocument()
    expect(screen.getByText(/25,00.*€/)).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Βαθμολογία' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Υποβολή αξιολόγησης' })).toBeInTheDocument()
  })

  it('keeps separate payments for the same listing and supports a hidden completed listing', async () => {
    render(<PublicProfilePage />)
    const selector = await screen.findByRole('combobox', { name: 'Completed payment' })
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(screen.getByRole('option', { name: /€15.00/ })).toBeInTheDocument()
    fireEvent.change(selector, { target: { value: paymentTwo } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit Review' }))
    await waitFor(() => expect(state.request).toHaveBeenCalledWith('/api/reviews/submit', expect.objectContaining({
      body: JSON.stringify({ paymentId: paymentTwo, rating: 5, comment: '' }),
    })))
    expect(await screen.findByRole('status')).toHaveTextContent('Your review was submitted')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('combobox', { name: 'Completed payment' })).toHaveValue(paymentOne)
  })

  it('omits payments already reviewed by this payer', async () => {
    state.reviewed = [{ payment_id: paymentOne }]
    render(<PublicProfilePage />)
    expect(await screen.findByRole('combobox', { name: 'Completed payment' })).toHaveValue(paymentTwo)
    expect(screen.getAllByRole('option')).toHaveLength(1)
  })

  it('shows a duplicate response without claiming submission succeeded', async () => {
    state.request.mockResolvedValue({ ok: false, json: async () => ({ error: 'You have already reviewed this payment.' }) })
    render(<PublicProfilePage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Submit Review' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already reviewed')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit Review' })).toBeEnabled()
  })

  it('rejects fractional ratings before submitting', async () => {
    render(<PublicProfilePage />)
    fireEvent.change(await screen.findByRole('spinbutton', { name: 'Rating' }), { target: { value: '4.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit Review' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('integer rating')
    expect(state.request).not.toHaveBeenCalled()
  })

  it('does not restore a previous profile when its delayed load finishes after navigation', async () => {
    let finishOld!: (value: unknown) => void
    state.profileLoad.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    const view = render(<PublicProfilePage />)
    await waitFor(() => expect(state.profileLoad).toHaveBeenCalledWith('actual-provider'))
    state.profileId = 'second-provider'
    state.payments = []
    view.rerender(<PublicProfilePage />)
    expect(await screen.findByRole('heading', { name: 'Second provider' })).toBeInTheDocument()
    await act(async () => { finishOld({ data: { id: 'actual-provider', display_name: 'Old provider' }, error: null }) })
    expect(screen.getByRole('heading', { name: 'Second provider' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Old provider' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Completed payment' })).not.toBeInTheDocument()
  })

  it.each(['profile', 'account'])('ignores a pending review completion after changing %s', async context => {
    let finishReview!: (value: unknown) => void
    state.request.mockImplementationOnce(() => new Promise(resolve => { finishReview = resolve }))
    const view = render(<PublicProfilePage />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Review comment' }), { target: { value: 'For the old context' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit Review' }))
    await waitFor(() => expect(state.request).toHaveBeenCalledTimes(1))
    const pendingSignal = state.request.mock.calls[0][1].signal as AbortSignal
    if (context === 'profile') state.profileId = 'second-provider'
    else { state.currentUser = 'other-account'; state.sessionUser = 'other-account' }
    const nextPayment = '30000000-0000-4000-8000-000000000003'
    state.payments = [{ id: nextPayment, listing_id: 'next-listing', amount: 30, currency: 'eur' }]
    view.rerender(<PublicProfilePage />)
    expect(await screen.findByRole('combobox', { name: 'Completed payment' })).toHaveValue(nextPayment)
    expect(pendingSignal.aborted).toBe(true)
    await act(async () => { finishReview({ ok: true, json: async () => ({ success: true, reviewId: 'old-review' }) }) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('Rating: No reviews (0)')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Completed payment' })).toHaveValue(nextPayment)
    expect(screen.getByRole('textbox', { name: 'Review comment' })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Submit Review' })).toBeEnabled()
  })

  it('does not submit under a different session while the account context is catching up', async () => {
    render(<PublicProfilePage />)
    await screen.findByRole('button', { name: 'Submit Review' })
    state.sessionUser = 'other-account'
    fireEvent.click(screen.getByRole('button', { name: 'Submit Review' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Your session changed')
    expect(state.request).not.toHaveBeenCalled()
  })
})
