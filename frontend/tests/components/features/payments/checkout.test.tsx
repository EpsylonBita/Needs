import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'

const mocks = vi.hoisted(() => ({ session: vi.fn(), csrf: vi.fn(), confirm: vi.fn(), elements: vi.fn(), fetch: vi.fn(), proposal: vi.fn(), theme: 'light', locale: 'en' }))
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ locale: mocks.locale }) }))
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: mocks.theme }) }))
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { getSession: mocks.session }, from: () => { const chain = { select: () => chain, eq: () => chain, single: mocks.proposal }; return chain } } }))
vi.mock('@/lib/utils/csrf', () => ({ withCsrfHeaders: mocks.csrf }))
vi.mock('@stripe/stripe-js', () => ({ loadStripe: vi.fn(() => Promise.resolve({})) }))
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children, options }: any) => { mocks.elements(options); return children },
  PaymentElement: () => <div data-testid="payment-element">Card details</div>,
  useStripe: () => ({ confirmPayment: mocks.confirm }),
  useElements: () => ({ id: 'elements' }),
}))
let Checkout: typeof import('@/components/features/payments/checkout').Checkout

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.theme = 'light'
  mocks.locale = 'en'
  vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_test_preview')
  vi.stubGlobal('fetch', mocks.fetch)
  mocks.session.mockResolvedValue({ data: { session: { access_token: 'test-token' } }, error: null })
  mocks.csrf.mockImplementation(async (headers: any) => ({ ...headers, 'X-CSRF-Token': 'test-csrf' }))
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ clientSecret: 'pi_test_secret', platformFee: 0.5 }) })
  mocks.confirm.mockResolvedValue({ error: { message: 'Your card was declined.' } })
  ;({ Checkout } = await import('@/components/features/payments/checkout'))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('Existing checkout workflow', () => {
  it('localizes checkout and Stripe fields without recreating the payment intent on language change', async () => {
    const view = render(<Checkout listingId="listing-1" />)
    await screen.findByTestId('payment-element')
    mocks.locale = 'el'
    view.rerender(<Checkout listingId="listing-1" />)
    expect(screen.getByRole('heading', { name: 'Πληρωμή' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Πληρωμή' })).toBeInTheDocument()
    expect(screen.getByText(/Προμήθεια πλατφόρμας: 0,50.*€/)).toBeInTheDocument()
    expect(mocks.elements).toHaveBeenLastCalledWith(expect.objectContaining({ locale: 'el' }))
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Πληρωμή' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Η κάρτα σου απορρίφθηκε')
    expect(screen.getByRole('button', { name: 'Πληρωμή' })).toBeEnabled()
  })
  it('localizes signed-out and structured server rejections in Greek', async () => {
    mocks.locale = 'el'
    mocks.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: { message: 'Only the requester can pay this provider' } }) })
    render(<Checkout listingId="listing-1" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Μόνο ο δημιουργός του αιτήματος')
    expect(screen.queryByTestId('payment-element')).not.toBeInTheDocument()
  })
  it('updates the payment field theme without creating a second payment intent', async () => {
    const view = render(<Checkout listingId="listing-1" />)
    await screen.findByTestId('payment-element')
    expect(mocks.elements).toHaveBeenLastCalledWith(expect.objectContaining({ appearance: { theme: 'stripe' } }))
    mocks.theme = 'dark'
    view.rerender(<Checkout listingId="listing-1" />)
    expect(mocks.elements).toHaveBeenLastCalledWith(expect.objectContaining({ clientSecret: 'pi_test_secret', appearance: { theme: 'night' } }))
    mocks.theme = 'light'
    view.rerender(<Checkout listingId="listing-1" />)
    expect(mocks.elements).toHaveBeenLastCalledWith(expect.objectContaining({ appearance: { theme: 'stripe' } }))
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('mounts Stripe Elements with the returned secret and authenticated CSRF headers', async () => {
    render(<Checkout listingId="listing-1" />)
    await screen.findByTestId('payment-element')
    expect(mocks.elements).toHaveBeenCalledWith(expect.objectContaining({ clientSecret: 'pi_test_secret' }))
    expect(mocks.fetch).toHaveBeenCalledWith('/api/payments/create-intent', expect.objectContaining({ headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token', 'X-CSRF-Token': 'test-csrf' } }))
    expect(screen.getByText('Platform fee: €0.50')).toBeTruthy()
  })
  it('shows a decline and keeps the payment form usable for retry', async () => {
    render(<Checkout listingId="listing-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Pay' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Your card was declined.')
    expect(screen.getByTestId('payment-element')).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pay' })).not.toBeDisabled())
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmParams: { return_url: new URL('/payments/return', window.location.origin).toString() } }))
  })
  it('does not create an intent when signed out', async () => {
    mocks.session.mockResolvedValue({ data: { session: null }, error: null })
    render(<Checkout listingId="listing-1" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('funds the selected saved milestone through its own checkout endpoint', async () => {
    mocks.proposal.mockResolvedValue({ data: { id: 'milestone-1', title: 'First step', amount: 5 }, error: null })
    render(<Checkout listingId="listing-1" milestoneId="milestone-1" />)
    await screen.findByTestId('payment-element')
    expect(mocks.fetch).toHaveBeenCalledWith('/api/payments/milestones/create-intent', expect.objectContaining({ body: JSON.stringify({ listingId: 'listing-1', milestoneId: 'milestone-1', title: 'First step', amount: 5 }) }))
  })
  it('does not send an unprotected payment request after CSRF initialization fails', async () => {
    mocks.csrf.mockResolvedValue({ Authorization: 'Bearer test-token' })
    render(<Checkout listingId="listing-1" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('secure payment request')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('preserves the trusted conversation when initializing a request payment', async () => {
    render(<Checkout listingId="listing-1" chatId="chat-1" />)
    await screen.findByTestId('payment-element')
    expect(mocks.fetch).toHaveBeenCalledWith('/api/payments/create-intent', expect.objectContaining({ body: JSON.stringify({ listingId: 'listing-1', chatId: 'chat-1' }) }))
  })
  it('shows a structured payment rejection as a useful message', async () => {
    mocks.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: { message: 'Only the requester can pay this provider' } }) })
    render(<Checkout listingId="listing-1" chatId="chat-1" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Only the requester can pay this provider')
    expect(screen.queryByTestId('payment-element')).not.toBeInTheDocument()
  })
})
