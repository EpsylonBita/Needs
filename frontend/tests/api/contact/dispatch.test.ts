import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/internal/contact/dispatch/route'
import { proxy } from '../../../proxy'

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), configured: vi.fn(), dispatch: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/email/contact-email-transport', () => ({ configuredContactEmailDelivery: mocks.configured }))
vi.mock('@/lib/email/contact-notification', () => ({ dispatchContactNotifications: mocks.dispatch }))
const secret = 'test-only-worker-secret-at-least-32-characters'
const request = (authorization = `Bearer ${secret}`, path = '/api/internal/contact/dispatch', method = 'POST') => new NextRequest(`http://127.0.0.1${path}`, { method, headers: { Authorization: authorization } })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', secret)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only-service-key')
  mocks.createClient.mockReturnValue({})
  mocks.configured.mockReturnValue({ transport: {} })
  mocks.dispatch.mockResolvedValue({ configured: true, claimed: 1, accepted: 1, pending: 0 })
})
afterEach(() => { vi.unstubAllEnvs() })

describe('internal contact dispatcher', () => {
  it.each(['', 'Bearer wrong', `Basic ${secret}`, `Bearer ${secret}extra`])('rejects absent/incorrect worker authorization before touching configuration or storage', async (authorization) => {
    expect((await POST(request(authorization))).status).toBe(401)
    expect(mocks.configured).not.toHaveBeenCalled()
    expect(mocks.createClient).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })

  it('fails closed when the server secret is absent', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await POST(request())).status).toBe(503)
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })

  it('leaves saved messages untouched without a configured provider', async () => {
    mocks.configured.mockReturnValue(null)
    expect(await (await POST(request())).json()).toEqual({ configured: false, claimed: 0, accepted: 0, pending: 0 })
    expect(mocks.createClient).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })

  it('authorizes a bounded batch using only the server credential', async () => {
    expect(await (await POST(request())).json()).toMatchObject({ accepted: 1 })
    expect(mocks.dispatch).toHaveBeenCalledWith({}, { transport: {} }, { limit: 5 })
  })

  it('does not expose storage/provider diagnostics on failures', async () => {
    mocks.dispatch.mockRejectedValue(new Error('private provider credentials'))
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('credentials')
  })

  it('exempts only the exact worker POST from cookie CSRF checks', async () => {
    expect((await proxy(request())).status).toBe(200)
    for (const [path, method] of [['/api/internal/contact/dispatch/other', 'POST'], ['/api/internal/contact/dispatch', 'PATCH'], ['/api/contact', 'POST'], ['/api/admin/contact/retry', 'POST']]) {
      expect((await proxy(request(`Bearer ${secret}`, path, method))).status).toBe(403)
    }
  })
})
