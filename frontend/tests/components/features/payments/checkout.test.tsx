import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'

const mocks = vi.hoisted(() => ({ session: vi.fn(), csrf: vi.fn(), confirm: vi.fn(), elements: vi.fn(), fetch: vi.fn(), proposal: vi.fn(), theme: 'light', locale: 'en', userId: 'auth-buyer' as string | null, initialized: true }))
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: mocks.userId ? { id: mocks.userId } : null, isInitialized: mocks.initialized }) }))
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
  mocks.userId = 'auth-buyer'; mocks.initialized = true
  vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_test_preview')
  vi.stubGlobal('fetch', mocks.fetch)
  mocks.session.mockResolvedValue({ data: { session: { access_token: 'test-token', user: { id: 'auth-buyer' } } }, error: null })
  mocks.csrf.mockImplementation(async (headers: any) => ({ ...headers, 'X-CSRF-Token': 'test-csrf' }))
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ clientSecret: 'pi_test_secret', platformFee: 0.5 }) })
  mocks.confirm.mockResolvedValue({ error: { message: 'Your card was declined.' } })
  ;({ Checkout } = await import('@/components/features/payments/checkout'))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('Existing checkout workflow', () => {
  it('waits for authentication initialization before creating checkout', async () => {
    mocks.initialized = false
    const view = render(<Checkout listingId="listing-1" />)
    expect(screen.getByRole('status')).toHaveTextContent('Preparing checkout')
    expect(mocks.fetch).not.toHaveBeenCalled()
    mocks.initialized = true
    view.rerender(<Checkout listingId="listing-1" />)
    await screen.findByTestId('payment-element')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('removes the old buyer payment form immediately when authentication changes', async () => {
    const view = render(<Checkout listingId="listing-1" />)
    await screen.findByTestId('payment-element')
    mocks.userId = null
    view.rerender(<Checkout listingId="listing-1" />)
    expect(screen.queryByTestId('payment-element')).not.toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in')
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('rechecks the buyer identity before Stripe confirmation', async () => {
    render(<Checkout listingId="listing-1" />)
    await screen.findByTestId('payment-element')
    mocks.session.mockResolvedValue({ data: { session: { access_token: 'other-token', user: { id: 'other-user' } } } })
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Your account changed')
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('does not confirm a pending old session after checkout unmounts for an account change', async () => {
    const view = render(<Checkout listingId="listing-1" />)
    await screen.findByTestId('payment-element')
    let finish!: (value: unknown) => void
    mocks.session.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }))
    mocks.userId = null
    view.rerender(<Checkout listingId="listing-1" />)
    finish({ data: { session: { access_token: 'test-token', user: { id: 'auth-buyer' } } } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in')
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it.each(['en', 'el'])('uses the accepted agreement identity and displays the server total in %s', async locale => {
    mocks.locale = locale
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ clientSecret: 'agreement_secret', totalAmount: 47.5, platformFee: 2.38 }) })
    render(<Checkout listingId="listing-1" chatId="chat-1" agreementId="agreement-1" />)
    expect(await screen.findByText(locale === 'el' ? 'Συμφωνημένο συνολικό ποσό' : 'Agreed service total')).toBeInTheDocument()
    expect(screen.getByText(locale === 'el' ? /47,50.*€/ : '€47.50')).toBeInTheDocument()
    expect(mocks.fetch).toHaveBeenCalledWith('/api/payments/create-intent', expect.objectContaining({ body: JSON.stringify({ listingId: 'listing-1', chatId: 'chat-1', agreementId: 'agreement-1' }) }))
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).not.toHaveProperty('amount')
    expect(mocks.proposal).not.toHaveBeenCalled()
  })

  it('shows a fixed listing total returned by the payment API', async () => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ clientSecret: 'fixed_secret', totalAmount: 100, platformFee: 5 }) })
    render(<Checkout listingId="listing-1" />)
    expect(await screen.findByText('Total to pay')).toBeInTheDocument()
    expect(screen.getByText('€100.00')).toBeInTheDocument()
  })

  it.each([undefined, 0, -10, '40', 12.345, 1000000])('does not expose the payment form for an unverified agreement total %s', async totalAmount => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ clientSecret: 'agreement_secret', totalAmount, platformFee: 2 }) })
    render(<Checkout listingId="listing-1" chatId="chat-1" agreementId="agreement-1" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('payment total could not be verified')
    expect(screen.queryByTestId('payment-element')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Return to conversation' })).toHaveAttribute('href', '/chat?chat=chat-1')
  })

  it.each([
    { milestoneId: 'milestone-1', chatId: 'chat-1', expected: 'either an agreement or a milestone' },
    { milestoneId: undefined, chatId: undefined, expected: 'conversation for this agreement' },
  ])('rejects invalid agreement route combinations before requesting a payment', async input => {
    render(<Checkout listingId="listing-1" agreementId="agreement-1" chatId={input.chatId} milestoneId={input.milestoneId} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(input.expected)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.proposal).not.toHaveBeenCalled()
  })

  it('ignores an old agreement checkout response after its identity changes', async () => {
    let finish!: (value: unknown) => void
    mocks.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ clientSecret: 'second_secret', totalAmount: 60, platformFee: 3 }) })
    const view = render(<Checkout listingId="listing-1" chatId="chat-1" agreementId="agreement-1" />)
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1))
    view.rerender(<Checkout listingId="listing-1" chatId="chat-1" agreementId="agreement-2" />)
    expect(await screen.findByText('€60.00')).toBeInTheDocument()
    finish({ ok: true, json: async () => ({ clientSecret: 'old_secret', totalAmount: 40, platformFee: 2 }) })
    await waitFor(() => expect(mocks.elements).toHaveBeenLastCalledWith(expect.objectContaining({ clientSecret: 'second_secret' })))
    expect(screen.queryByText('€40.00')).not.toBeInTheDocument()
  })

  it('explains a rate-only listing in Greek instead of opening a fixed-total payment form', async () => {
    mocks.locale = 'el'
    mocks.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'This listing uses a rate per unit. Agree on a total in chat before online payment.' }) })
    render(<Checkout listingId="rate-listing" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('χρέωση ανά μονάδα')
    expect(screen.queryByTestId('payment-element')).not.toBeInTheDocument()
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

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
