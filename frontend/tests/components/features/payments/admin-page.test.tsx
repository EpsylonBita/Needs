import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), session: vi.fn(), push: vi.fn(), from: vi.fn(), csrf: vi.fn(), locale: 'en' }))
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ locale: mocks.locale, t: (key: string, fallback?: string) => fallback ?? key }) }))
vi.mock('next/navigation', () => { const router = { push: mocks.push }; return { useRouter: () => router } })
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { getSession: mocks.session }, from: mocks.from } }))
vi.mock('@/lib/utils/csrf', () => ({ withCsrfHeaders: mocks.csrf }))
vi.mock('recharts', () => ({
  LineChart: ({ children }: any) => <div>{children}</div>, ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  Line: () => null, CartesianGrid: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, Legend: () => null,
}))
import PaymentsAdminPage from '@/app/dashboard/payments/admin/page'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', mocks.fetch)
  mocks.locale = 'en'
  mocks.session.mockResolvedValue({ data: { session: { access_token: 'admin-token' } } })
  mocks.csrf.mockImplementation(async (headers: Record<string, string>) => ({ ...headers, 'X-CSRF-Token': 'csrf-token' }))
  mocks.from.mockImplementation(() => { throw new Error('Privileged browser read attempted') })
  mocks.fetch.mockImplementation(async (url: string) => ({ ok: true, status: 200, json: async () => url.includes('/summary')
    ? { totals: [{ currency: 'EUR', volume: 100, fee: 5 }], monthly: [], disputes: [{ id: 'd1', status: 'open', reason: 'reason', payment_id: 'p1' }] }
    : { rows: [{ id: 'p1', amount: 100, platform_fee: 5, currency: 'eur', status: 'completed', created_at: '2026-10-01' }], total: 1 } }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Payments admin page', () => {
  it('loads privileged data only through authenticated server requests', async () => {
    render(<PaymentsAdminPage />)
    await screen.findByText('p1')
    expect(mocks.fetch).toHaveBeenCalledWith('/api/payments/admin/summary?year=all', expect.objectContaining({ headers: { Authorization: 'Bearer admin-token' } }))
    expect(mocks.fetch).toHaveBeenCalledWith('/api/admin/payments/list?status=all&year=all&limit=20&offset=0', expect.objectContaining({ headers: { Authorization: 'Bearer admin-token' } }))
    expect(mocks.from).not.toHaveBeenCalled()
    expect(screen.getAllByText('€100.00')).toHaveLength(2)
  })
  it('redirects callers denied by the server without showing payment data', async () => {
    mocks.fetch.mockResolvedValue({ ok: false, status: 403 })
    render(<PaymentsAdminPage />)
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/dashboard'))
    expect(screen.queryByText('p1')).toBeNull()
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('reports failed dispute actions and preserves the authenticated CSRF request', async () => {
    render(<PaymentsAdminPage />)
    const resolve = await screen.findByRole('button', { name: 'Resolve' })
    mocks.fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'Could not resolve dispute' }) })
    fireEvent.click(resolve)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not resolve dispute')
    expect(mocks.fetch).toHaveBeenCalledWith('/api/payments/disputes/d1/resolve', { method: 'POST', headers: { Authorization: 'Bearer admin-token', 'X-CSRF-Token': 'csrf-token' } })
    expect(resolve).not.toBeDisabled()
  })
  it('shows legacy request review flags and lets operators filter for them', async () => {
    mocks.fetch.mockImplementation(async (url: string) => ({ ok: true, status: 200, json: async () => url.includes('/summary')
      ? { totals: [], monthly: [], disputes: [] }
      : { rows: [{ id: 'legacy-payment', amount: 20, platform_fee: 1, currency: 'eur', status: 'requires_capture', created_at: '2026-10-01', role_review_required: true }], total: 1 } }))
    render(<PaymentsAdminPage />)
    expect(await screen.findByText('Needs administrator review')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Only payments needing administrator review' }))
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith('/api/admin/payments/list?status=all&year=all&limit=20&offset=0&roleReview=required', expect.objectContaining({ headers: { Authorization: 'Bearer admin-token' } })))
    mocks.fetch.mockResolvedValueOnce({ ok: false, status: 500 })
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Payment export could not be downloaded.')
    expect(mocks.fetch).toHaveBeenCalledWith('/api/admin/payments/export?status=all&year=all&roleReview=required', { headers: { Authorization: 'Bearer admin-token' } })
  })
  it('localizes the review filter, flag and export failure in Greek', async () => {
    mocks.locale = 'el'
    mocks.fetch.mockImplementation(async (url: string) => ({ ok: true, status: 200, json: async () => url.includes('/summary')
      ? { totals: [], monthly: [], disputes: [] }
      : { rows: [{ id: 'legacy-payment', amount: 20, platform_fee: 1, currency: 'eur', status: 'requires_capture', created_at: '2026-10-01', role_review_required: true }], total: 1 } }))
    render(<PaymentsAdminPage />)
    expect(await screen.findByText('Χρειάζεται έλεγχο από διαχειριστή')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Μόνο πληρωμές που χρειάζονται έλεγχο από διαχειριστή' }))
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith('/api/admin/payments/list?status=all&year=all&limit=20&offset=0&roleReview=required', expect.anything()))
    mocks.fetch.mockResolvedValueOnce({ ok: false, status: 500 })
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Δεν ήταν δυνατή η λήψη του αρχείου πληρωμών.')
  })
})
