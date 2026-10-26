const statuses = {
  en: {
    pending: 'Pending', requires_payment_method: 'Awaiting payment', requires_capture: 'Awaiting completion',
    processing: 'Processing', completed: 'Completed', succeeded: 'Succeeded', failed: 'Failed', refunded: 'Refunded',
    disputed: 'Disputed', cancelled: 'Cancelled', canceled: 'Cancelled', open: 'Open', resolved: 'Resolved', rejected: 'Rejected',
    won: 'Resolved in your favour', lost: 'Resolved against you', superseded: 'Replaced', authorized: 'Authorized',
  },
  el: {
    pending: 'Σε αναμονή', requires_payment_method: 'Αναμονή πληρωμής', requires_capture: 'Αναμονή ολοκλήρωσης',
    processing: 'Σε επεξεργασία', completed: 'Ολοκληρώθηκε', succeeded: 'Επιτυχής', failed: 'Απέτυχε', refunded: 'Επιστράφηκε',
    disputed: 'Σε αμφισβήτηση', cancelled: 'Ακυρώθηκε', canceled: 'Ακυρώθηκε', open: 'Ανοικτό', resolved: 'Επιλύθηκε', rejected: 'Απορρίφθηκε',
    won: 'Επιλύθηκε υπέρ σου', lost: 'Επιλύθηκε εις βάρος σου', superseded: 'Αντικαταστάθηκε', authorized: 'Εγκρίθηκε',
  },
};

export function paymentLabel(status: string, locale: string): string {
  const labels: Record<string, string> = statuses[locale === 'el' ? 'el' : 'en'];
  return labels[status] || (locale === 'el' ? 'Μη διαθέσιμη κατάσταση' : 'Status unavailable');
}

export function transactionLabel(type: string, locale: string): string {
  const labels: Record<string, string> = locale === 'el'
    ? { payment: 'Πληρωμή', charge: 'Χρέωση', capture: 'Οριστικοποίηση', refund: 'Επιστροφή', payout: 'Απόδοση χρημάτων', transfer: 'Μεταφορά', fee: 'Προμήθεια', application_fee: 'Προμήθεια πλατφόρμας' }
    : { payment: 'Payment', charge: 'Charge', capture: 'Payment completion', refund: 'Refund', payout: 'Payout', transfer: 'Transfer', fee: 'Fee', application_fee: 'Platform fee' };
  return labels[type] || (locale === 'el' ? 'Συναλλαγή' : 'Transaction');
}
