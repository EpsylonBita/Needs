export const paymentFlowCopy = {
  en: {
    checkout: 'Checkout', fee: 'Platform fee', pay: 'Pay', processing: 'Processing…', preparing: 'Preparing checkout…',
    total: 'Total to pay', agreedTotal: 'Agreed service total', backToChat: 'Return to conversation', agreementError: 'The agreement could not be saved. Your draft is still here.',
    confirmError: 'Payment could not be confirmed. Please try again.', initError: 'The payment could not be initialized.',
    sellerHint: 'Ask the seller to complete Stripe onboarding to enable payments.',
    onboarding: 'Stripe Onboarding', onboardingIntro: 'Enable payouts by completing onboarding.', start: 'Start Onboarding', redirecting: 'Redirecting…',
    onboardingError: 'Failed to start onboarding', refreshOnboarding: 'Onboarding Refresh', refreshing: 'Refreshing your secure onboarding link…', retry: 'Try again',
    checking: 'Checking your Stripe account…', onboardingComplete: 'Onboarding Complete', ready: 'Your account is ready to receive payouts.',
    incomplete: 'Stripe still needs information or verification before payouts can be enabled.', continue: 'Continue onboarding', accountError: 'Could not check your payout account.',
    paymentStatus: 'Payment status', nextSteps: 'Both parties must confirm completion before payment can be finalized. The latest verified status is shown below.',
    status: 'Status', amount: 'Amount', actions: 'Actions', goPayments: 'Go to Payments', capture: 'Finalize payment', capturing: 'Processing…',
    loading: 'Loading payments…', noRecent: 'No recent payments', loadError: 'Payments could not be loaded. Please try again.', refresh: 'Refresh status',
    captureError: 'Payment could not be finalized. Refresh its status and try again.', pending: 'Your payment request was received. Its result is still being verified. Refresh its status before trying again.',
    captureRefreshError: 'Your payment request was received, but its latest status could not be loaded. Refresh to check it.',
  },
  el: {
    checkout: 'Πληρωμή', fee: 'Προμήθεια πλατφόρμας', pay: 'Πληρωμή', processing: 'Επεξεργασία…', preparing: 'Προετοιμασία πληρωμής…',
    total: 'Συνολικό ποσό πληρωμής', agreedTotal: 'Συμφωνημένο συνολικό ποσό', backToChat: 'Επιστροφή στη συνομιλία', agreementError: 'Η συμφωνία δεν αποθηκεύτηκε. Το πρόχειρό σου παραμένει εδώ.',
    confirmError: 'Η πληρωμή δεν επιβεβαιώθηκε. Δοκίμασε ξανά.', initError: 'Η πληρωμή δεν μπόρεσε να ξεκινήσει.',
    sellerHint: 'Ζήτησε από τον πωλητή να ολοκληρώσει τη σύνδεση με το Stripe για να δέχεται πληρωμές.',
    onboarding: 'Σύνδεση με το Stripe', onboardingIntro: 'Ολοκλήρωσε τα στοιχεία σου για να μπορείς να λαμβάνεις χρήματα.', start: 'Έναρξη σύνδεσης', redirecting: 'Μεταφορά στο Stripe…',
    onboardingError: 'Η σύνδεση με το Stripe δεν μπόρεσε να ξεκινήσει.', refreshOnboarding: 'Ανανέωση σύνδεσης με το Stripe', refreshing: 'Ανανέωση του ασφαλούς συνδέσμου σύνδεσης…', retry: 'Δοκίμασε ξανά',
    checking: 'Έλεγχος του λογαριασμού σου στο Stripe…', onboardingComplete: 'Η σύνδεση ολοκληρώθηκε', ready: 'Ο λογαριασμός σου είναι έτοιμος να λαμβάνει χρήματα.',
    incomplete: 'Το Stripe χρειάζεται ακόμη στοιχεία ή επαλήθευση πριν μπορέσεις να λαμβάνεις χρήματα.', continue: 'Συνέχεια σύνδεσης', accountError: 'Ο λογαριασμός πληρωμών σου δεν μπόρεσε να ελεγχθεί.',
    paymentStatus: 'Κατάσταση πληρωμής', nextSteps: 'Και τα δύο μέρη πρέπει να επιβεβαιώσουν την ολοκλήρωση πριν οριστικοποιηθεί η πληρωμή. Παρακάτω εμφανίζεται η τελευταία επαληθευμένη κατάσταση.',
    status: 'Κατάσταση', amount: 'Ποσό', actions: 'Ενέργειες', goPayments: 'Οι πληρωμές μου', capture: 'Οριστικοποίηση πληρωμής', capturing: 'Επεξεργασία…',
    loading: 'Φόρτωση πληρωμών…', noRecent: 'Δεν υπάρχουν πρόσφατες πληρωμές', loadError: 'Οι πληρωμές δεν φορτώθηκαν. Δοκίμασε ξανά.', refresh: 'Ανανέωση κατάστασης',
    captureError: 'Η πληρωμή δεν οριστικοποιήθηκε. Ανανέωσε την κατάστασή της και δοκίμασε ξανά.', pending: 'Το αίτημα πληρωμής παραλήφθηκε. Το αποτέλεσμα επαληθεύεται ακόμη. Ανανέωσε την κατάσταση πριν δοκιμάσεις ξανά.',
    captureRefreshError: 'Το αίτημα πληρωμής παραλήφθηκε, αλλά δεν φορτώθηκε η νεότερη κατάστασή του. Ανανέωσε για να την ελέγξεις.',
  },
};

const greekErrors: Record<string, string> = {
  'This listing uses a rate per unit. Agree on a total in chat before online payment.': 'Αυτή η αγγελία έχει χρέωση ανά μονάδα. Συμφωνήστε συνολικό ποσό στη συνομιλία πριν από online πληρωμή.',
  'Choose either an agreement or a milestone for checkout.': 'Επίλεξε μία συμφωνία ή ένα στάδιο για την πληρωμή.',
  'Choose the conversation for this agreement.': 'Επίλεξε τη συνομιλία αυτής της συμφωνίας.',
  'The payment total could not be verified.': 'Το συνολικό ποσό πληρωμής δεν μπόρεσε να επαληθευτεί. Επέστρεψε στη συνομιλία και ανανέωσε τη συμφωνία.',
  'Your account changed. Open checkout again before paying.': 'Άλλαξε ο λογαριασμός σου. Άνοιξε ξανά τη σελίδα πληρωμής πριν συνεχίσεις.',
  'Enter a total between €0.50 and €999,999.99, with at most two decimals.': 'Συμπλήρωσε συνολικό ποσό από 0,50 € έως 999.999,99 € με έως δύο δεκαδικά ψηφία.',
  'Too many agreement changes. Please try again later.': 'Έγιναν πολλές αλλαγές στη συμφωνία. Δοκίμασε ξανά αργότερα.',
  'Agreed totals are available for services charged per unit.': 'Η συμφωνία συνολικού ποσού είναι διαθέσιμη για υπηρεσίες με χρέωση ανά μονάδα.',
  'The agreement changed. Refresh the conversation and try again.': 'Η συμφωνία άλλαξε. Ανανέωσε τη συνομιλία και δοκίμασε ξανά.',
  'The listing changed. Propose and accept a new total.': 'Η αγγελία άλλαξε. Προτείνετε και αποδεχτείτε νέο συνολικό ποσό.',
  'The agreement could not be saved. Refresh the conversation and try again.': 'Η συμφωνία δεν αποθηκεύτηκε. Ανανέωσε τη συνομιλία και δοκίμασε ξανά.',
  'This agreement is locked because checkout has started.': 'Η συμφωνία δεν μπορεί να αλλάξει επειδή ξεκίνησε η διαδικασία πληρωμής.',
  'Payments are not configured.': 'Οι πληρωμές δεν είναι διαθέσιμες αυτή τη στιγμή.',
  'Payments are currently disabled': 'Οι πληρωμές δεν είναι διαθέσιμες αυτή τη στιγμή.',
  'Sign in to continue to checkout.': 'Συνδέσου για να συνεχίσεις στην πληρωμή.',
  'Not authenticated': 'Συνδέσου για να συνεχίσεις.',
  'Please sign in to continue onboarding.': 'Συνδέσου για να συνεχίσεις τη σύνδεση με το Stripe.',
  'Please sign in to check your payout account.': 'Συνδέσου για να ελέγξεις τον λογαριασμό πληρωμών σου.',
  'Profile not found': 'Το προφίλ σου δεν βρέθηκε. Συνδέσου ξανά και δοκίμασε πάλι.',
  'Could not prepare a secure payment request. Refresh and try again.': 'Το ασφαλές αίτημα πληρωμής δεν μπόρεσε να προετοιμαστεί. Ανανέωσε και δοκίμασε ξανά.',
  'Could not prepare a secure request. Refresh and try again.': 'Το ασφαλές αίτημα δεν μπόρεσε να προετοιμαστεί. Ανανέωσε και δοκίμασε ξανά.',
  'Milestone proposal not found.': 'Το συμφωνημένο στάδιο πληρωμής δεν βρέθηκε.',
  'Seller not set up for payments': 'Ο πωλητής δεν έχει ενεργοποιήσει τις πληρωμές.',
  'Only the requester can pay this provider': 'Μόνο ο δημιουργός του αιτήματος μπορεί να πληρώσει αυτόν τον πάροχο.',
  'Listing not found or unavailable': 'Η αγγελία δεν βρέθηκε ή δεν είναι διαθέσιμη.',
  'Your card was declined.': 'Η κάρτα σου απορρίφθηκε. Δοκίμασε άλλη κάρτα ή επικοινώνησε με την τράπεζά σου.',
  'Sign in to view your payments.': 'Συνδέσου για να δεις τις πληρωμές σου.',
  'Your payment profile could not be loaded.': 'Το προφίλ πληρωμών σου δεν φορτώθηκε.',
  'Sign in again before capturing this payment.': 'Συνδέσου ξανά πριν οριστικοποιήσεις αυτή την πληρωμή.',
  'This older request payment needs administrator review before it can be captured.': 'Αυτή η παλαιότερη πληρωμή αιτήματος χρειάζεται έλεγχο από διαχειριστή πριν ολοκληρωθεί.',
  'This payment cannot be captured in its current state.': 'Η πληρωμή δεν μπορεί να οριστικοποιηθεί στην τρέχουσα κατάστασή της.',
  'Both parties must confirm an authorized order without an open dispute': 'Και τα δύο μέρη πρέπει να επιβεβαιώσουν την εγκεκριμένη πληρωμή, χωρίς ανοικτή αμφισβήτηση.',
  'Too many payment attempts. Please try again later.': 'Έγιναν πολλές προσπάθειες πληρωμής. Δοκίμασε ξανά αργότερα.',
};

type FlowErrorFallback = 'confirmError' | 'initError' | 'onboardingError' | 'accountError' | 'loadError' | 'captureError' | 'captureRefreshError' | 'agreementError';

/** Translate known app/server messages while keeping provider-localized Greek errors useful. */
export function paymentFlowError(message: string | null, locale: string, fallback: FlowErrorFallback): string {
  const language = locale === 'el' ? 'el' : 'en';
  if (!message) return paymentFlowCopy[language][fallback];
  if (language === 'en') return message;
  return greekErrors[message] || (/\p{Script=Greek}/u.test(message) ? message : paymentFlowCopy.el[fallback]);
}
