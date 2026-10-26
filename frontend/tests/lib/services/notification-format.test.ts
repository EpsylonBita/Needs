import { describe, expect, it } from 'vitest'
import { formatNotification } from '@/lib/notifications/format-notification'
const row = { id: 'test', type: 'payment_sent', payload: { payment_id: '10000000-0000-4000-8000-000000000001' }, read: false, created_at: '2026-10-19T12:00:00Z' }
describe('notification messages', () => {
  it('formats actual events in Greek and English without exposing internal payloads', () => {
    expect(formatNotification(row, 'el')).toMatchObject({ title: 'Η πληρωμή σου ολοκληρώθηκε', href: '/dashboard/payments' })
    expect(formatNotification(row, 'en').title).toBe('Your payment completed')
    for (const type of ['payment_completed', 'transfer_created', 'dispute_opened', 'dispute_resolved', 'payment_refund_failed']) {
      expect(formatNotification({ ...row, type }, 'el').title).not.toBe('Ενημέρωση λογαριασμού')
    }
  })
  it('ignores payload URLs and malformed payment identifiers, with an honest unknown-event fallback', () => {
    expect(formatNotification({ ...row, payload: { payment_id: '//evil.invalid', url: 'javascript:alert(1)' } }, 'en').href).toBeUndefined()
    expect(formatNotification({ ...row, type: '__proto__', payload: { message: 'forged message', url: 'https://evil.invalid' } }, 'el'))
      .toMatchObject({ title: 'Ενημέρωση λογαριασμού', href: undefined })
    expect(formatNotification({ ...row, payload: null }, 'en').href).toBeUndefined()
  })

  it.each([
    ['en', 'New message', 'You have a new message in a conversation.', 'Open conversation'],
    ['el', 'Νέο μήνυμα', 'Έχεις νέο μήνυμα σε μια συνομιλία.', 'Άνοιγμα συνομιλίας'],
  ])('links a chat message to its conversation in %s without exposing message or sender data', (locale, title, description, linkLabel) => {
    const chatId = '30000000-0000-4000-8000-000000000001'
    const result = formatNotification({ ...row, type: 'chat_message', payload: {
      chat_id: chatId, message_id: 'private-message-id', sender_id: 'private-sender-id',
      content: 'Private conversation', sender_name: 'Private name', url: 'https://evil.invalid',
    } }, locale)
    expect(result).toEqual({ title, description, linkLabel, href: `/chat?chat=${encodeURIComponent(chatId)}` })
    expect(JSON.stringify(result)).not.toMatch(/Private|private-message-id|private-sender-id|evil/)
  })

  it.each([null, [], {}, { chat_id: null }, { chat_id: 4 }, { chat_id: '//evil.invalid' },
    { chat_id: '30000000-0000-4000-8000-000000000001&next=https://evil.invalid' },
    { chat_id: 'javascript:alert(1)', payment_id: row.payload.payment_id },
  ].map(payload => [payload]))('keeps malformed chat payloads safely unlinked: %j', payload => {
    expect(formatNotification({ ...row, type: 'chat_message', payload }, 'en'))
      .toMatchObject({ title: 'New message', href: undefined, linkLabel: 'Open conversation' })
  })

  it('does not turn an unknown event with a valid chat identifier into a conversation link', () => {
    expect(formatNotification({ ...row, type: 'unknown_message', payload: { chat_id: row.payload.payment_id } }, 'en'))
      .toMatchObject({ title: 'Account update', href: undefined })
  })
})
