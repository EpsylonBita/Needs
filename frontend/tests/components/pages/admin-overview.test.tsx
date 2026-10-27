import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ session: vi.fn(), fetch: vi.fn(), from: vi.fn(), removeChannel: vi.fn(), locale: 'en', countError: false }))
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ locale: mocks.locale }) }))
vi.mock('@/lib/supabase/client', () => ({ supabase: {
  auth: { getSession: mocks.session }, from: mocks.from, removeChannel: mocks.removeChannel,
  channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel },
} }))
import AdminOverviewPage from '@/app/dashboard/admin/overview/page'

beforeEach(() => {
  vi.clearAllMocks(); mocks.locale = 'en'; mocks.countError = false
  vi.stubGlobal('fetch', mocks.fetch)
  mocks.session.mockResolvedValue({ data: { session: { access_token: 'admin-token' } }, error: null })
  mocks.fetch.mockImplementation(async () => ({ ok: !mocks.countError, status: mocks.countError ? 500 : 200, json: async () => ({ totals: [
    { currency: 'EUR', volume: 100, fee: 5 }, { currency: 'USD', volume: 223, fee: 11 },
  ], overview: { activeListings: 1234, newUsers: 18, openDisputes: 7, recordedTransfers: 2 } }) }))
  mocks.from.mockImplementation(() => { throw new Error('Browser RLS can hide administrator counts') })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('uses authenticated grouped requested amounts and exact counts without mixing currencies', async () => {
  render(<AdminOverviewPage />)
  const amountCard = await screen.findByRole('region', { name: 'Requested payment amounts' })
  expect(within(amountCard).getByText(/EUR\s*100\.00/)).toBeInTheDocument()
  expect(within(amountCard).getByText(/USD\s*223\.00/)).toBeInTheDocument()
  expect(screen.queryByText(/323\.00/)).not.toBeInTheDocument()
  expect(screen.getByText(/All payment statuses/)).toHaveTextContent('not collected revenue')
  expect(screen.getByRole('region', { name: 'Recorded transfers' })).toHaveTextContent('2')
  expect(screen.getByRole('region', { name: 'Open disputes' })).toHaveTextContent('7')
  expect(screen.queryByText('Pending Transfers')).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Active listings' })).toHaveTextContent('1234')
  expect(mocks.fetch).toHaveBeenCalledWith('/api/payments/admin/summary?year=all', expect.objectContaining({ headers: { Authorization: 'Bearer admin-token' }, signal: expect.any(AbortSignal) }))
  expect(mocks.from).not.toHaveBeenCalled()
})

it('keeps loading distinct from real zero totals and clears it on an empty successful result', async () => {
  let resolveFetch!: (value: unknown) => void
  mocks.fetch.mockImplementationOnce(() => new Promise(resolve => { resolveFetch = resolve }))
  render(<AdminOverviewPage />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading overview')
  expect(screen.queryByRole('region', { name: 'Requested payment amounts' })).not.toBeInTheDocument()
  await waitFor(() => expect(resolveFetch).toBeDefined())
  resolveFetch({ ok: true, status: 200, json: async () => ({ totals: [], overview: { activeListings: 0, newUsers: 0, openDisputes: 0, recordedTransfers: 0 } }) })
  expect(await screen.findAllByText('No payment records.')).toHaveLength(2)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it.each([401, 403])('does not expose summary or query count cards after HTTP %s', async status => {
  mocks.fetch.mockResolvedValue({ ok: false, status })
  render(<AdminOverviewPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Administrator access is required')
  expect(mocks.from).not.toHaveBeenCalled()
  expect(screen.queryByRole('region', { name: 'Requested payment amounts' })).not.toBeInTheDocument()
})

it('requires a session before fetching financial data', async () => {
  mocks.session.mockResolvedValue({ data: { session: null }, error: null })
  render(<AdminOverviewPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Sign in to view the overview')
  expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled()
})

it('reports count failures instead of zero KPIs and supports retry', async () => {
  mocks.countError = true
  render(<AdminOverviewPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent('The overview could not be loaded')
  expect(screen.queryByRole('region', { name: 'Active listings' })).not.toBeInTheDocument()
  mocks.countError = false; fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByRole('region', { name: 'Active listings' })).toHaveTextContent('1234')
})

it('labels requested amounts and recorded transfers in Greek', async () => {
  mocks.locale = 'el'; render(<AdminOverviewPage />)
  expect(await screen.findByRole('region', { name: 'Αιτούμενα ποσά πληρωμών' })).toBeInTheDocument()
  expect(screen.getByText(/Όλες οι καταστάσεις πληρωμών/)).toHaveTextContent('δεν είναι εισπραγμένα έσοδα')
  expect(screen.getByRole('region', { name: 'Καταγεγραμμένες μεταφορές' })).toBeInTheDocument()
})
