export const legalDraftContent = {
  el: {
    badge: 'ΠΡΟΣΧΕΔΙΟ — ΔΟΚΙΜΑΣΤΙΚΑ ΣΤΟΙΧΕΙΑ',
    notice: 'Κείμενο για έλεγχο, χωρίς ημερομηνία έναρξης ισχύος. Η επωνυμία, η διεύθυνση και τα email παρακάτω είναι MOCK και δεν είναι ενεργά στοιχεία επικοινωνίας. Απαιτούνται αντικατάσταση και τελικός έλεγχος πριν από το λανσάρισμα.',
    operatorHeading: 'Στοιχεία φορέα προς αντικατάσταση',
    labels: ['Φορέας', 'Επαγγελματική διεύθυνση', 'Υποστήριξη — ανενεργό mock', 'Απόρρητο — ανενεργό mock'],
    contact: 'Φόρμα επικοινωνίας της εφαρμογής',
    contactNote: 'Η φόρμα αποθηκεύει αιτήματα. Δεν τεκμηριώνει ότι έχει παραδοθεί email.',
    termsTitle: 'Προσχέδιο όρων χρήσης και πληρωμών',
    privacyTitle: 'Προσχέδιο ενημέρωσης απορρήτου',
    terms: [
      { id: 'platform', title: '1. Η πλατφόρμα και η συναλλαγή', paragraphs: [
        'Το NEEDS παρέχει αγγελίες αντικειμένων και υπηρεσιών, αναζήτηση, συνομιλίες και εργαλεία πληρωμής. Οι πλευρές συμφωνούν το αντικείμενο, τον χρόνο και τον τρόπο παράδοσης ή εκτέλεσης. Η τελική κατανομή ευθυνών πλατφόρμας και χρηστών χρειάζεται νομικό έλεγχο.',
        'Τα στοιχεία λογαριασμού και οι αγγελίες πρέπει να είναι ακριβή. Οι αυτόματες προτάσεις τίτλου, κατηγορίας, τιμής και tags ελέγχονται πριν από τη δημοσίευση. Απαγορεύονται απάτη, παράνομο περιεχόμενο και κοινοποίηση στοιχείων τρίτων χωρίς δικαίωμα.',
      ] },
      { id: 'agreement', title: '2. Συμφωνία τιμής για υπηρεσίες', paragraphs: [
        'Στις υπηρεσίες ανά ώρα, η ωριαία τιμή δεν είναι αυτόματα το τελικό ποσό πληρωμής. Πριν από checkout, μία πλευρά προτείνει συνολικό ποσό στη συνομιλία και η άλλη το αποδέχεται. Η πληρωμή αντιστοιχεί στη συγκεκριμένη συμφωνία. Αλλαγές εργασίας ή τιμήματος χρειάζονται νέα σαφή συμφωνία· δεν χρεώνονται απεριόριστες ώρες αυτόματα.',
      ] },
      { id: 'authorization', title: '3. Δέσμευση κάρτας και οριστικοποίηση', paragraphs: [
        'Η ροή χρησιμοποιεί Stripe με προσωρινή έγκριση/δέσμευση κάρτας και μεταγενέστερη οριστικοποίηση. Μπορεί να ζητηθεί επιβεβαίωση 3D Secure. Η εφαρμογή απαιτεί επιβεβαίωση ολοκλήρωσης και από τις δύο πλευρές πριν ζητηθεί η χρέωση. Ο αυτόματος έλεγχος κατάστασης δεν χρεώνει από μόνος του.',
        'Η προθεσμία προκύπτει από τη Stripe και την κάρτα. Μετά τη λήξη μπορεί να απαιτείται νέα διαδικασία πληρωμής. Παράπονα ή συνομιλίες δεν παρατείνουν την έγκριση. Η λειτουργία δεν αποτελεί υπόσχεση απεριόριστης φύλαξης χρημάτων, τραπεζικής μεσεγγύησης ή εγγυημένης αποζημίωσης.',
      ] },
      { id: 'fees', title: '4. Προμήθεια — σχέδιο προς έγκριση', paragraphs: [
        'Η τρέχουσα δοκιμαστική υλοποίηση υπολογίζει προμήθεια πλατφόρμας 5% από το ποσό πληρωμής, με στρογγυλοποίηση στο λεπτό. Δεν την προσθέτει πάνω από το συμφωνημένο ποσό του αγοραστή: σε €100 η προμήθεια είναι €5. Πρόκειται για περιγραφή ρύθμισης, όχι τελικό εμπορικό τιμοκατάλογο. ΦΠΑ, παραστατικά, χρεώσεις παρόχου και κόστος επιστροφών ή αμφισβητήσεων παραμένουν προς καθορισμό και γνωστοποίηση.',
      ] },
      { id: 'cancellation', title: '5. Ακύρωση και επιστροφή', paragraphs: [
        'Πριν από τη χρέωση, μία πλευρά μπορεί να ζητήσει ακύρωση και η άλλη να αποδεχθεί ή να απορρίψει το συγκεκριμένο αίτημα. Η αποδοχή ζητά αποδέσμευση από τη Stripe. Η εφαρμογή εμφανίζει αποδέσμευση αφού επαληθευτεί στον πάροχο. Υπάρχει επίσης διαδικασία διαχειριστή με καταγεγραμμένο λόγο. Μετά τη χρέωση απαιτείται διαδικασία επιστροφής· η υποβολή παραπόνου δεν σημαίνει αυτόματη επιστροφή.',
        'Η συναίνεση ακύρωσης και οι επιβεβαιώσεις ολοκλήρωσης δεν καταργούν υποχρεωτικά δικαιώματα καταναλωτή, υπαναχώρησης ή αξιώσεις για ελαττώματα. Οι εφαρμοστέοι όροι εξαρτώνται από τη συναλλαγή και την ιδιότητα των πλευρών και θα εξειδικευτούν πριν από το λανσάρισμα.',
      ] },
      { id: 'disputes', title: '6. Παράπονα και τραπεζικές αμφισβητήσεις', paragraphs: [
        'Το παράπονο μέσα στο NEEDS είναι διαφορετικό από την αμφισβήτηση πληρωμής στην τράπεζα. Η τραπεζική κατάσταση ενημερώνεται από τη Stripe. Η καταγραφή απόφασης δεν εγγυάται ότι διευθετήθηκε κάθε οικονομική υποχρέωση μεταξύ πλατφόρμας και παρόχου.',
        'Η προτεινόμενη ανάκτηση χρημάτων από πάροχο απαιτεί χωριστή, καταγεγραμμένη ενέργεια διαχειριστή και έλεγχο της συναλλαγής. Νομική βάση, ενημέρωση παρόχου, δικαιώματα αντίρρησης και χειρισμός μεταγενέστερης αλλαγής απόφασης παραμένουν προς τελική έγκριση. Το προσχέδιο δεν δίνει γενική εξουσιοδότηση για νέες χρεώσεις ή μεταφορές.',
      ] },
      { id: 'pending', title: '7. Στοιχεία τελικής έκδοσης που εκκρεμούν', paragraphs: [
        'Πραγματικός φορέας και ενεργή επικοινωνία, ιδιότητα επαγγελματία/ιδιώτη, ηλικιακή πολιτική, προσυμβατικές πληροφορίες, διαδικασία υπαναχώρησης όπου απαιτείται, εποπτεία περιεχομένου, φορολογική μεταχείριση και όροι επίλυσης διαφορών. Δεν έχει δηλωθεί οριστική δικαιοδοσία ή ημερομηνία ισχύος.',
      ] },
    ],
    privacy: [
      { id: 'controller', title: '1. Υπεύθυνος επεξεργασίας', paragraphs: [
        'Τα στοιχεία φορέα στην αρχή είναι δοκιμαστικά. Ο πραγματικός υπεύθυνος επεξεργασίας και τα ενεργά στοιχεία για αιτήματα δικαιωμάτων θα συμπληρωθούν πριν από την τελική δημοσίευση.',
      ] },
      { id: 'data', title: '2. Δεδομένα της εφαρμογής', paragraphs: [
        'Χρησιμοποιούνται στοιχεία λογαριασμού και επικοινωνίας, περιγραφές και φωτογραφίες αγγελιών, κατηγορίες, τιμές, tags και τοποθεσία. Οι συνομιλίες και συναλλαγές περιλαμβάνουν μηνύματα, συμφωνημένα ποσά, επιβεβαιώσεις, αναφορές πληρωμών, καταστάσεις και παράπονα. Η υποστήριξη λαμβάνει όσα καταχωρίζεις στη φόρμα επικοινωνίας. Χρησιμοποιούνται επίσης τεχνικά στοιχεία αιτημάτων και καταγραφές ενεργειών για ασφάλεια και λειτουργία.',
        'Μην εισάγεις πλήρη στοιχεία κάρτας, κωδικούς ή περιττά ευαίσθητα δεδομένα σε αγγελίες, συνομιλίες και φόρμες.',
      ] },
      { id: 'visibility', title: '3. Δημοσίευση και τοποθεσία', paragraphs: [
        'Στοιχεία δημόσιας αγγελίας, όπως φωτογραφίες, περιγραφή, τοποθεσία και τηλέφωνο επικοινωνίας, μπορούν να εμφανίζονται στους επισκέπτες της. Έλεγξέ τα πριν δημοσιεύσεις, ακόμη και όταν το τηλέφωνο συμπληρώνεται από το προφίλ.',
        'Η τοποθεσία συσκευής είναι προαιρετική και ζητά άδεια browser. Μπορείς να πληκτρολογήσεις τοποθεσία. Για προτάσεις διευθύνσεων και χάρτες διαβιβάζονται στη Mapbox το σχετικό κείμενο αναζήτησης ή οι επιλεγμένες συντεταγμένες, μαζί με τεχνικά στοιχεία σύνδεσης.',
      ] },
      { id: 'providers', title: '4. Υπηρεσίες που συμμετέχουν', paragraphs: [
        'Supabase: σύνδεση χρηστών, βάση, αποθήκευση και λειτουργίες πραγματικού χρόνου. Stripe: πληρωμές και στοιχεία συνδεδεμένου παρόχου. Η φόρμα κάρτας παρέχεται από τη Stripe· το NEEDS χρησιμοποιεί αναγνωριστικά και κατάσταση πληρωμής. Mapbox: χάρτες και αναζήτηση τοποθεσίας.',
        'Ο προσαρμογέας Resend αφορά ειδοποιήσεις της φόρμας επικοινωνίας, εφόσον ρυθμιστεί. Τα email λογαριασμού μέσω Supabase και οι αποδείξεις Stripe είναι χωριστές ρυθμίσεις. Οι προειδοποιήσεις λήξης πληρωμών είναι σήμερα μέσα στην εφαρμογή, όχι επιβεβαιωμένη αποστολή email.',
        'Συμβατικοί ρόλοι, χώρες επεξεργασίας, συμβάσεις και εγγυήσεις διαβίβασης χρειάζονται επαλήθευση. Δεν δηλώνεται ότι όλα τα δεδομένα παραμένουν αποκλειστικά στην ΕΕ.',
      ] },
      { id: 'purposes', title: '5. Σκοποί και νομικές βάσεις προς οριστικοποίηση', paragraphs: [
        'Οι λειτουργίες εξυπηρετούν λογαριασμούς, δημοσίευση και αναζήτηση, επικοινωνία, συμφωνημένες πληρωμές, υποστήριξη και προστασία από κατάχρηση. Η τελική πολιτική θα αντιστοιχίσει κάθε σκοπό στη συγκεκριμένη κατάλληλη νομική βάση και θα εξηγήσει ποια στοιχεία είναι αναγκαία ή προαιρετικά.',
        'Η αποδοχή όρων δεν αποτελεί γενική συγκατάθεση για κάθε επεξεργασία. Marketing και μη αναγκαίες τεχνολογίες χρειάζονται χωριστή αξιολόγηση και κατάλληλες επιλογές πριν ενεργοποιηθούν.',
      ] },
      { id: 'retention', title: '6. Διατήρηση και δικαιώματα', paragraphs: [
        'Το πρόγραμμα διατήρησης, οι χρόνοι διαγραφής και τα αντίγραφα ασφαλείας παραμένουν προς καθορισμό ανά κατηγορία δεδομένων. Δεν δίνεται υπόσχεση αυτόματης διαγραφής μετά από μη επαληθευμένο αριθμό ημερών. Οικονομικά αρχεία και εκκρεμείς διαφορές εξετάζονται χωριστά.',
        'Οι ρυθμίσεις λογαριασμού διαθέτουν εξαγωγή δεδομένων και αίτημα διαγραφής. Η υποβολή δεν διαγράφει αμέσως τον λογαριασμό ή το οικονομικό ιστορικό. Τα αιτήματα εξετάζονται μαζί με εκκρεμείς συναλλαγές και τυχόν υποχρεώσεις διατήρησης, χωρίς κατάργηση νόμιμων δικαιωμάτων.',
        'Η τελική ενημέρωση θα περιγράφει τα εφαρμοστέα δικαιώματα πρόσβασης, διόρθωσης, διαγραφής, περιορισμού, εναντίωσης και φορητότητας, ανάκληση συγκατάθεσης όπου χρησιμοποιείται και προσφυγή στην αρμόδια εποπτική αρχή. Τα mock email δεν είναι κανάλι υποβολής αιτημάτων.',
      ] },
      { id: 'storage', title: '7. Cookies, ασφάλεια και αλλαγές', paragraphs: [
        'Χρησιμοποιούνται τεχνολογίες σύνδεσης, ασφάλειας και προτιμήσεων. Η τελική καταγραφή cookies/τοπικής αποθήκευσης πρέπει να περιλαμβάνει χάρτες και πληρωμές και τις απαιτούμενες επιλογές. Δεν δηλώνεται ολοκληρωμένος έλεγχος συμμόρφωσης. Οι προτάσεις αγγελίας παραμένουν επεξεργάσιμες. Η τελική πολιτική θα έχει πραγματική ημερομηνία ισχύος και τρόπο ενημέρωσης για ουσιαστικές αλλαγές.',
      ] },
    ],
  },
  en: {
    badge: 'DRAFT — MOCK DETAILS',
    notice: 'Review copy with no effective date. The operator name, address and emails below are MOCK placeholders, not active contact details. Replace them and complete the final review before launch.',
    operatorHeading: 'Operator details to replace',
    labels: ['Operator', 'Business address', 'Support — inactive mock', 'Privacy — inactive mock'],
    contact: 'Application contact form',
    contactNote: 'The form stores requests. This does not establish email delivery.',
    termsTitle: 'Draft terms of use and payments',
    privacyTitle: 'Draft privacy notice',
    terms: [
      { id: 'platform', title: '1. The platform and the transaction', paragraphs: [
        'NEEDS provides listings for items and services, search, conversations and payment tools. The parties agree the item or work, timing and delivery or performance. The final allocation of platform and user responsibilities requires legal review.',
        'Account and listing information must be accurate. Users review suggested titles, categories, prices and tags before publication. Fraud, unlawful content and disclosure of other people’s information without authority are prohibited.',
      ] },
      { id: 'agreement', title: '2. Agreeing a service price', paragraphs: [
        'For hourly services, the hourly rate is not automatically the payment total. Before checkout, one party proposes a total in the conversation and the other accepts it. Payment is tied to that agreement. Changes to scope or price require a clear new agreement; unlimited hours are not charged automatically.',
      ] },
      { id: 'authorization', title: '3. Card authorization and capture', paragraphs: [
        'The flow uses Stripe to authorize and temporarily hold card funds, then capture them later. A 3D Secure challenge may be required. Both parties must confirm completion before capture can be requested. Automatic status checks do not capture funds themselves.',
        'The authorization deadline comes from Stripe and the card. Expiry can require a new payment flow. Complaints or conversations do not extend authorization. This feature is not a promise of unlimited holding, a bank escrow account or guaranteed compensation.',
      ] },
      { id: 'fees', title: '4. Platform fee — proposed terms', paragraphs: [
        'The current test implementation calculates a 5% platform fee from the payment amount, rounded to the cent. It does not add that fee on top of the buyer’s agreed total: a €100 payment has a €5 platform fee. This describes a configuration, not a finalized tariff. VAT, invoicing, provider charges and refund or dispute costs still need to be determined and disclosed.',
      ] },
      { id: 'cancellation', title: '5. Cancellation and refunds', paragraphs: [
        'Before capture, either party can request cancellation and the other can accept or reject that exact request. Acceptance requests release through Stripe. Release is shown after the provider state is verified. An administrator can also request release with a recorded reason. Captured payments require a refund procedure; filing a complaint does not automatically refund money.',
        'Cancellation consent and completion confirmations do not waive mandatory consumer, withdrawal or defective-performance rights. Applicable terms depend on the transaction and the parties’ status and must be specified before launch.',
      ] },
      { id: 'disputes', title: '6. Complaints and bank disputes', paragraphs: [
        'An in-app complaint is separate from disputing a payment with a bank. Bank-dispute status is updated from Stripe. Recording a decision does not guarantee that every financial obligation between the platform and provider has been settled.',
        'Proposed provider-funds recovery requires a separate recorded administrator action and review of the transaction. Its legal basis, provider notice, objection rights and handling of a later changed decision still require final approval. This draft gives no general authorization for new charges or transfers.',
      ] },
      { id: 'pending', title: '7. Items pending in the final version', paragraphs: [
        'Actual operator and active contacts, trader/private-seller status, age policy, pre-contract information, withdrawal procedures where required, content moderation, tax treatment and dispute-resolution terms. No final jurisdiction or effective date has been specified.',
      ] },
    ],
    privacy: [
      { id: 'controller', title: '1. Data controller', paragraphs: [
        'The operator details above are placeholders. The actual controller and active rights-request contacts must be completed before final publication.',
      ] },
      { id: 'data', title: '2. Application information', paragraphs: [
        'Information includes account and contact details, listing descriptions and photos, categories, prices, tags and location. Conversations and transactions include messages, agreed totals, confirmations, payment references, statuses and complaints. Support receives information submitted in the contact form. Technical request details and action records are also used for security and operation.',
        'Do not put full card details, passwords or unnecessary sensitive information in listings, conversations or forms.',
      ] },
      { id: 'visibility', title: '3. Publication and location', paragraphs: [
        'Public-listing information such as photos, descriptions, location and contact phone number can be visible to visitors. Review it before publication, including phone numbers automatically filled from your profile.',
        'Device location is optional and requires browser permission. You can enter a location manually. Address suggestions and maps send relevant search text or selected coordinates to Mapbox, together with technical connection information.',
      ] },
      { id: 'providers', title: '4. Services involved', paragraphs: [
        'Supabase provides authentication, database, storage and realtime features. Stripe handles payments and connected-provider details. The card form is provided by Stripe; NEEDS uses payment identifiers and status. Mapbox provides maps and location search.',
        'The Resend adapter handles contact-form notifications if configured. Supabase account emails and Stripe receipts are separate configurations. Payment-expiry warnings currently appear inside the application; email delivery of those warnings is not implemented or verified.',
        'Contractual roles, processing countries, agreements and transfer safeguards need verification. This draft does not claim that all data remains exclusively in the EU.',
      ] },
      { id: 'purposes', title: '5. Purposes and legal bases to finalize', paragraphs: [
        'Functions support accounts, publishing and search, communication, agreed payments, support and abuse prevention. The final notice must map each purpose to its appropriate specific legal basis and explain which information is necessary or optional.',
        'Accepting the terms is not blanket consent to every processing activity. Marketing and non-essential technologies require separate assessment and appropriate choices before activation.',
      ] },
      { id: 'retention', title: '6. Retention and rights', paragraphs: [
        'Retention schedules, deletion periods and backup handling remain to be defined for each data category. There is no promise of automatic deletion after an unverified number of days. Financial records and unresolved disputes need separate review.',
        'Account settings offer data export and a deletion-request workflow. Submitting a request does not immediately erase the account or financial history. Requests are reviewed alongside pending transactions and retention obligations without removing statutory rights.',
        'The final notice must explain applicable access, correction, erasure, restriction, objection and portability rights, withdrawal of consent where used, and complaints to the competent supervisory authority. The mock emails are not a channel for these requests.',
      ] },
      { id: 'storage', title: '7. Cookies, security and changes', paragraphs: [
        'Technologies support authentication, security and preferences. The final cookie/local-storage inventory must cover maps and payments and include required choices. This is not a completed compliance assessment. Listing suggestions remain editable. The final notice needs an actual effective date and a way to communicate material changes.',
      ] },
    ],
  },
} as const
