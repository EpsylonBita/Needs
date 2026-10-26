import { act, render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  locale: 'en', authUser: 'user-1', context: {} as Record<string, unknown>, fetch: vi.fn(), send: vi.fn(), csrf: vi.fn(), session: vi.fn(),
}))
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ locale: state.locale, t: (_key: string, fallback: string) => fallback }) }))
vi.mock('@/lib/utils/csrf', () => ({ withCsrfHeaders: state.csrf }))
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { getSession: state.session } } }))

import { ChatTransactionPanel, type ChatTransactionPanelProps } from '@/components/features/chat/chat-transaction-panel'

const props = (): ChatTransactionPanelProps => ({ chatId: 'wanted-chat', listingId: 'wanted-listing', profileId: 'buyer', userId: 'user-1', onSendMessage: state.send })
const response = (data: unknown, ok = true) => ({ ok, json: async () => data })
const panel = (overrides: Partial<ChatTransactionPanelProps> = {}) => <ChatTransactionPanel {...props()} {...overrides} />
async function enterMilestone() {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Add Milestone' }))
  await user.type(screen.getByLabelText('Milestone title'), 'First delivery')
  await user.type(screen.getByLabelText('Amount'), '20')
  await user.click(screen.getByRole('button', { name: 'Save' }))
}
beforeEach(() => {
  vi.resetAllMocks()
  state.locale = 'en'
  state.authUser = 'user-1'
  state.context = { listingId: 'wanted-listing', chatId: 'wanted-chat', buyerId: 'buyer', sellerId: 'seller', currentProfileId: 'buyer', isFree: false, canPay: true, sellerOnboarded: true, paymentsEnabled: true, milestonesEnabled: false, title: 'Wanted listing', amount: 20, subCategory: 'Sell' }
  state.session.mockImplementation(async () => ({ data: { session: { access_token: 'test-token', user: { id: state.authUser } } }, error: null }))
  state.fetch.mockImplementation(async (url: string) => url.startsWith('/api/payments/context?')
    ? response({ ...state.context }) : response({ error: { message: 'Milestones are disabled' } }, false))
  state.csrf.mockImplementation(async (headers: Record<string, string>) => ({ ...headers, 'X-CSRF-Token': 'test-csrf' }))
  state.send.mockResolvedValue(undefined)
  vi.stubGlobal('fetch', state.fetch)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('listing conversation transactions', () => {
  it.each(['en', 'el'])('does not present a stored zero-rate listing as a free exchange in %s', async locale => {
    state.locale = locale;
    state.context = { ...state.context, requiresAgreement: true, priceNeedsConfirmation: true, priceUnit: 'hour', amount: 0, canPay: false, milestonesEnabled: true };
    render(panel());
    expect(await screen.findByText(locale === 'el' ? /Η τιμή χρειάζεται επιβεβαίωση/ : /Price needs confirmation/)).toBeInTheDocument();
    expect(screen.queryByText(/free exchange|δωρεάν παραχώρηση/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Get|Αγορά|Pay provider|Πληρωμή παρόχου/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add Milestone|Προσθήκη σταδίου/ })).not.toBeInTheDocument();
  });

  it.each(['en', 'el'])('explains hourly pricing and hides fixed-total checkout and milestones in %s', async locale => {
    state.locale = locale
    state.context = { ...state.context, requiresAgreement: true, priceUnit: 'hour', amount: 10, canPay: false, milestonesEnabled: true, subCategory: 'I can' }
    render(panel())
    expect(await screen.findByText(locale === 'el' ? /10,00.*€\/ώρα/ : /€10.00\/hour/)).toBeInTheDocument()
    expect(screen.getByText(locale === 'el' ? /Συμφωνήστε το συνολικό κόστος/ : /Agree on the total cost/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Get|Αγορά|Pay provider|Πληρωμή παρόχου/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add Milestone|Προσθήκη σταδίου/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/free exchange|δωρεάν παραχώρηση/)).not.toBeInTheDocument()
  })

  it('clears listing actions when switching to a general conversation', async () => {
    const view = render(panel())
    await screen.findByRole('link', { name: 'View Seller' })
    view.rerender(panel({ chatId: 'general-chat', listingId: null }))
    expect(screen.queryByRole('link', { name: 'View Seller' })).not.toBeInTheDocument()
  })

  it('reports rejected milestone saves without posting a false-success message', async () => {
    state.context.milestonesEnabled = true
    render(panel())
    await enterMilestone()
    expect(await screen.findByRole('alert')).toHaveTextContent('Milestones are disabled')
    expect(state.send).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Milestone title')).toHaveValue('First delivery')
    expect(state.fetch).toHaveBeenCalledWith('/api/milestones/create', expect.objectContaining({
      body: JSON.stringify({ listingId: 'wanted-listing', title: 'First delivery', amount: 20, chatId: 'wanted-chat' }),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token', 'X-CSRF-Token': 'test-csrf' },
    }))
  })

  it('posts the milestone message into its pinned conversation only after the API succeeds', async () => {
    state.context.milestonesEnabled = true
    let finish!: (value: unknown) => void
    state.fetch.mockImplementation(async (url: string) => url.startsWith('/api/payments/context?')
      ? response({ ...state.context }) : new Promise(resolve => { finish = resolve }))
    render(panel())
    await enterMilestone()
    expect(state.send).not.toHaveBeenCalled()
    await act(async () => finish(response({ id: 'milestone-1' })))
    await waitFor(() => expect(state.send).toHaveBeenCalledWith('wanted-chat', '[MILESTONE] First delivery - 20'))
    expect(screen.queryByLabelText('Milestone title')).not.toBeInTheDocument()
  })

  it('explains a saved milestone whose follow-up message failed without offering the old form for duplicate creation', async () => {
    state.context.milestonesEnabled = true
    state.fetch.mockImplementation(async (url: string) => url.startsWith('/api/payments/context?') ? response({ ...state.context }) : response({ id: 'milestone-1' }))
    state.send.mockRejectedValue(new Error('Message unavailable'))
    render(panel())
    await enterMilestone()
    expect(await screen.findByRole('alert')).toHaveTextContent('Milestone saved, but its chat message failed')
    expect(screen.queryByLabelText('Milestone title')).not.toBeInTheDocument()
  })

  it('opens checkout with the selected offer conversation for its buyer', async () => {
    render(panel())
    expect(await screen.findByRole('link', { name: 'Get' })).toHaveAttribute('href', '/payments/checkout/wanted-listing?chatId=wanted-chat')
    expect(state.fetch).toHaveBeenCalledWith('/api/payments/context?listingId=wanted-listing&chatId=wanted-chat', expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }))
  })

  it('lets the request publisher pay the provider from the selected incoming conversation', async () => {
    state.context.subCategory = 'I want'
    render(panel())
    expect(await screen.findByRole('link', { name: 'Pay provider' })).toHaveAttribute('href', '/payments/checkout/wanted-listing?chatId=wanted-chat')
    expect(screen.getByRole('link', { name: 'View Seller' })).toHaveAttribute('href', '/profile/seller')
  })

  it('does not ask the responding provider to pay for a request', async () => {
    state.context = { ...state.context, currentProfileId: 'seller', canPay: false, subCategory: 'Buy', milestonesEnabled: true }
    render(panel({ profileId: 'seller' }))
    expect(await screen.findByText('The requester pays you after you agree on the work or item.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Get|Pay provider/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Milestone' })).not.toBeInTheDocument()
  })

  it('shows the buyer payment instruction to the owner of an offer', async () => {
    state.context = { ...state.context, currentProfileId: 'seller', canPay: false }
    render(panel({ profileId: 'seller' }))
    expect(await screen.findByText('The buyer can continue to payment from their conversation.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Get' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View Buyer' })).toHaveAttribute('href', '/profile/buyer')
  })

  it('keeps free exchanges in chat without payment or milestone actions', async () => {
    state.context = { ...state.context, subCategory: 'Free', isFree: true, canPay: false, milestonesEnabled: true }
    render(panel())
    expect(await screen.findByText('Arrange the free exchange in this conversation.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Get|Pay provider/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Milestone' })).not.toBeInTheDocument()
  })

  it('shows context errors without exposing payment actions', async () => {
    state.fetch.mockResolvedValue(response({ error: { message: 'Conversation is unavailable' } }, false))
    render(panel())
    expect(await screen.findByRole('alert')).toHaveTextContent('Conversation is unavailable')
    expect(screen.queryByRole('link', { name: /Get|Pay provider/ })).not.toBeInTheDocument()
  })

  it('does not enable payment actions from an incomplete context', async () => {
    delete state.context.paymentsEnabled
    render(panel())
    expect(await screen.findByRole('alert')).toHaveTextContent('Payment details could not be verified')
    expect(screen.queryByRole('link', { name: 'Get' })).not.toBeInTheDocument()
  })

  it('explains unavailable payments without sending the payer to checkout', async () => {
    state.context.paymentsEnabled = false
    state.context.milestonesEnabled = true
    render(panel())
    expect(await screen.findByText('Payments are currently unavailable.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Get' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Milestone' })).not.toBeInTheDocument()
  })

  it.each(['buyer', 'seller'])('keeps checkout unavailable until the provider sets up payments, viewed by %s', async profileId => {
    state.context = { ...state.context, sellerOnboarded: false, currentProfileId: profileId, canPay: profileId === 'buyer' }
    render(panel({ profileId }))
    if (profileId === 'seller') expect(await screen.findByRole('link', { name: 'Set up receiving payments' })).toHaveAttribute('href', '/payments/onboarding')
    else expect(await screen.findByText('The provider has not set up payments yet.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Get' })).not.toBeInTheDocument()
  })

  it('resolves a different provider when switching conversations for the same request', async () => {
    state.context.subCategory = 'I want'
    const view = render(panel())
    await screen.findByRole('link', { name: 'Pay provider' })
    let finish!: (value: unknown) => void
    state.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    view.rerender(panel({ chatId: 'second-chat' }))
    expect(screen.queryByRole('link', { name: 'Pay provider' })).not.toBeInTheDocument()
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(2))
    await act(async () => finish(response({ ...state.context, chatId: 'second-chat', sellerId: 'second-seller' })))
    expect(await screen.findByRole('link', { name: 'Pay provider' })).toHaveAttribute('href', '/payments/checkout/wanted-listing?chatId=second-chat')
    expect(screen.getByRole('link', { name: 'View Seller' })).toHaveAttribute('href', '/profile/second-seller')
  })

  it.each(['chat', 'account'])('ignores delayed milestone results after the %s changes', async change => {
    state.context.milestonesEnabled = true
    let finish!: (value: unknown) => void
    state.fetch.mockImplementation(async (url: string) => url.startsWith('/api/payments/context?')
      ? response({ ...state.context }) : new Promise(resolve => { finish = resolve }))
    const view = render(panel())
    await enterMilestone()
    if (change === 'account') { state.authUser = 'user-2'; state.context = { ...state.context, currentProfileId: 'buyer-2', buyerId: 'buyer-2' } }
    else state.context.chatId = 'second-chat'
    view.rerender(panel(change === 'account' ? { userId: 'user-2', profileId: 'buyer-2' } : { chatId: 'second-chat' }))
    await screen.findByRole('link', { name: 'Get' })
    await act(async () => finish(response({ id: 'milestone-1' })))
    expect(state.send).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Milestone title')).not.toBeInTheDocument()
  })

  it.each([true, false])('ignores a previous account payment-context result (success=%s)', async success => {
    let finish!: (value: unknown) => void
    const oldContext = { ...state.context }
    state.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const view = render(panel())
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(1))
    state.authUser = 'user-2'
    state.context = { ...state.context, currentProfileId: 'buyer-2', buyerId: 'buyer-2', sellerId: 'second-seller' }
    view.rerender(panel({ userId: 'user-2', profileId: 'buyer-2' }))
    expect(await screen.findByRole('link', { name: 'View Seller' })).toHaveAttribute('href', '/profile/second-seller')
    await act(async () => finish(response(success ? oldContext : { error: 'Old account error' }, success)))
    expect(screen.getByRole('link', { name: 'View Seller' })).toHaveAttribute('href', '/profile/second-seller')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('checks the signed-in account again before creating a milestone', async () => {
    state.context.milestonesEnabled = true
    render(panel())
    await screen.findByRole('button', { name: 'Add Milestone' })
    state.authUser = 'user-2'
    await enterMilestone()
    expect(await screen.findByRole('alert')).toHaveTextContent('Your account changed')
    expect(state.fetch.mock.calls.every(([url]) => url.startsWith('/api/payments/context?'))).toBe(true)
    expect(state.send).not.toHaveBeenCalled()
  })

  it('localizes milestone controls and validation in Greek', async () => {
    state.locale = 'el'
    state.context.milestonesEnabled = true
    const user = userEvent.setup()
    render(panel())
    await user.click(await screen.findByRole('button', { name: 'Προσθήκη σταδίου' }))
    expect(screen.getByLabelText('Τίτλος σταδίου')).toBeInTheDocument()
    expect(screen.getByLabelText('Ποσό')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Συμπλήρωσε έναν τίτλο σταδίου και ένα θετικό ποσό')
    expect(state.send).not.toHaveBeenCalled()
  })
})
