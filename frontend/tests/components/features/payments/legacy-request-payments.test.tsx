import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  payment: {} as Record<string, unknown>, fetch: vi.fn(), update: vi.fn(),
  locale: 'en',
  updateError: null as { message: string } | null,
  historyError: false,
}))
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ locale: state.locale, t: (key: string, fallback?: string) => fallback ?? key }) }))
vi.mock('@/lib/utils/csrf', () => ({ withCsrfHeaders: async (headers: Record<string, string>) => ({ ...headers, 'X-CSRF-Token': 'csrf' }) }))
vi.mock('@/lib/supabase/client', () => ({ supabase: {
  auth: {
    getUser: async () => ({ data: { user: { id: 'auth-buyer' } }, error: null }),
    getSession: async () => ({ data: { session: { access_token: 'token' } }, error: null }),
  },
  from: (table: string) => {
    let mutation = false
    const query = {
      select: () => query, eq: () => query, or: () => query, in: () => query, limit: () => query, order: () => query,
      update: (payload: unknown) => { mutation = true; state.update(payload); return query },
      single: async () => ({ data: table === 'profiles' ? { id: 'buyer' } : state.payment, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({
        data: table === 'payments' ? [state.payment] : table === 'listings' ? [{ id: 'listing', title: 'Request listing' }] : [],
        error: mutation ? state.updateError : table === 'transactions' && state.historyError ? new Error('Offline') : null,
      }).then(resolve),
    }
    return query
  },
} }))

import PaymentsPage from '@/app/dashboard/payments/page'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_PAYMENTS_ENABLED', 'true')
  vi.stubGlobal('fetch', state.fetch)
  state.locale = 'en'
  state.updateError = null
  state.historyError = false
  state.payment = { id: 'payment', listing_id: 'listing', buyer_id: 'buyer', seller_id: 'seller', amount: 20, currency: 'eur', status: 'requires_capture', stripe_payment_intent: 'pi_test', buyer_confirmed: true, seller_confirmed: true, role_review_required: true }
  state.fetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'This older request payment needs administrator review before it can be captured.' }) })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe.each([{ name: 'Payments', Page: PaymentsPage }])('$name legacy request protection', ({ Page }) => {
  it('shows a retryable error when transaction history fails instead of a false empty state', async () => {
    state.historyError = true
    render(<Page />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Payments could not be loaded')
    expect(screen.queryByText('No transactions yet.')).not.toBeInTheDocument()
    state.historyError = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Awaiting completion')).toBeInTheDocument()
  })

  it('locks capture and refresh while a request is pending and never claims final settlement', async () => {
    state.payment.role_review_required = false
    let finish!: (response: unknown) => void
    state.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    render(<Page />)
    const capture = await screen.findByRole('button', { name: 'Finalize payment' })
    fireEvent.click(capture); fireEvent.click(capture)
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
    await act(async () => finish({ ok: true }))
    expect(await screen.findByRole('status')).toHaveTextContent('being verified')
    expect(screen.getByText('Awaiting completion')).toBeInTheDocument()
    expect(screen.queryByText('Completed')).not.toBeInTheDocument()
  })

  it('explains the review requirement and disables confirmation and capture', async () => {
    render(<Page />)
    expect(await screen.findByText('This older request payment needs administrator review.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'I received my purchase' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Finalize payment' })).toBeDisabled()
    expect(state.update).not.toHaveBeenCalled()
    expect(state.fetch).not.toHaveBeenCalled()
  })

  it('surfaces a capture rejection without pretending settlement succeeded', async () => {
    state.payment.role_review_required = false
    render(<Page />)
    fireEvent.click(await screen.findByRole('button', { name: 'Finalize payment' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('needs administrator review before it can be captured')
    expect(screen.getByText('Awaiting completion')).toBeTruthy()
    expect(screen.queryByText('Completed')).not.toBeInTheDocument()
  })

  it('reports rejected party confirmations instead of silently refreshing', async () => {
    state.payment.role_review_required = false
    state.payment.buyer_confirmed = false
    state.updateError = { message: 'Confirmation requires administrator review' }
    render(<Page />)
    fireEvent.click(await screen.findByRole('button', { name: 'I received my purchase' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Confirmation requires administrator review')
  })

  it('shows the administrator review warning in Greek', async () => {
    state.locale = 'el'
    render(<Page />)
    expect(await screen.findByText('Αυτή η παλαιότερη πληρωμή αιτήματος χρειάζεται έλεγχο από διαχειριστή.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Οριστικοποίηση πληρωμής' })).toBeDisabled()
  })

  it('uses a Greek fallback when capture fails without a server message', async () => {
    state.locale = 'el'
    state.payment.role_review_required = false
    state.fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    render(<Page />)
    fireEvent.click(await screen.findByRole('button', { name: 'Οριστικοποίηση πληρωμής' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Η πληρωμή δεν μπόρεσε να ολοκληρωθεί.')
  })

  it('translates the legacy review capture rejection into Greek', async () => {
    state.locale = 'el'
    state.payment.role_review_required = false
    render(<Page />)
    fireEvent.click(await screen.findByRole('button', { name: 'Οριστικοποίηση πληρωμής' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Αυτή η παλαιότερη πληρωμή αιτήματος χρειάζεται έλεγχο από διαχειριστή πριν ολοκληρωθεί.')
  })
})
