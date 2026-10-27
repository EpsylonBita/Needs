import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ fetch: vi.fn(), session: vi.fn(), from: vi.fn(), locale: 'en' }))
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ locale: state.locale }) }))
vi.mock('@/lib/supabase/client', () => ({ supabase: {
  auth: { getSession: state.session }, from: state.from,
  channel: () => ({ on: () => ({ subscribe: () => ({}) }) }), removeChannel: vi.fn(),
} }))
vi.mock('@/lib/utils/csrf', () => ({ withCsrfHeaders: async (headers: Record<string, string>) => ({ ...headers, 'X-CSRF-Token': 'csrf' }) }))
import AdminDisputesPage from '@/app/dashboard/admin/disputes/page'

const rows = [
  { id: 'bank-case', status: 'lost', reason: 'product_not_received', payment_id: 'payment-bank', stripe_dispute_id: 'du_bank', amount: 12, currency: 'eur' },
  { id: 'complaint', status: 'open', reason: 'Not as described', payment_id: 'payment-complaint', stripe_dispute_id: null, amount: 20, currency: 'eur' },
]
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })
beforeEach(() => {
  vi.clearAllMocks(); state.locale = 'en'; vi.stubGlobal('fetch', state.fetch)
  state.session.mockResolvedValue({ data: { session: { access_token: 'admin-token' } }, error: null })
  state.from.mockImplementation(() => { throw new Error('Privileged browser reads are forbidden') })
  state.fetch.mockResolvedValue(reply({ rows, total: 2 }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('admin bank disputes and marketplace complaints', () => {
  it('authenticates listing requests and distinguishes bank cases from actionable complaints', async () => {
    render(<AdminDisputesPage />)
    const bankRow = (await screen.findByText('bank-case')).closest('tr')!
    expect(state.fetch).toHaveBeenCalledWith('/api/admin/disputes/list?status=all&limit=20&offset=0', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer admin-token' }) }))
    expect(within(bankRow).getByText('Bank dispute')).toBeInTheDocument()
    expect(within(bankRow).getByText('€12.00')).toBeInTheDocument()
    expect(within(bankRow).queryByRole('button', { name: 'Refund' })).toBeNull()
    expect(within(bankRow).queryByRole('button', { name: 'Resolve' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Refund' })).toHaveLength(1)
    expect(state.from).not.toHaveBeenCalled()
  })
  it('shows a load failure with retry instead of a false empty list', async () => {
    state.fetch.mockResolvedValueOnce(reply({ error: 'Access denied' }, 403))
    render(<AdminDisputesPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied')
    expect(screen.queryByText('No disputes')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('bank-case')).toBeInTheDocument()
  })
  it('filters terminal bank outcomes', async () => {
    render(<AdminDisputesPage />); await screen.findByText('bank-case')
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'won' } })
    await waitFor(() => expect(state.fetch).toHaveBeenCalledWith('/api/admin/disputes/list?status=won&limit=20&offset=0', expect.anything()))
    expect(screen.getByRole('option', { name: 'Lost' })).toBeInTheDocument()
  })
  it('keeps recovery history review accessible after a late bank win', async () => {
    state.fetch.mockResolvedValue(reply({ rows: [{ ...rows[0], status: 'won' }], total: 1 }))
    render(<AdminDisputesPage />)
    expect(await screen.findByRole('button', { name: 'Review seller recovery' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Refund' })).toBeNull()
  })
  it('surfaces failed complaint actions and sends authenticated CSRF requests', async () => {
    render(<AdminDisputesPage />)
    const button = await screen.findByRole('button', { name: 'Resolve' })
    state.fetch.mockResolvedValueOnce(reply({ error: 'State changed; refresh first.' }, 409))
    fireEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('State changed; refresh first.')
    expect(state.fetch).toHaveBeenCalledWith('/api/payments/disputes/complaint/resolve', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer admin-token', 'X-CSRF-Token': 'csrf' }) }))
    expect(button).not.toBeDisabled(); expect(state.from).not.toHaveBeenCalled()
  })
  it('reports a pending refund without claiming settlement', async () => {
    render(<AdminDisputesPage />)
    const button = await screen.findByRole('button', { name: 'Refund' })
    state.fetch.mockResolvedValueOnce(reply({ success: true, status: 'pending' }))
    fireEvent.click(button)
    expect(await screen.findByRole('status')).toHaveTextContent('Refund pending. The status will update after Stripe confirms it.')
    expect(state.from).not.toHaveBeenCalled()
  })
  it('authenticates exports and shows download errors', async () => {
    render(<AdminDisputesPage />); await screen.findByText('bank-case')
    state.fetch.mockResolvedValueOnce(reply({ error: 'Export unavailable' }, 503))
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Export unavailable')
    expect(state.fetch).toHaveBeenCalledWith('/api/admin/disputes/export?status=all', expect.objectContaining({ headers: { Authorization: 'Bearer admin-token' } }))
  })
  it('downloads an authenticated CSV and releases its object URL', async () => {
    const createObjectURL = vi.fn(() => 'blob:disputes')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<AdminDisputesPage />); await screen.findByText('bank-case')
    const blob = new Blob(['id,status'], { type: 'text/csv' })
    state.fetch.mockResolvedValueOnce({ ok: true, blob: async () => blob })
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    await waitFor(() => expect(click).toHaveBeenCalledOnce())
    expect(createObjectURL).toHaveBeenCalledWith(blob)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:disputes')
    expect(document.querySelector('a[download]')).toBeNull()
    click.mockRestore()
  })
  it('uses Greek labels and keeps closed complaints read-only', async () => {
    state.locale = 'el'
    state.fetch.mockResolvedValue(reply({ rows: [{ ...rows[1], status: 'resolved' }], total: 1 }))
    render(<AdminDisputesPage />)
    expect(await screen.findByText('Καταγγελία NEEDS')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Κατάσταση' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Επιστροφή' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Επίλυση' })).toBeNull()
  })
})
