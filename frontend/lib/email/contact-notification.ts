import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

export type ContactNotificationState = 'not_requested' | 'pending' | 'processing' | 'accepted' | 'failed'

export interface ContactEmailMessage {
  to: string
  from: string
  replyTo: string
  subject: string
  text: string
  idempotencyKey: string
}

export interface ContactEmailTransport {
  send(message: ContactEmailMessage, signal: AbortSignal): Promise<{ messageId: string }>
}

export interface ContactEmailDelivery {
  to: string
  from: string
  transport: ContactEmailTransport
}

export class ContactDeliveryError extends Error {
  constructor(public readonly code: 'provider_rejected' | 'provider_timeout' | 'provider_unavailable') {
    super(code)
  }
}

interface PendingContact {
  id: string
  first_name: string
  last_name: string
  email: string
  subject: string
  message: string
  notification_claim_token: string
  notification_to: string
  notification_from: string
}

export function contactEmailAddresses(): { to: string; from: string } | null {
  const to = z.string().email().safeParse(process.env.CONTACT_NOTIFY_TO?.trim())
  const from = z.string().email().safeParse(process.env.CONTACT_EMAIL_FROM?.trim())
  return to.success && from.success ? { to: to.data, from: from.data } : null
}

function notificationMessage(row: PendingContact): ContactEmailMessage {
  return {
    to: row.notification_to,
    from: row.notification_from,
    replyTo: row.email,
    subject: `[Needs contact] ${row.subject.replace(/[\r\n]/g, ' ')}`,
    text: `Contact request: ${row.id}\nFrom: ${row.first_name} ${row.last_name}\nEmail: ${row.email}\nSubject: ${row.subject}\n\n${row.message}`,
    idempotencyKey: `needs-contact/${row.id}`,
  }
}

async function sendWithTimeout(delivery: ContactEmailDelivery, message: ContactEmailMessage) {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      delivery.transport.send(message, controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new ContactDeliveryError('provider_timeout'))
        }, 20_000)
      }),
    ])
  } finally { if (timer) clearTimeout(timer) }
}

/** Save/claim state is durable; no contact contents or provider diagnostics are logged. */
export async function dispatchContactNotifications(
  database: Pick<SupabaseClient, 'rpc'>,
  delivery: ContactEmailDelivery | null,
  options: { requestId?: string; limit?: number } = {},
) {
  if (!delivery) return { configured: false, claimed: 0, accepted: 0, pending: 0 }
  const { data, error } = await database.rpc('claim_support_notifications', {
    p_request_id: options.requestId || null,
    p_limit: Math.max(1, Math.min(options.limit || 5, 10)),
    p_to: delivery.to,
    p_from: delivery.from,
  })
  if (error) throw new Error('Unable to claim contact notifications')
  const rows = (data || []) as PendingContact[]
  let accepted = 0
  let pending = 0
  for (const row of rows) {
    let providerId: string | null = null
    let errorCode: ContactDeliveryError['code'] | null = null
    try {
      const result = await sendWithTimeout(delivery, notificationMessage(row))
      if (!result.messageId) throw new ContactDeliveryError('provider_unavailable')
      providerId = result.messageId
    } catch (cause) {
      errorCode = cause instanceof ContactDeliveryError ? cause.code : 'provider_unavailable'
    }
    const finished = await database.rpc('finish_support_notification', {
      p_request_id: row.id,
      p_claim_token: row.notification_claim_token,
      p_accepted: providerId !== null,
      p_provider_id: providerId,
      p_error_code: errorCode,
    })
    // If acknowledgement storage fails, the lease expires and the stable
    // provider idempotency key lets a later retry recover the accepted message.
    if (finished.error || !finished.data) { pending += 1; continue }
    if (providerId) accepted += 1
    else pending += 1
  }
  return { configured: true, claimed: rows.length, accepted, pending }
}
