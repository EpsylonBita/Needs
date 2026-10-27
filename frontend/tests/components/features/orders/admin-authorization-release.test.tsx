import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userId: 'admin-one' as string | null, initialized: true, sessionId: 'admin-one', locale: 'en', session: vi.fn(), csrf: vi.fn(), fetch: vi.fn(), updated: vi.fn() }))
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: state.userId ? { id: state.userId } : null, isInitialized: state.initialized }) }))
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ locale: state.locale }) }))
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { getSession: state.session } } }))
vi.mock('@/lib/utils/csrf', () => ({ withCsrfHeaders: state.csrf }))
import { AdminAuthorizationRelease } from '@/components/features/orders/admin-authorization-release'

const payment = '11111111-1111-4111-8111-111111111111'
const tree = () => <AdminAuthorizationRelease paymentId={payment} onUpdated={state.updated} />
const submit = () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Release authorization' }))
function open() {
  const view = render(tree())
  fireEvent.click(screen.getByRole('button', { name: 'Release authorization' }))
  return view
}
beforeEach(() => {
  vi.resetAllMocks(); state.userId = 'admin-one'; state.initialized = true; state.sessionId = 'admin-one'; state.locale = 'en'
  state.session.mockImplementation(async () => ({ error: null, data: { session: { user: { id: state.sessionId }, access_token: 'token' } } }))
  state.csrf.mockImplementation(async headers => ({ ...headers, 'X-CSRF-Token': 'csrf' }))
  state.fetch.mockResolvedValue({ ok: true, json: async () => ({ released: true, pending: false }) })
  vi.stubGlobal('fetch', state.fetch)
})
afterEach(cleanup)

describe('Administrator authorization release', () => {
  it('requires a specific reason and sends the exact payment, captured account and secure headers', async () => {
    open(); submit()
    expect(screen.getByRole('alert')).toHaveTextContent('between 5 and 1,000')
    expect(state.fetch).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Reason for release'), { target: { value: ' Provider cannot complete the work ' } }); submit()
    await screen.findByText('Stripe confirmed the authorization was released.')
    expect(state.fetch).toHaveBeenCalledWith('/api/admin/payments/cancel', expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token', 'X-CSRF-Token': 'csrf' }, body: JSON.stringify({ paymentId: payment, expectedUserId: 'admin-one', reason: 'Provider cannot complete the work' }) }))
    expect(state.updated).toHaveBeenCalledTimes(1)
  })
  it('locks repeated submissions and distinguishes a 202 pending result from confirmed release', async () => {
    let finish!: (value: unknown) => void
    state.fetch.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    open(); fireEvent.change(screen.getByLabelText('Reason for release'), { target: { value: 'Mutually agreed release' } }); submit()
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(1))
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Requesting release…' })).toBeDisabled()
    expect(screen.getByLabelText('Reason for release')).toBeDisabled()
    await act(async () => finish({ ok: true, status: 202, json: async () => ({ released: false, pending: true }) }))
    expect(await screen.findByText(/Release is being verified/)).toBeInTheDocument()
    expect(screen.queryByText('Stripe confirmed the authorization was released.')).not.toBeInTheDocument()
  })
  it('preserves the reason on rejection and does not claim success for malformed responses', async () => {
    state.fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    open(); fireEvent.change(screen.getByLabelText('Reason for release'), { target: { value: 'Keep this audit reason' } }); submit()
    expect(await screen.findByRole('alert')).toHaveTextContent('Release was not verified')
    expect(screen.getByLabelText('Reason for release')).toHaveValue('Keep this audit reason')
    expect(state.updated).not.toHaveBeenCalled()
  })
  it('blocks changed sessions during CSRF preparation', async () => {
    state.csrf.mockImplementation(async headers => { state.sessionId = 'other-admin'; return { ...headers, 'X-CSRF-Token': 'csrf' } })
    open(); fireEvent.change(screen.getByLabelText('Reason for release'), { target: { value: 'Cannot complete' } }); submit()
    expect(await screen.findByRole('alert')).toHaveTextContent('Your account changed')
    expect(state.fetch).not.toHaveBeenCalled()
  })
  it('aborts an old account request and discards its late response', async () => {
    let finish!: (value: unknown) => void
    state.fetch.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const view = open(); fireEvent.change(screen.getByLabelText('Reason for release'), { target: { value: 'Cannot complete' } }); submit()
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(1))
    const signal = state.fetch.mock.calls[0][1].signal as AbortSignal
    state.userId = 'other-admin'; state.sessionId = 'other-admin'; view.rerender(tree())
    expect(signal.aborted).toBe(true)
    await act(async () => finish({ ok: true, json: async () => ({ released: true, pending: false }) }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Stripe confirmed the authorization was released.')).not.toBeInTheDocument()
    expect(state.updated).not.toHaveBeenCalled()
  })
  it('localizes the explicit financial effect and reason label in Greek', () => {
    state.locale = 'el'; render(tree())
    fireEvent.click(screen.getByRole('button', { name: 'Αποδέσμευση ποσού' }))
    expect(screen.getByRole('dialog', { name: 'Να αποδεσμευτεί το ποσό;' })).toBeInTheDocument()
    expect(screen.getByLabelText('Λόγος αποδέσμευσης')).toBeInTheDocument()
    expect(screen.getByText(/Δεν πληρώνεται ο πάροχος/)).toBeInTheDocument()
  })
})
