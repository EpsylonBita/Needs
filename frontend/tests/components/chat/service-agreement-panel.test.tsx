import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ locale: 'en', userId: 'auth-buyer', context: {} as Record<string, unknown>, fetch: vi.fn(), send: vi.fn(), csrf: vi.fn() }))
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ locale: state.locale, t: (_key: string, fallback: string) => fallback }) }))
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'token', user: { id: state.userId } } } }) } } }))
vi.mock('@/lib/utils/csrf', () => ({ withCsrfHeaders: state.csrf }))
import { ChatTransactionPanel } from '@/components/features/chat/chat-transaction-panel'

const agreement = (changes: Record<string, unknown> = {}) => ({ id: 'agreement-1', status: 'proposed', amount: 40, currency: 'eur', proposedBy: 'seller', acceptedBy: null, createdAt: '2026-10-26T12:00:00Z', checkoutStartedAt: null, stale: false, ...changes })
const panel = (changes = {}) => <ChatTransactionPanel chatId="chat-1" listingId="listing-1" profileId="buyer" userId="auth-buyer" onSendMessage={state.send} {...changes} />
const response = (data: unknown, ok = true) => ({ ok, json: async () => data })
const posts = () => state.fetch.mock.calls.filter(([url]) => url === '/api/payments/agreements')
async function openProposal() {
  fireEvent.click(await screen.findByRole('button', { name: /^(Propose a total|Propose another total|Πρότεινε συνολικό ποσό|Πρότεινε άλλο ποσό)$/ }))
  return screen.getByLabelText(state.locale === 'el' ? 'Συνολικό ποσό (€)' : 'Total amount (€)')
}
beforeEach(() => {
  vi.resetAllMocks()
  state.locale = 'en'; state.userId = 'auth-buyer'
  state.context = { listingId: 'listing-1', chatId: 'chat-1', buyerId: 'buyer', sellerId: 'seller', currentProfileId: 'buyer', title: 'Home care', amount: 10, subCategory: 'I can', isFree: false, canPay: false, paymentsEnabled: true, milestonesEnabled: false, sellerOnboarded: true, requiresAgreement: true, priceUnit: 'hour', serviceAgreementEligible: true, agreement: null, canProposeAgreement: true, canAcceptAgreement: false, canRejectAgreement: false, canWithdrawAgreement: false }
  state.csrf.mockImplementation(async headers => ({ ...headers, 'X-CSRF-Token': 'csrf' }))
  state.fetch.mockImplementation(async (url: string) => url.startsWith('/api/payments/context?') ? response({ ...state.context }) : response({ ok: true }))
  vi.stubGlobal('fetch', state.fetch)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('service total agreement in a conversation', () => {
  it('reconciles a locked checkout only through explicit refresh and offers a new proposal after verified cancellation', async () => {
    state.context = { ...state.context, agreement: agreement({ status: 'accepted', acceptedBy: 'buyer', checkoutStartedAt: '2026-10-26T13:00:00Z' }), canPay: true, canProposeAgreement: false }
    state.fetch.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/payments/context?')) return response({ ...state.context })
      state.context = { ...state.context, agreement: agreement({ status: 'accepted', acceptedBy: 'buyer' }), canProposeAgreement: true }
      return response({ ok: true })
    })
    render(panel())
    await screen.findByText('Checkout has started. This total can no longer be changed here.')
    await act(async () => { fireEvent.focus(window) })
    expect(posts()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }))
    expect(await screen.findByRole('button', { name: 'Propose another total' })).toBeInTheDocument()
    expect(JSON.parse(posts()[0][1].body)).toEqual({ listingId: 'listing-1', chatId: 'chat-1', action: 'reconcile', agreementId: 'agreement-1' })
  })

  it('proposes a comma-decimal total with CAS and CSRF independently of milestones', async () => {
    state.fetch.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/payments/context?')) return response({ ...state.context })
      state.context.agreement = agreement({ amount: 25.5, proposedBy: 'buyer' })
      return response({ ok: true })
    })
    render(panel())
    fireEvent.change(await openProposal(), { target: { value: '25,50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send proposal' }))
    expect(await screen.findByText('Waiting for the other person to accept your proposal.')).toBeInTheDocument()
    expect(JSON.parse(posts()[0][1].body)).toEqual({ listingId: 'listing-1', chatId: 'chat-1', action: 'propose', amount: 25.5, expectedAgreementId: null })
    expect(posts()[0][1].headers).toMatchObject({ Authorization: 'Bearer token', 'X-CSRF-Token': 'csrf' })
    expect(screen.queryByRole('button', { name: 'Add Milestone' })).not.toBeInTheDocument()
    expect(state.send).not.toHaveBeenCalled()
  })

  it.each(['', '0', '0,49', '1000000', '12.345', '1e2'])('rejects an invalid proposed total %j and preserves the input', async amount => {
    render(panel())
    const input = await openProposal()
    fireEvent.change(input, { target: { value: amount } })
    fireEvent.click(screen.getByRole('button', { name: 'Send proposal' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a total from €0.50')
    expect(input).toHaveValue(amount)
    expect(posts()).toHaveLength(0)
  })

  it.each(['en', 'el'])('lets the other participant accept, then shows the accepted total checkout in %s', async locale => {
    state.locale = locale
    state.context = { ...state.context, agreement: agreement(), canAcceptAgreement: true, canRejectAgreement: true, milestonesEnabled: true }
    state.fetch.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/payments/context?')) return response({ ...state.context })
      state.context = { ...state.context, agreement: agreement({ status: 'accepted', acceptedBy: 'buyer' }), canAcceptAgreement: false, canRejectAgreement: false, canPay: true }
      return response({ ok: true })
    })
    render(panel())
    fireEvent.click(await screen.findByRole('button', { name: locale === 'el' ? 'Αποδοχή ποσού' : 'Accept total' }))
    const pay = await screen.findByRole('link', { name: locale === 'el' ? /Πληρωμή 40,00/ : 'Pay €40.00' })
    expect(pay).toHaveAttribute('href', '/payments/checkout/listing-1?chatId=chat-1&agreementId=agreement-1')
    expect(JSON.parse(posts()[0][1].body)).toEqual({ listingId: 'listing-1', chatId: 'chat-1', action: 'accept', agreementId: 'agreement-1' })
    expect(screen.queryByRole('button', { name: /Add Milestone|Προσθήκη σταδίου/ })).not.toBeInTheDocument()
  })

  it('does not offer acceptance of one’s own proposal even if a capability is incorrectly true', async () => {
    state.context = { ...state.context, agreement: agreement({ proposedBy: 'buyer' }), canAcceptAgreement: true, canRejectAgreement: true }
    render(panel())
    await screen.findByText('Waiting for the other person to accept your proposal.')
    expect(screen.queryByRole('button', { name: 'Accept total' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument()
  })

  it.each(['reject', 'withdraw'])('sends the exact current agreement for %s', async action => {
    state.context = { ...state.context, agreement: agreement({ proposedBy: action === 'withdraw' ? 'buyer' : 'seller' }), canRejectAgreement: action === 'reject', canWithdrawAgreement: action === 'withdraw' }
    render(panel())
    fireEvent.click(await screen.findByRole('button', { name: action === 'reject' ? 'Decline' : 'Withdraw' }))
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(JSON.parse(posts()[0][1].body)).toEqual({ listingId: 'listing-1', chatId: 'chat-1', action, agreementId: 'agreement-1' })
  })

  it.each(['en', 'el'])('pins the proposal version while refreshes update the current agreement in %s', async locale => {
    state.locale = locale
    state.context.agreement = agreement()
    render(panel())
    const input = await openProposal()
    fireEvent.change(input, { target: { value: '50' } })
    state.context.agreement = agreement({ id: 'agreement-2', amount: 45 })
    fireEvent.click(screen.getByRole('button', { name: locale === 'el' ? 'Ανανέωση κατάστασης' : 'Refresh status' }))
    await screen.findByText(locale === 'el' ? /45,00.*€/ : '€45.00')
    state.fetch.mockImplementation(async (url: string) => url.startsWith('/api/payments/context?') ? response({ ...state.context }) : response({ error: 'The agreement changed. Refresh the conversation and try again.' }, false))
    fireEvent.click(screen.getByRole('button', { name: locale === 'el' ? 'Αποστολή πρότασης' : 'Send proposal' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(locale === 'el' ? 'Η συμφωνία άλλαξε' : 'agreement changed')
    expect(JSON.parse(posts()[0][1].body).expectedAgreementId).toBe('agreement-1')
    expect(input).toHaveValue('50')
  })

  it('lets the provider propose a total while reserving accepted checkout for the buyer', async () => {
    state.userId = 'auth-seller'
    state.context = { ...state.context, currentProfileId: 'seller', subCategory: 'I want' }
    state.fetch.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/payments/context?')) return response({ ...state.context })
      state.context.agreement = agreement({ status: 'accepted', acceptedBy: 'buyer' })
      return response({ ok: true })
    })
    render(panel({ userId: 'auth-seller', profileId: 'seller' }))
    fireEvent.change(await openProposal(), { target: { value: '40' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send proposal' }))
    expect(await screen.findByText('Total accepted')).toBeInTheDocument()
    expect(posts()).toHaveLength(1)
    expect(screen.queryByRole('link', { name: /Pay €40/ })).not.toBeInTheDocument()
  })

  it('reports a saved mutation whose refresh fails without inviting duplicate submission', async () => {
    let saved = false
    state.fetch.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/payments/context?')) return saved ? response({ error: 'Context unavailable' }, false) : response({ ...state.context })
      saved = true
      return response({ ok: true })
    })
    render(panel())
    fireEvent.change(await openProposal(), { target: { value: '40' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send proposal' }))
    expect(await screen.findByText('Your change was saved, but its latest status could not be loaded. Refresh before trying again.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Total amount (€)')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send proposal' })).not.toBeInTheDocument()
    expect(posts()).toHaveLength(1)
  })

  it('hides checkout when payments are unavailable or the provider is not ready', async () => {
    state.context = { ...state.context, agreement: agreement({ status: 'accepted', acceptedBy: 'buyer' }), canPay: true, sellerOnboarded: false }
    render(panel())
    expect(await screen.findByText('The provider has not set up payments yet.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Pay €40.00' })).not.toBeInTheDocument()
    state.context = { ...state.context, sellerOnboarded: true, paymentsEnabled: false }
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }))
    expect(await screen.findByText('Payments are currently unavailable.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Pay €40.00' })).not.toBeInTheDocument()
  })

  it.each(['stale', 'locked'])('protects %s agreements from invalid actions', async kind => {
    state.context = { ...state.context, agreement: agreement({ status: 'accepted', acceptedBy: 'buyer', stale: kind === 'stale', checkoutStartedAt: kind === 'locked' ? '2026-10-26T13:00:00Z' : null }), canPay: true, canAcceptAgreement: true, canWithdrawAgreement: true }
    render(panel())
    await screen.findByText('Total accepted')
    expect(screen.queryByRole('button', { name: 'Accept total' })).not.toBeInTheDocument()
    if (kind === 'stale') expect(screen.queryByRole('link', { name: 'Pay €40.00' })).not.toBeInTheDocument()
    else {
      expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Propose another total' })).not.toBeInTheDocument()
    }
  })

  it('locks duplicate submission and ignores its result after switching conversations', async () => {
    let finish!: (value: unknown) => void
    state.fetch.mockImplementation(async (url: string) => url.startsWith('/api/payments/context?') ? response({ ...state.context }) : new Promise(resolve => { finish = resolve }))
    const view = render(panel())
    fireEvent.change(await openProposal(), { target: { value: '40' } })
    const send = screen.getByRole('button', { name: 'Send proposal' })
    fireEvent.click(send); fireEvent.click(send)
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeDisabled()
    state.context = { ...state.context, chatId: 'chat-2' }
    view.rerender(panel({ chatId: 'chat-2' }))
    await screen.findByRole('button', { name: 'Propose a total' })
    await act(async () => finish(response({ ok: true })))
    expect(screen.queryByText('Agreement saved.')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Total amount (€)')).not.toBeInTheDocument()
  })

  it('checks session identity and CSRF before mutations', async () => {
    render(panel())
    fireEvent.change(await openProposal(), { target: { value: '40' } })
    state.userId = 'other-account'
    fireEvent.click(screen.getByRole('button', { name: 'Send proposal' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Your account changed')
    expect(posts()).toHaveLength(0)
    state.userId = 'auth-buyer'
    state.csrf.mockResolvedValue({ Authorization: 'Bearer token' })
    fireEvent.click(screen.getByRole('button', { name: 'Send proposal' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('secure request')
    expect(posts()).toHaveLength(0)
  })

  it('refreshes visible rate agreements on focus and every 15 seconds, cleaning up on unmount', async () => {
    vi.useFakeTimers()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const view = render(panel())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(state.fetch).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    expect(state.fetch).toHaveBeenCalledTimes(2)
    visibility.mockReturnValue('hidden')
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    expect(state.fetch).toHaveBeenCalledTimes(2)
    visibility.mockReturnValue('visible')
    await act(async () => { fireEvent.focus(window) })
    expect(state.fetch).toHaveBeenCalledTimes(3)
    view.unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    expect(state.fetch).toHaveBeenCalledTimes(3)
  })
})
