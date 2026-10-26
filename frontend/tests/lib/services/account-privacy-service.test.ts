import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { cancelAccountDeletion, confirmAccountPassword, exportAccountData, getAccountPrivacyStatus, requestAccountDeletion } from '@/lib/services/account-privacy-service'
const ids = { owner: '10000000-0000-4000-8000-000000000001', other: '10000000-0000-4000-8000-000000000002', request: '20000000-0000-4000-8000-000000000001' }
const boundary = vi.hoisted(() => ({ getUser: vi.fn(), getSession: vi.fn(), signIn: vi.fn(), csrf: vi.fn(), fetch: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { getUser: boundary.getUser, getSession: boundary.getSession, signInWithPassword: boundary.signIn } } }))
vi.mock('@/lib/utils/csrf', () => ({ withCsrfHeaders: boundary.csrf }))
const privacy = { request: null, blockers: { active_orders: 0, open_disputes: 0, pending_refunds: 0, active_milestones: 0, financial_history: false } }
beforeEach(() => {
  vi.clearAllMocks()
  boundary.getUser.mockResolvedValue({ data: { user: { id: ids.owner, email: 'owner@example.test' } }, error: null })
  boundary.getSession.mockResolvedValue({ data: { session: { user: { id: ids.owner }, access_token: 'access-token' } }, error: null })
  boundary.signIn.mockResolvedValue({ data: { user: { id: ids.owner } }, error: null })
  boundary.csrf.mockImplementation(async headers => ({ ...headers, 'X-CSRF-Token': 'csrf-token' }))
  boundary.fetch.mockResolvedValue({ ok: true, json: async () => privacy })
  vi.stubGlobal('fetch', boundary.fetch)
})
afterEach(() => vi.unstubAllGlobals())
describe('account privacy client', () => {
  it('binds status and mutations to the expected account with CSRF and bearer headers', async () => {
    await getAccountPrivacyStatus(ids.owner)
    await requestAccountDeletion(ids.owner)
    expect(boundary.fetch.mock.calls[1][1]).toMatchObject({ method: 'POST', cache: 'no-store', headers: { Authorization: 'Bearer access-token', 'X-CSRF-Token': 'csrf-token' } })
    expect(JSON.parse(boundary.fetch.mock.calls[1][1].body)).toEqual({ action: 'request', expectedUserId: ids.owner, confirmation: 'DELETE' })
    await cancelAccountDeletion(ids.owner, ids.request)
    expect(JSON.parse(boundary.fetch.mock.calls[2][1].body).requestId).toBe(ids.request)
  })
  it('does not send a mutation without a CSRF token', async () => {
    boundary.csrf.mockImplementation(async headers => headers)
    await expect(requestAccountDeletion(ids.owner)).rejects.toMatchObject({ code: 'SECURE_REQUEST_FAILED' })
    expect(boundary.fetch).not.toHaveBeenCalled()
  })
  it('rejects a session switch before sending or after receiving private data', async () => {
    await expect(getAccountPrivacyStatus(ids.other)).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' })
    expect(boundary.fetch).not.toHaveBeenCalled()
    boundary.getUser.mockResolvedValueOnce({ data: { user: { id: ids.owner } }, error: null })
      .mockResolvedValueOnce({ data: { user: { id: ids.owner } }, error: null })
      .mockResolvedValueOnce({ data: { user: { id: ids.other } }, error: null })
    await expect(getAccountPrivacyStatus(ids.owner)).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' })
  })
  it('surfaces reauthentication and refuses an export belonging to another account', async () => {
    boundary.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ code: 'REAUTH_REQUIRED', error: 'Sign in again' }) })
    await expect(exportAccountData(ids.owner)).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' })
    boundary.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ format_version: 1, account: { id: ids.other }, records: {}, scope: 'test' }) })
    await expect(exportAccountData(ids.owner)).rejects.toMatchObject({ code: 'ACCOUNT_UNAVAILABLE' })
  })
  it('verifies the password only against the signed-in email and never posts it to application APIs', async () => {
    await confirmAccountPassword(ids.owner, 'current-password')
    expect(boundary.signIn).toHaveBeenCalledWith({ email: 'owner@example.test', password: 'current-password' })
    expect(boundary.fetch).not.toHaveBeenCalled()
    boundary.signIn.mockResolvedValueOnce({ data: { user: null }, error: { message: 'bad password' } })
    await expect(confirmAccountPassword(ids.owner, 'wrong')).rejects.toMatchObject({ code: 'REAUTH_FAILED' })
  })
  it('rejects malformed status rather than silently reporting no pending request', async () => {
    boundary.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ request: null }) })
    await expect(getAccountPrivacyStatus(ids.owner)).rejects.toMatchObject({ code: 'ACCOUNT_UNAVAILABLE' })
  })
})
