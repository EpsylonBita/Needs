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
  payment_authorization_expiring: { en: ['Authorization expires soon', 'The payment authorization is nearing its deadline. Review the order without assuming an automatic charge.'], el: ['Η δέσμευση λήγει σύντομα', 'Πλησιάζει η προθεσμία δέσμευσης της πληρωμής. Δες την παραγγελία· δεν γίνεται αυτόματη χρέωση.'] },
  payment_authorization_expired: { en: ['Authorization deadline passed', 'The authorization deadline has passed. Refresh the order to verify the status of its hold.'], el: ['Η προθεσμία δέσμευσης πέρασε', 'Η προθεσμία δέσμευσης πέρασε. Ανανέωσε την παραγγελία για να επαληθεύσεις την κατάσταση.'] },
  payment_attention_required: { en: ['Payment needs attention', 'The payment status needs verification. Open the order and refresh its status.'], el: ['Η πληρωμή χρειάζεται έλεγχο', 'Η κατάσταση πληρωμής χρειάζεται επαλήθευση. Άνοιξε την παραγγελία και ανανέωσε.'] },
  payment_cancellation_requested: { en: ['Cancellation requested', 'The other participant requested cancellation. Review the reason in your order.'], el: ['Ζητήθηκε ακύρωση', 'Το άλλο μέρος ζήτησε ακύρωση. Δες τον λόγο στην παραγγελία σου.'] },
  payment_cancellation_accepted: { en: ['Cancellation accepted', 'Cancellation was accepted. Check the order for Stripe’s verified release status.'], el: ['Η ακύρωση έγινε αποδεκτή', 'Η ακύρωση έγινε αποδεκτή. Δες στην παραγγελία την επαληθευμένη κατάσταση αποδέσμευσης.'] },
  payment_cancellation_rejected: { en: ['Cancellation declined', 'The cancellation request was declined. The order remains active.'], el: ['Η ακύρωση απορρίφθηκε', 'Το αίτημα ακύρωσης απορρίφθηκε. Η παραγγελία παραμένει ενεργή.'] },
  payment_cancellation_withdrawn: { en: ['Cancellation request withdrawn', 'The cancellation request was withdrawn. The order remains active.'], el: ['Το αίτημα ακύρωσης ανακλήθηκε', 'Το αίτημα ακύρωσης ανακλήθηκε. Η παραγγελία παραμένει ενεργή.'] },
  payment_canceled: { en: ['Authorization released', 'Stripe confirmed cancellation of this authorization. No payment was collected from this hold.'], el: ['Η δέσμευση αποδεσμεύτηκε', 'Το Stripe επιβεβαίωσε την ακύρωση αυτής της δέσμευσης. Δεν εισπράχθηκε πληρωμή από αυτή.'] },
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
  const expiringDescription = notification.type === 'payment_authorization_expiring' && ['1h', '24h'].includes(String(payload.threshold))
    ? language === 'el' ? payload.threshold === '1h' ? 'Απομένει λιγότερη από μία ώρα για τη δέσμευση. Δες την παραγγελία· η λήξη δεν ενεργοποιεί χρέωση.' : 'Απομένουν λιγότερες από 24 ώρες για τη δέσμευση. Δες την παραγγελία· η λήξη δεν ενεργοποιεί χρέωση.'
      : payload.threshold === '1h' ? 'Less than one hour remains on the hold. Review the order; expiry does not trigger a charge.' : 'Less than 24 hours remain on the hold. Review the order; expiry does not trigger a charge.'
    : message[1]
  return {
    title: message[0], description: expiringDescription,
    href: known && hasPayment ? `/dashboard/orders/${encodeURIComponent(String(payload.payment_id))}` : undefined,
    linkLabel: copy.viewPayment,
  }
}
