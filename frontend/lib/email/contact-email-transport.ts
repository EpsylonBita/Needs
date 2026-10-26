import { ContactDeliveryError, contactEmailAddresses } from './contact-notification'
import type { ContactEmailDelivery, ContactEmailMessage, ContactEmailTransport } from './contact-notification'

export function resendContactTransport(apiKey: string): ContactEmailTransport {
  return {
    async send(message: ContactEmailMessage, signal: AbortSignal) {
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': message.idempotencyKey,
          },
          body: JSON.stringify({
            from: message.from, to: [message.to], reply_to: message.replyTo,
            subject: message.subject, text: message.text,
          }),
        })
        if (!response.ok) {
          throw new ContactDeliveryError(response.status === 429 || response.status >= 500 || response.status === 409
            ? 'provider_unavailable' : 'provider_rejected')
        }
        const body: unknown = await response.json()
        const id = body && typeof body === 'object' && 'id' in body ? body.id : null
        if (typeof id !== 'string' || !id || id.length > 200) throw new ContactDeliveryError('provider_unavailable')
        return { messageId: id }
      } catch (cause) {
        if (cause instanceof ContactDeliveryError) throw cause
        throw new ContactDeliveryError(signal.aborted ? 'provider_timeout' : 'provider_unavailable')
      }
    },
  }
}

/** Neither the displayed placeholder support address nor a test From is assumed. */
export function configuredContactEmailDelivery(): ContactEmailDelivery | null {
  const key = process.env.RESEND_API_KEY?.trim()
  const addresses = contactEmailAddresses()
  return key && addresses ? { ...addresses, transport: resendContactTransport(key) } : null
}
