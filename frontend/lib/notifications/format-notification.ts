import type { NotificationRow } from '@/lib/services/notification-service'
import { notificationCopy } from './copy'

// Only events emitted by the application's producers; never display raw payload text.
const events = {
  chat_message: {
    en: ['New message', 'You have a new message in a conversation.'],
    el: ['Νέο μήνυμα', 'Έχεις νέο μήνυμα σε μια συνομιλία.'],
  },
  payment_completed: {
    en: ['Payment received', 'A payment for your transaction has completed.'],
    el: ['Η πληρωμή ολοκληρώθηκε', 'Ολοκληρώθηκε μια πληρωμή προς εσένα για συναλλαγή σου.'],
  },
  payment_sent: {
    en: ['Your payment completed', 'Your payment for a transaction has completed.'],
    el: ['Η πληρωμή σου ολοκληρώθηκε', 'Ολοκληρώθηκε η πληρωμή σου για μια συναλλαγή.'],
  },
  transfer_created: {
    en: ['Transfer created', 'A transfer to your connected payment account has been created.'],
    el: ['Δημιουργήθηκε μεταφορά χρημάτων', 'Δημιουργήθηκε μεταφορά προς τον συνδεδεμένο λογαριασμό πληρωμών σου.'],
  },
  dispute_opened: {
    en: ['A dispute was opened', 'A dispute was opened for one of your payments. Check its details and current status.'],
    el: ['Άνοιξε μια διαφορά', 'Άνοιξε διαφορά για μια πληρωμή σου. Δες τις λεπτομέρειες και την τρέχουσα κατάστασή της.'],
  },
  dispute_resolved: {
    en: ['A dispute was closed', 'A payment dispute has closed. Check the payment for its outcome.'],
    el: ['Έκλεισε μια διαφορά', 'Έκλεισε μια διαφορά πληρωμής. Δες την πληρωμή για το αποτέλεσμά της.'],
  },
  payment_refund_failed: {
    en: ['A refund needs attention', 'A refund could not be completed. Check the payment for its current status.'],
    el: ['Η επιστροφή χρημάτων χρειάζεται έλεγχο', 'Μια επιστροφή χρημάτων δεν ολοκληρώθηκε. Δες την τρέχουσα κατάσταση της πληρωμής.'],
  },
} as const
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function formatNotification(notification: NotificationRow, locale: string) {
  const language = locale === 'el' ? 'el' : 'en'
  const copy = notificationCopy[language]
  const known = Object.hasOwn(events, notification.type)
  const message = known ? events[notification.type as keyof typeof events][language] : [copy.unknownTitle, copy.unknownDescription]
  const payload = notification.payload && typeof notification.payload === 'object' && !Array.isArray(notification.payload)
    ? notification.payload as Record<string, unknown> : {}
  if (notification.type === 'chat_message') {
    return {
      title: message[0], description: message[1],
      href: typeof payload.chat_id === 'string' && uuid.test(payload.chat_id) ? `/chat?chat=${encodeURIComponent(payload.chat_id)}` : undefined,
      linkLabel: copy.viewConversation,
    }
  }
  const hasPayment = typeof payload.payment_id === 'string' && uuid.test(payload.payment_id)
  return {
    title: message[0], description: message[1],
    // There is no payment detail route yet. Do not manufacture one or trust payload URLs.
    href: known && hasPayment ? '/dashboard/payments' : undefined,
    linkLabel: copy.viewPayment,
  }
}
