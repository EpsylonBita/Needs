import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/admin/contact/retry/route'

const mock = vi.hoisted(() => ({ allowed: true, configured: true, dispatch: vi.fn() }))
vi.mock('@/lib/auth/admin', () => ({ requireAdmin: vi.fn(async () => ({ allowed: mock.allowed })) }))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/email/contact-email-transport', () => ({ configuredContactEmailDelivery: () => mock.configured ? {} : null }))
vi.mock('@/lib/email/contact-notification', () => ({ dispatchContactNotifications: mock.dispatch }))

const request = (body: unknown = {}) => new NextRequest('http://localhost/api/admin/contact/retry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
beforeEach(() => { vi.clearAllMocks(); mock.allowed = true; mock.configured = true; mock.dispatch.mockResolvedValue({ configured: true, claimed: 1, accepted: 1, pending: 0 }) })

describe('contact notification retries', () => {
  it('requires trusted admin authorization before claiming work', async () => {
    mock.allowed = false
    expect((await POST(request())).status).toBe(403)
    expect(mock.dispatch).not.toHaveBeenCalled()
  })
  it('bounds work and validates optional request identity', async () => {
    for (const body of [{ limit: 11 }, { limit: 0 }, { requestId: 'invalid' }]) expect((await POST(request(body))).status).toBe(400)
    expect(mock.dispatch).not.toHaveBeenCalled()
    expect(await (await POST(request({ limit: 2 }))).json()).toMatchObject({ accepted: 1 })
    expect(mock.dispatch).toHaveBeenCalledWith({}, {}, { limit: 2 })
  })
  it('does not pretend retries ran without a configured sender', async () => {
    mock.dispatch.mockResolvedValue({ configured: false, claimed: 0, accepted: 0, pending: 0 })
    expect((await POST(request())).status).toBe(503)
  })
})
