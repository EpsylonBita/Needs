import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrderDTO, OrderPage } from '@/lib/orders/types'

const state = vi.hoisted(() => ({ userId: 'account-one' as string | null, initialized: true, locale: 'en', list: vi.fn(), detail: vi.fn(), confirm: vi.fn(), capture: vi.fn(), report: vi.fn(), review: vi.fn() }))
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: state.userId ? { id: state.userId } : null, isInitialized: state.initialized }) }))
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ locale: state.locale }) }))
vi.mock('@/lib/services/order-service', () => ({ getMyOrders: state.list, getMyOrder: state.detail, confirmOrder: state.confirm, captureOrder: state.capture, reportOrderProblem: state.report, submitOrderReview: state.review, ORDER_REVIEW_MAX_LENGTH: 4000 }))

import { OrdersList } from '@/components/features/orders/orders-list'
import { OrderDetail } from '@/components/features/orders/order-detail'

const firstId = '11111111-1111-4111-8111-111111111111'
const secondId = '22222222-2222-4222-8222-222222222222'
const chatId = '33333333-3333-4333-8333-333333333333'
function order(overrides: Partial<OrderDTO> = {}): OrderDTO {
  return {
    id: firstId, created_at: '2026-10-19T18:00:00Z', status: 'requires_capture', amount: 25, currency: 'eur', platform_fee: 1.25, payments_enabled: true,
    listing: { id: 'listing-one', title: 'Desk collection', thumbnail: 'https://example.com/desk.jpg', available: true },
    buyer: { id: 'payer-profile', display_name: 'Maria', avatar_url: null }, seller: { id: 'provider-profile', display_name: 'Nikos', avatar_url: 'https://example.com/avatar.jpg' },
    my_role: 'buyer', chat_id: chatId, milestone: null, buyer_confirmed: false, seller_confirmed: true, role_review_required: false, authorization_state: 'authorized', capture_pending: false,
    complaint: null, disputes: [], refund: { succeeded_amount: 0, pending_amount: 0, failed: false }, review: null,
    actions: { can_confirm: true, can_capture: false, can_complain: true, can_review: false }, ...overrides,
  }
}
function page(rows: OrderDTO[] = [order()], next: OrderPage['next_cursor'] = null): OrderPage { return { profile_id: 'payer-profile', payments_enabled: true, rows, next_cursor: next } }
const clients: QueryClient[] = []
function mount(detail = false, id = firstId) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })
  clients.push(client)
  const tree = () => <QueryClientProvider client={client}>{detail ? <OrderDetail id={id} /> : <OrdersList />}</QueryClientProvider>
  const view = render(tree())
  return { ...view, client, update: () => view.rerender(tree()) }
}
beforeEach(() => {
  vi.resetAllMocks(); state.userId = 'account-one'; state.initialized = true; state.locale = 'en'
  state.list.mockResolvedValue(page()); state.detail.mockResolvedValue(order())
  state.confirm.mockResolvedValue(order({ buyer_confirmed: true, actions: { can_confirm: false, can_capture: true, can_complain: true, can_review: false } }))
  state.capture.mockResolvedValue({ captured: true, pending: false, status: 'succeeded' })
  state.report.mockResolvedValue({ success: true, disputeId: 'complaint-one' }); state.review.mockResolvedValue({ success: true, reviewId: 'review-one' })
})
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()) })

describe('My orders list', () => {
  it('loads actual role, counterparty, amount and detail link without inventing a shipping status', async () => {
    mount()
    await screen.findByText('Desk collection')
    expect(screen.getByRole('link', { name: 'Desk collection' })).toHaveAttribute('href', `/dashboard/orders/${firstId}`)
    expect(screen.getByText('You are the payer')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Nikos' })).toHaveAttribute('href', '/profile/provider-profile')
    expect(screen.getByText('€25.00')).toBeInTheDocument()
    expect(screen.getByText('Payment authorized')).toBeInTheDocument()
    expect(state.list).toHaveBeenCalledWith('account-one', null, expect.any(AbortSignal))
    expect(screen.queryByText(/shipped|delivered/i)).not.toBeInTheDocument()
  })
  it('does not display an empty state while loading or after a failed first request', async () => {
    let fail!: (reason: Error) => void
    state.list.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject }))
    mount()
    expect(screen.getByRole('status')).toHaveTextContent('Loading orders')
    expect(screen.queryByText('No orders yet')).not.toBeInTheDocument()
    await act(async () => fail(new Error('Offline')))
    expect(await screen.findByRole('alert')).toHaveTextContent('Orders could not be loaded')
    expect(screen.queryByText('No orders yet')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('link', { name: 'Desk collection' })).toBeInTheDocument()
  })
  it('shows an honest empty state including the separate free exchange conversation flow', async () => {
    state.list.mockResolvedValue(page([])); mount()
    expect(await screen.findByText('No orders yet')).toBeInTheDocument()
    expect(screen.getByText(/Free exchanges are arranged in your conversations/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Explore listings' })).toHaveAttribute('href', '/search')
  })
  it('does not turn the missing legacy date sentinel into a fabricated 1970 order date', async () => {
    state.list.mockResolvedValue(page([order({ created_at: '1970-01-01T00:00:00Z' })])); mount()
    await screen.findByText('Desk collection')
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText(/1970/)).not.toBeInTheDocument()
  })
  it('filters the actual payer/provider roles without using who published the listing', async () => {
    state.list.mockResolvedValue(page([order(), order({ id: secondId, my_role: 'seller', listing: { ...order().listing, title: 'Requested repair' } })]))
    mount(); await screen.findByRole('link', { name: 'Desk collection' })
    fireEvent.click(screen.getByRole('button', { name: 'I am providing' }))
    expect(screen.queryByRole('link', { name: 'Desk collection' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Requested repair' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Maria' })).toBeInTheDocument()
  })
  it('uses the supplied cursor and keeps loaded results when loading more fails', async () => {
    const cursor = { created_at: order().created_at, id: firstId }
    state.list.mockResolvedValueOnce(page([order()], cursor)).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(page([order({ id: secondId, listing: { ...order().listing, title: 'Second payment' } })]))
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Load more orders' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('More orders could not be loaded')
    expect(screen.getByRole('link', { name: 'Desk collection' })).toBeInTheDocument()
    expect(state.list).toHaveBeenLastCalledWith('account-one', cursor, expect.any(AbortSignal))
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('link', { name: 'Second payment' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Desk collection' })).toBeInTheDocument()
  })
  it('isolates cached orders and filters across account changes', async () => {
    const view = mount(); await screen.findByRole('link', { name: 'Desk collection' })
    fireEvent.click(screen.getByRole('button', { name: 'I am providing' }))
    state.userId = 'account-two'; state.list.mockResolvedValue(page([order({ listing: { ...order().listing, title: 'Other account order' } })])); view.update()
    expect(await screen.findByRole('link', { name: 'Other account order' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('link', { name: 'Desk collection' })).not.toBeInTheDocument()
  })
  it('localizes the page and uses neutral authorization text for unverified records', async () => {
    state.locale = 'el'; state.list.mockResolvedValue(page([order({ authorization_state: 'unverified' })])); mount()
    expect(screen.getByRole('heading', { name: 'Οι παραγγελίες μου' })).toBeInTheDocument()
    expect(await screen.findByText('Αναμονή επαλήθευσης πληρωμής')).toBeInTheDocument()
    expect(screen.queryByText('Η πληρωμή εγκρίθηκε')).not.toBeInTheDocument()
  })
})

describe('Order details and real actions', () => {
  it('links only an allowed public listing and its recorded conversation', async () => {
    state.detail.mockResolvedValue(order({ listing: { ...order().listing, available: false }, milestone: { id: 'milestone-one', title: 'Delivery step', amount: 25, status: 'requires_capture' } }))
    mount(true)
    expect(await screen.findByText('Desk collection')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'View listing' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open conversation' })).toHaveAttribute('href', `/chat?chat=${chatId}`)
    expect(screen.getByText(/Delivery step/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Nikos' })).toHaveAttribute('href', '/profile/provider-profile')
  })
  it('requires explicit completion confirmation and sends the payment and expected account', async () => {
    mount(true); fireEvent.click(await screen.findByRole('button', { name: 'Confirm completion' }))
    const dialog = screen.getByRole('dialog', { name: 'Have you received the item or service?' })
    expect(within(dialog).getByText(/only after you have received/)).toBeInTheDocument()
    expect(state.confirm).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm completion' }))
    await waitFor(() => expect(state.confirm).toHaveBeenCalledWith(firstId, 'account-one'))
    expect(await screen.findByText('Your completion confirmation was saved.')).toBeInTheDocument()
  })
  it('keeps a failed confirmation dialog open without inventing completion', async () => {
    state.confirm.mockRejectedValue(new Error('Rejected'))
    mount(true); fireEvent.click(await screen.findByRole('button', { name: 'Confirm completion' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm completion' }))
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('could not be completed')
    expect(screen.getByText('Not confirmed yet')).toBeInTheDocument()
    expect(screen.queryByText('Your completion confirmation was saved.')).not.toBeInTheDocument()
  })
  it.each(['buyer', 'seller'] as const)('allows %s capture only through an explicit financial-effect dialog', async role => {
    state.detail.mockResolvedValue(order({ my_role: role, buyer_confirmed: true, seller_confirmed: true, actions: { can_confirm: false, can_capture: true, can_complain: role === 'buyer', can_review: false } }))
    mount(true); fireEvent.click(await screen.findByRole('button', { name: 'Finalize payment' }))
    const dialog = screen.getByRole('dialog', { name: 'Finalize this payment?' })
    expect(within(dialog).getByText(/collection of the authorized payment/)).toBeInTheDocument()
    expect(state.capture).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and finalize payment' }))
    await waitFor(() => expect(state.capture).toHaveBeenCalledWith(firstId, 'account-one'))
    expect(await screen.findByText(/Its final result is still being verified/)).toBeInTheDocument()
    expect(screen.queryByText('Payment completed')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check / complete payment' })).toBeEnabled()
  })
  it('reconciles a pending result only after explicit agreement to retry the existing payment', async () => {
    state.detail.mockResolvedValue(order({ capture_pending: true, buyer_confirmed: true, actions: { can_confirm: false, can_capture: true, can_complain: false, can_review: false } }))
    mount(true); fireEvent.click(await screen.findByRole('button', { name: 'Check / complete payment' }))
    const dialog = screen.getByRole('dialog', { name: 'Check or complete this payment?' })
    expect(within(dialog).getByText(/if needed, retries finalizing the payment you already requested/)).toBeInTheDocument()
    expect(state.capture).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check / complete payment' }))
    await waitFor(() => expect(state.capture).toHaveBeenCalledWith(firstId, 'account-one'))
  })
  it('keeps pending-result retries disabled while payments are disabled', async () => {
    state.detail.mockResolvedValue(order({ payments_enabled: false, capture_pending: true, buyer_confirmed: true, actions: { can_confirm: false, can_capture: true, can_complain: false, can_review: false } }))
    mount(true)
    expect(await screen.findByRole('button', { name: 'Check / complete payment' })).toBeDisabled()
    expect(state.capture).not.toHaveBeenCalled()
  })
  it('preserves the administrator review hold and localizes a late capture rejection', async () => {
    state.locale = 'el'
    state.detail.mockResolvedValue(order({ buyer_confirmed: true, actions: { can_confirm: false, can_capture: true, can_complain: true, can_review: false } }))
    state.capture.mockRejectedValue(new Error('This older request payment needs administrator review before it can be captured.'))
    mount(true); fireEvent.click(await screen.findByRole('button', { name: 'Οριστικοποίηση πληρωμής' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Επιβεβαίωση και οριστικοποίηση πληρωμής' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('χρειάζεται έλεγχο από διαχειριστή')
    expect(screen.queryByText('Η πληρωμή ολοκληρώθηκε')).not.toBeInTheDocument()
  })
  it('disables money actions for a legacy hold even if stale capabilities say otherwise', async () => {
    state.detail.mockResolvedValue(order({ role_review_required: true, actions: { can_confirm: true, can_capture: true, can_complain: true, can_review: false } }))
    mount(true)
    expect(await screen.findByText('This older request payment needs administrator review.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm completion' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Finalize payment' })).toBeDisabled()
    expect(state.confirm).not.toHaveBeenCalled(); expect(state.capture).not.toHaveBeenCalled()
  })
  it('keeps complaints and conversation available while payment actions are disabled', async () => {
    state.detail.mockResolvedValue(order({ payments_enabled: false })); mount(true)
    expect(await screen.findByRole('button', { name: 'Confirm completion' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Finalize payment' })).toBeDisabled()
    expect(screen.getByRole('link', { name: 'Open conversation' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Report a problem' }))
    const dialog = screen.getByRole('dialog', { name: 'Report a problem with this order?' })
    expect(within(dialog).getByText(/does not issue an automatic refund/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Report a problem' }))
    expect(await screen.findByText('Your complaint was recorded for review.')).toBeInTheDocument()
    expect(state.report).toHaveBeenCalledWith(firstId, 'account-one')
    expect(state.capture).not.toHaveBeenCalled()
  })
  it('shows a failed complaint visibly and preserves the dialog for retry', async () => {
    state.report.mockRejectedValueOnce(new Error('Server rejected'))
    mount(true); fireEvent.click(await screen.findByRole('button', { name: 'Report a problem' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Report a problem' }))
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('could not be completed')
    expect(screen.queryByText('Your complaint was recorded for review.')).not.toBeInTheDocument()
  })
  it('displays complaint and partial refund information without changing completed payment status', async () => {
    state.detail.mockResolvedValue(order({ status: 'completed', authorization_state: 'settled', complaint: { id: 'complaint-one', status: 'open' }, disputes: [{ id: 'complaint-one', status: 'open', is_bank_dispute: false, created_at: order().created_at, resolved_at: null }], refund: { succeeded_amount: 5, pending_amount: 2, failed: true }, actions: { can_confirm: false, can_capture: false, can_complain: false, can_review: false } }))
    mount(true)
    expect(await screen.findByText('Payment completed')).toBeInTheDocument()
    expect(screen.getByText('Marketplace complaint')).toBeInTheDocument()
    expect(screen.getByText('Refund completed')).toBeInTheDocument()
    expect(screen.getByText('€5.00')).toBeInTheDocument()
    expect(screen.getByText('Refund pending')).toBeInTheDocument()
    expect(screen.getByText('€2.00')).toBeInTheDocument()
    expect(screen.queryByText('Payment refunded')).not.toBeInTheDocument()
  })
  it('submits an eligible review for this exact payment while payments are disabled', async () => {
    state.detail.mockResolvedValue(order({ status: 'completed', payments_enabled: false, authorization_state: 'settled', actions: { can_confirm: false, can_capture: false, can_complain: true, can_review: true } }))
    mount(true); fireEvent.click(await screen.findByRole('button', { name: 'Leave a review' }))
    fireEvent.change(screen.getByLabelText('Rating'), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('Comment (optional)'), { target: { value: 'Helpful and punctual.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Publish review' }))
    expect(await screen.findByText('Your review was published.')).toBeInTheDocument()
    expect(state.review).toHaveBeenCalledWith(firstId, 4, 'Helpful and punctual.', 'account-one')
  })
  it('keeps review text and rating when publishing fails', async () => {
    state.detail.mockResolvedValue(order({ status: 'completed', actions: { can_confirm: false, can_capture: false, can_complain: true, can_review: true } })); state.review.mockRejectedValue(new Error('Offline'))
    mount(true); fireEvent.click(await screen.findByRole('button', { name: 'Leave a review' }))
    fireEvent.change(screen.getByLabelText('Rating'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('Comment (optional)'), { target: { value: 'My unsaved review' } })
    fireEvent.click(screen.getByRole('button', { name: 'Publish review' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be completed')
    expect(screen.getByLabelText('Comment (optional)')).toHaveValue('My unsaved review')
    expect(screen.getByLabelText('Rating')).toHaveValue('5')
  })
  it('does not carry a pending action or its feedback into another account', async () => {
    let finish!: (value: unknown) => void
    state.confirm.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const view = mount(true); fireEvent.click(await screen.findByRole('button', { name: 'Confirm completion' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm completion' }))
    await waitFor(() => expect(state.confirm).toHaveBeenCalled())
    state.userId = 'account-two'; state.detail.mockResolvedValue(order({ listing: { ...order().listing, title: 'Other account order' } })); view.update()
    await screen.findByText('Other account order')
    await act(async () => finish(order({ buyer_confirmed: true })))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Your completion confirmation was saved.')).not.toBeInTheDocument()
    expect(screen.getByText('Other account order')).toBeInTheDocument()
  })
  it('preserves the order destination when signed out and does not fetch private rows', () => {
    state.userId = null; mount(true)
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', `/login?redirectTo=${encodeURIComponent(`/dashboard/orders/${firstId}`)}`)
    expect(state.detail).not.toHaveBeenCalled()
  })
})
