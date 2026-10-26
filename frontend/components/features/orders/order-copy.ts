import type { OrderDTO } from '@/lib/orders/types'

export const orderCopy = {
  en: {
    title: 'My orders', subtitle: 'View your purchases, provided items and services, and the next step for each payment.',
    back: 'Profile', allOrders: 'All orders', detail: 'Order details', view: 'View order', refresh: 'Refresh orders', retry: 'Try again',
    loading: 'Loading orders…', loadingDetail: 'Loading order…', signIn: 'Sign in to view your orders.', login: 'Sign in',
    loadError: 'Orders could not be loaded. Please try again.', detailError: 'This order could not be loaded. It may be unavailable or belong to another account.', stale: 'The latest information could not be loaded. Refresh before making changes.',
    empty: 'No orders yet', emptyHint: 'Payments for items or services will appear here. Free exchanges are arranged in your conversations.', browse: 'Explore listings', noResults: 'No loaded orders match these filters.',
    filter: 'Filter orders by your role', all: 'All', buyer: 'I am buying', seller: 'I am providing', statusFilter: 'Payment status', anyStatus: 'Any status',
    loadedHint: 'Filters apply to the orders loaded so far.', more: 'Load more orders', loadingMore: 'Loading more…', moreError: 'More orders could not be loaded. Your current orders are still here.',
    buying: 'You are the payer', providing: 'You are the provider', provider: 'Provider', payer: 'Payer', member: 'NEEDS member',
    amount: 'Payment amount', created: 'Created', reference: 'Reference', fee: 'Platform fee included', listing: 'Listing', unavailable: 'This listing is no longer publicly available.',
    viewListing: 'View listing', chat: 'Open conversation', profile: 'View profile', milestones: 'Payment milestone',
    requires_capture: 'Payment pending', requires_payment_method: 'Awaiting payment', completed: 'Payment completed', failed: 'Payment failed', refunded: 'Payment refunded', disputed: 'Payment disputed', unknown: 'Status unavailable',
    unverified: 'Awaiting payment verification', authorized: 'Payment authorized', processing: 'Payment update pending',
    unverifiedHint: 'The payment has been started. Authorization has not yet been verified here; no funds are assumed to be reserved.',
    authorizedHint: 'Authorization is recorded. Both parties must confirm completion before the payment can be finalized.',
    disabled: 'Payment actions are currently unavailable. You can still view history, open a conversation, report a problem or leave an eligible review.',
    legacy: 'This older request payment needs administrator review.', pending: 'The payment request has been accepted. Its final result is still being verified. Refresh to see the latest status.',
    confirmations: 'Completion confirmations', ownConfirmation: 'Your confirmation', otherConfirmation: 'Other party’s confirmation', confirmed: 'Confirmed', waiting: 'Not confirmed yet',
    confirm: 'Confirm completion', confirmBuyerTitle: 'Have you received the item or service?', confirmSellerTitle: 'Have you provided the item or service?',
    confirmBuyerHint: 'Confirm only after you have received the agreed item or the agreed work is complete. This records your completion confirmation; it does not itself finalize the payment.',
    confirmSellerHint: 'Confirm only after you have handed over the agreed item or completed the agreed work. This records your completion confirmation; it does not itself finalize the payment.',
    confirmationSaved: 'Your completion confirmation was saved.', capture: 'Finalize payment', captureTitle: 'Finalize this payment?',
    captureHint: 'This requests collection of the authorized payment from the payer and payment to the provider, less the platform fee. Continue only when the agreed exchange is complete.',
    reconcile: 'Check / complete payment', reconcileTitle: 'Check or complete this payment?', reconcileHint: 'This checks Stripe and, if needed, retries finalizing the payment you already requested. It uses the same payment request and does not create a separate payment.',
    captureButton: 'Confirm and finalize payment', cancel: 'Cancel', saving: 'Saving…', actionError: 'The action could not be completed. Your order has not been marked as successful. Refresh and try again.',
    complaintHeading: 'Problems and refunds', complaintOpen: 'A problem has been reported. Finalizing payment is blocked while the complaint is open.',
    report: 'Report a problem', reportTitle: 'Report a problem with this order?', reportHint: 'This opens a complaint for review. It does not issue an automatic refund or change the financial payment status.', reportSaved: 'Your complaint was recorded for review.',
    complaint: 'Marketplace complaint', bankDispute: 'Bank dispute', noComplaint: 'No complaint is recorded for this order.',
    open: 'Open', resolved: 'Resolved', rejected: 'Rejected', won: 'Won', lost: 'Lost',
    refundedAmount: 'Refund completed', refundPending: 'Refund pending', refundFailed: 'A refund attempt failed. This does not confirm a successful refund.',
    reviewHeading: 'Your review', review: 'Leave a review', reviewHint: 'Review the provider for this completed payment.', rating: 'Rating', chooseRating: 'Choose a rating', comment: 'Comment (optional)', submitReview: 'Publish review', reviewSaved: 'Your review was published.', reviewed: 'You have reviewed this order.', reviewInvalid: 'Choose a rating from 1 to 5 and use up to 4,000 characters.',
  },
  el: {
    title: 'Οι παραγγελίες μου', subtitle: 'Δες τις αγορές, τα αντικείμενα και τις υπηρεσίες που προσφέρεις και το επόμενο βήμα κάθε πληρωμής.',
    back: 'Προφίλ', allOrders: 'Όλες οι παραγγελίες', detail: 'Στοιχεία παραγγελίας', view: 'Προβολή παραγγελίας', refresh: 'Ανανέωση παραγγελιών', retry: 'Δοκίμασε ξανά',
    loading: 'Φόρτωση παραγγελιών…', loadingDetail: 'Φόρτωση παραγγελίας…', signIn: 'Συνδέσου για να δεις τις παραγγελίες σου.', login: 'Σύνδεση',
    loadError: 'Οι παραγγελίες δεν φορτώθηκαν. Δοκίμασε ξανά.', detailError: 'Η παραγγελία δεν φορτώθηκε. Ίσως δεν είναι διαθέσιμη ή ανήκει σε άλλον λογαριασμό.', stale: 'Οι νεότερες πληροφορίες δεν φορτώθηκαν. Ανανέωσε πριν κάνεις αλλαγές.',
    empty: 'Δεν υπάρχουν παραγγελίες ακόμη', emptyHint: 'Εδώ θα εμφανιστούν οι πληρωμές για αντικείμενα ή υπηρεσίες. Οι δωρεάν παραχωρήσεις γίνονται κατόπιν συνεννόησης στις συνομιλίες σου.', browse: 'Αναζήτηση αγγελιών', noResults: 'Καμία από τις φορτωμένες παραγγελίες δεν ταιριάζει στα φίλτρα.',
    filter: 'Φιλτράρισμα παραγγελιών ανά ρόλο', all: 'Όλες', buyer: 'Αγοράζω', seller: 'Προσφέρω', statusFilter: 'Κατάσταση πληρωμής', anyStatus: 'Όλες οι καταστάσεις',
    loadedHint: 'Τα φίλτρα εφαρμόζονται στις παραγγελίες που έχουν φορτωθεί.', more: 'Περισσότερες παραγγελίες', loadingMore: 'Φόρτωση περισσότερων…', moreError: 'Δεν φορτώθηκαν περισσότερες παραγγελίες. Οι υπάρχουσες παραμένουν εδώ.',
    buying: 'Εσύ πληρώνεις', providing: 'Εσύ παρέχεις', provider: 'Πάροχος', payer: 'Πληρωτής', member: 'Μέλος του NEEDS',
    amount: 'Ποσό πληρωμής', created: 'Δημιουργήθηκε', reference: 'Αναφορά', fee: 'Προμήθεια πλατφόρμας που περιλαμβάνεται', listing: 'Αγγελία', unavailable: 'Αυτή η αγγελία δεν είναι πλέον δημόσια διαθέσιμη.',
    viewListing: 'Προβολή αγγελίας', chat: 'Άνοιγμα συνομιλίας', profile: 'Προβολή προφίλ', milestones: 'Στάδιο πληρωμής',
    requires_capture: 'Εκκρεμής πληρωμή', requires_payment_method: 'Αναμονή πληρωμής', completed: 'Η πληρωμή ολοκληρώθηκε', failed: 'Η πληρωμή απέτυχε', refunded: 'Η πληρωμή επιστράφηκε', disputed: 'Η πληρωμή αμφισβητείται', unknown: 'Μη διαθέσιμη κατάσταση',
    unverified: 'Αναμονή επαλήθευσης πληρωμής', authorized: 'Η πληρωμή εγκρίθηκε', processing: 'Αναμονή ενημέρωσης πληρωμής',
    unverifiedHint: 'Η πληρωμή ξεκίνησε. Η έγκρισή της δεν έχει ακόμη επαληθευτεί εδώ· δεν θεωρούμε ότι έχει δεσμευτεί ποσό.',
    authorizedHint: 'Η έγκριση έχει καταγραφεί. Και τα δύο μέρη πρέπει να επιβεβαιώσουν την ολοκλήρωση πριν οριστικοποιηθεί η πληρωμή.',
    disabled: 'Οι ενέργειες πληρωμής δεν είναι διαθέσιμες αυτή τη στιγμή. Μπορείς να δεις το ιστορικό, να ανοίξεις συνομιλία, να αναφέρεις πρόβλημα ή να γράψεις αξιολόγηση όπου επιτρέπεται.',
    legacy: 'Αυτή η παλαιότερη πληρωμή αιτήματος χρειάζεται έλεγχο από διαχειριστή.', pending: 'Το αίτημα πληρωμής έγινε δεκτό. Το τελικό αποτέλεσμα επαληθεύεται ακόμη. Ανανέωσε για να δεις τη νεότερη κατάσταση.',
    confirmations: 'Επιβεβαιώσεις ολοκλήρωσης', ownConfirmation: 'Η δική σου επιβεβαίωση', otherConfirmation: 'Η επιβεβαίωση του άλλου μέρους', confirmed: 'Επιβεβαιώθηκε', waiting: 'Δεν έχει επιβεβαιωθεί ακόμη',
    confirm: 'Επιβεβαίωση ολοκλήρωσης', confirmBuyerTitle: 'Παρέλαβες το αντικείμενο ή την υπηρεσία;', confirmSellerTitle: 'Παρείχες το αντικείμενο ή την υπηρεσία;',
    confirmBuyerHint: 'Επιβεβαίωσε μόνο αφού παραλάβεις το συμφωνημένο αντικείμενο ή ολοκληρωθεί η συμφωνημένη εργασία. Καταγράφεται η δική σου επιβεβαίωση ολοκλήρωσης· δεν οριστικοποιείται αυτόματα η πληρωμή.',
    confirmSellerHint: 'Επιβεβαίωσε μόνο αφού παραδώσεις το συμφωνημένο αντικείμενο ή ολοκληρώσεις τη συμφωνημένη εργασία. Καταγράφεται η δική σου επιβεβαίωση ολοκλήρωσης· δεν οριστικοποιείται αυτόματα η πληρωμή.',
    confirmationSaved: 'Η επιβεβαίωση ολοκλήρωσης αποθηκεύτηκε.', capture: 'Οριστικοποίηση πληρωμής', captureTitle: 'Οριστικοποίηση αυτής της πληρωμής;',
    captureHint: 'Ζητείται η είσπραξη του εγκεκριμένου ποσού από τον πληρωτή και η πληρωμή του παρόχου, αφαιρώντας την προμήθεια πλατφόρμας. Συνέχισε μόνο αν ολοκληρώθηκε η συμφωνημένη συναλλαγή.',
    reconcile: 'Επανέλεγχος / ολοκλήρωση πληρωμής', reconcileTitle: 'Επανέλεγχος ή ολοκλήρωση αυτής της πληρωμής;', reconcileHint: 'Ελέγχεται η κατάσταση στο Stripe και, αν χρειάζεται, επαναλαμβάνεται η οριστικοποίηση που έχεις ήδη ζητήσει. Χρησιμοποιείται το ίδιο αίτημα πληρωμής και δεν δημιουργείται ξεχωριστή πληρωμή.',
    captureButton: 'Επιβεβαίωση και οριστικοποίηση πληρωμής', cancel: 'Ακύρωση', saving: 'Αποθήκευση…', actionError: 'Η ενέργεια δεν ολοκληρώθηκε. Η παραγγελία δεν σημειώθηκε ως επιτυχής. Ανανέωσε και δοκίμασε ξανά.',
    complaintHeading: 'Προβλήματα και επιστροφές', complaintOpen: 'Έχει αναφερθεί πρόβλημα. Η οριστικοποίηση της πληρωμής εμποδίζεται όσο το παράπονο παραμένει ανοικτό.',
    report: 'Αναφορά προβλήματος', reportTitle: 'Αναφορά προβλήματος με αυτή την παραγγελία;', reportHint: 'Ανοίγει ένα παράπονο προς εξέταση. Δεν γίνεται αυτόματη επιστροφή χρημάτων και δεν αλλάζει η οικονομική κατάσταση της πληρωμής.', reportSaved: 'Το παράπονό σου καταγράφηκε προς εξέταση.',
    complaint: 'Παράπονο προς την πλατφόρμα', bankDispute: 'Τραπεζική αμφισβήτηση', noComplaint: 'Δεν έχει καταγραφεί παράπονο για αυτή την παραγγελία.',
    open: 'Ανοικτό', resolved: 'Επιλύθηκε', rejected: 'Απορρίφθηκε', won: 'Δεκτή έκβαση', lost: 'Αρνητική έκβαση',
    refundedAmount: 'Ολοκληρωμένη επιστροφή', refundPending: 'Επιστροφή σε αναμονή', refundFailed: 'Μια απόπειρα επιστροφής απέτυχε. Αυτό δεν επιβεβαιώνει επιτυχή επιστροφή χρημάτων.',
    reviewHeading: 'Η αξιολόγησή σου', review: 'Γράψε αξιολόγηση', reviewHint: 'Αξιολόγησε τον πάροχο για αυτή την ολοκληρωμένη πληρωμή.', rating: 'Βαθμολογία', chooseRating: 'Επίλεξε βαθμολογία', comment: 'Σχόλιο (προαιρετικό)', submitReview: 'Δημοσίευση αξιολόγησης', reviewSaved: 'Η αξιολόγησή σου δημοσιεύτηκε.', reviewed: 'Έχεις αξιολογήσει αυτή την παραγγελία.', reviewInvalid: 'Επίλεξε βαθμολογία από 1 έως 5 και χρησιμοποίησε έως 4.000 χαρακτήρες.',
  },
}
export type OrderCopy = typeof orderCopy.en
export const paymentStatusLabel = (order: OrderDTO, copy: OrderCopy): string => {
  if (order.capture_pending) return copy.processing
  if (order.status === 'requires_capture') return order.authorization_state === 'authorized' ? copy.authorized : copy.unverified
  return ({ requires_payment_method: copy.requires_payment_method, completed: copy.completed, failed: copy.failed, refunded: copy.refunded, disputed: copy.disputed } as Record<string, string>)[order.status] || copy.unknown
}
export const disputeStatusLabel = (status: string, copy: OrderCopy) => ({ open: copy.open, resolved: copy.resolved, rejected: copy.rejected, refunded: copy.refunded, won: copy.won, lost: copy.lost } as Record<string, string>)[status] || copy.unknown
export function orderMoney(amount: number, currency: string, locale: string) {
  try { return new Intl.NumberFormat(locale === 'el' ? 'el-GR' : 'en-GB', { style: 'currency', currency: currency.toUpperCase() }).format(amount) }
  catch { return `${amount.toFixed(2)} ${currency.toUpperCase()}` }
}
export function orderDate(value: string, locale: string) {
  const date = new Date(value)
  // The API uses epoch only as a pagination sentinel for missing legacy dates.
  return Number.isFinite(date.getTime()) && date.getTime() !== 0 ? new Intl.DateTimeFormat(locale === 'el' ? 'el-GR' : 'en-GB', { dateStyle: 'medium' }).format(date) : '—'
}
