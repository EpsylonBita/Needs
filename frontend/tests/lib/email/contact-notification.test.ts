import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configuredContactEmailDelivery, resendContactTransport } from '@/lib/email/contact-email-transport'
import { ContactDeliveryError, dispatchContactNotifications } from '@/lib/email/contact-notification'
import type { SupabaseClient } from '@supabase/supabase-js'

const row = { id: '11111111-1111-4111-8111-111111111111', first_name: 'Maria', last_name: 'Test', email: 'visitor@example.com', subject: 'Question\r\nInjected header', message: '<script>untrusted text</script>', notification_claim_token: 'claim-token', notification_to: 'support@example.com', notification_from: 'contact@example.com' }
const notification = { to: 'support@example.com', from: 'contact@example.com', replyTo: 'visitor@example.com', subject: 'Contact question', text: 'Please help.', idempotencyKey: 'needs-contact/request-id' }

beforeEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

function database(rows: unknown[] = [row], finish: { data: boolean | null; error: unknown } = { data: true, error: null }) {
  const rpc = vi.fn(async (name: string) => name === 'claim_support_notifications' ? { data: rows, error: null } : finish)
  return { rpc } as unknown as Pick<SupabaseClient, 'rpc'> & { rpc: typeof rpc }
}

describe('durable contact notifications', () => {
  it('does not claim or send when the provider is unconfigured', async () => {
    const db = database()
    expect(await dispatchContactNotifications(db, null)).toMatchObject({ configured: false, claimed: 0 })
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('uses only server-configured addresses and a stable request idempotency key', async () => {
    const db = database()
    const send = vi.fn(async () => ({ messageId: 'accepted-id' }))
    const delivery = { to: 'support@example.com', from: 'contact@example.com', transport: { send } }
    expect(await dispatchContactNotifications(db, delivery, { requestId: row.id })).toMatchObject({ accepted: 1, pending: 0 })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: delivery.to, from: delivery.from, replyTo: row.email, idempotencyKey: `needs-contact/${row.id}`, subject: '[Needs contact] Question  Injected header', text: expect.stringContaining(row.message) }), expect.any(AbortSignal))
    expect(db.rpc).toHaveBeenLastCalledWith('finish_support_notification', { p_request_id: row.id, p_claim_token: row.notification_claim_token, p_accepted: true, p_provider_id: 'accepted-id', p_error_code: null })
  })

  it('reuses the first envelope when provider configuration changes between attempts', async () => {
    const db = database()
    const send = vi.fn(async () => ({ messageId: 'accepted-id' }))
    await dispatchContactNotifications(db, { to: 'changed@example.com', from: 'new-sender@example.com', transport: { send } })
    expect(db.rpc).toHaveBeenCalledWith('claim_support_notifications', expect.objectContaining({ p_to: 'changed@example.com', p_from: 'new-sender@example.com' }))
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: row.notification_to, from: row.notification_from, idempotencyKey: `needs-contact/${row.id}` }), expect.any(AbortSignal))
  })

  it('does not send a request already claimed or accepted by another worker', async () => {
    const send = vi.fn()
    expect(await dispatchContactNotifications(database([]), { ...notification, transport: { send } })).toMatchObject({ claimed: 0 })
    expect(send).not.toHaveBeenCalled()
  })

  it('records a safe failure code and leaves accepted-but-unacknowledged work retryable', async () => {
    const failed = database()
    await dispatchContactNotifications(failed, { ...notification, transport: { send: vi.fn(async () => { throw new Error('secret provider diagnostic') }) } })
    expect(failed.rpc).toHaveBeenLastCalledWith('finish_support_notification', expect.objectContaining({ p_accepted: false, p_error_code: 'provider_unavailable' }))
    const unacknowledged = database([row], { data: null, error: { message: 'database unavailable' } })
    expect(await dispatchContactNotifications(unacknowledged, { ...notification, transport: { send: vi.fn(async () => ({ messageId: 'accepted-id' })) } })).toMatchObject({ accepted: 0, pending: 1 })
  })

  it('aborts stalled provider calls and records a bounded timeout', async () => {
    vi.useFakeTimers()
    const db = database()
    const send = vi.fn((_message: unknown, _signal: AbortSignal) => new Promise<{ messageId: string }>(() => {}))
    const attempt = dispatchContactNotifications(db, { ...notification, transport: { send } })
    await vi.advanceTimersByTimeAsync(20_001)
    expect(await attempt).toMatchObject({ pending: 1 })
    expect(send.mock.calls[0][1].aborted).toBe(true)
    expect(db.rpc).toHaveBeenLastCalledWith('finish_support_notification', expect.objectContaining({ p_error_code: 'provider_timeout' }))
  })
})

describe('Resend contact transport', () => {
  it('requires explicit recipient, From and API key; no placeholder fallback', () => {
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('CONTACT_NOTIFY_TO', 'support@example.com')
    vi.stubEnv('CONTACT_EMAIL_FROM', 'contact@example.com')
    expect(configuredContactEmailDelivery()).toBeNull()
    vi.stubEnv('RESEND_API_KEY', 'test-only-key')
    expect(configuredContactEmailDelivery()).toMatchObject({ to: 'support@example.com', from: 'contact@example.com' })
    vi.stubEnv('CONTACT_EMAIL_FROM', 'invalid')
    expect(configuredContactEmailDelivery()).toBeNull()
  })

  it('passes the stable key and plain-text payload to the provider without altering Reply-To', async () => {
    const request = vi.fn(async (_url: string, _options: RequestInit) => new Response(JSON.stringify({ id: 'provider-message-id' }), { status: 200 }))
    vi.stubGlobal('fetch', request)
    const result = await resendContactTransport('test-only-key').send(notification, new AbortController().signal)
    expect(result).toEqual({ messageId: 'provider-message-id' })
    expect(request).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer test-only-key', 'Content-Type': 'application/json', 'Idempotency-Key': notification.idempotencyKey } }))
    expect(JSON.parse(String(request.mock.calls[0][1].body))).toEqual({ from: notification.from, to: [notification.to], reply_to: notification.replyTo, subject: notification.subject, text: notification.text })
  })

  it.each([401, 429, 503])('does not report provider rejection %i as a sent email', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('private diagnostic', { status })))
    await expect(resendContactTransport('test-only-key').send(notification, new AbortController().signal)).rejects.toBeInstanceOf(ContactDeliveryError)
  })

  it('does not accept an HTTP success that lacks a provider message ID', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    await expect(resendContactTransport('test-only-key').send(notification, new AbortController().signal)).rejects.toMatchObject({ code: 'provider_unavailable' })
  })
})
