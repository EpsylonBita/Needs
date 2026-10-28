# NEEDS — Τελική επαλήθευση UX, 28/10/2026

Η τοπική έκδοση ελέγχθηκε με πραγματικό Mapbox και χωριστά με πραγματικό γεωγραφικό RPC. Οι πρόσθετες διορθώσεις περιορίστηκαν σε επιβεβαιωμένα προβλήματα: απομόνωση προσχεδίου ανά λογαριασμό, λήξη μέσα σε ανοικτό παράθυρο σύνδεσης, ακύρωση υποβολής κατά την αλλαγή λογαριασμού και συνεπής εφαρμογή της ήδη τεκμηριωμένης πολιτικής των οκτώ demo αγγελιών.

Δεν έγινε commit, deployment, αλλαγή live δεδομένων/οικονομικών κανόνων, πραγματική δημοσίευση, χρέωση ή αποστολή μηνύματος/email. Οι προϋπάρχουσες αλλαγές της προηγούμενης υλοποίησης διατηρήθηκαν. Η παρούσα αναφορά συμπληρώνει την [προηγούμενη αναφορά](D:/Projects/Active/needs/docs/UX_REPAIRS_2026-10-28.md), αντικαθιστώντας τα παλιά όρια επαλήθευσης Mapbox, RPC και ταυτότητας demo.

## Έκδοση και τεκμήρια

- Commit βάσης: `a18220dc683edc1b039478a1f8a430886938d302`.
- SHA-256 πηγαίων αρχείων εφαρμογής: `d24ce198fdc5d9ba5ac819971aeb4f1df28528b9a695b4e2959624fb91a53ef3`.
- [Κατάλογος 459 αρχείων και hashes](D:/Projects/Active/needs/output/playwright/final-verification/source-version.json).
- [Πλήρες τελικό diff](D:/Projects/Active/needs/output/playwright/final-verification/final-working-tree.patch), με tracked **και untracked** αρχεία, και [στοιχεία/hash του diff](D:/Projects/Active/needs/output/playwright/final-verification/final-diff.json). Δεν περιλαμβάνει ignored credentials ή build outputs.

## Πραγματικές συνδέσεις και fixtures

| Έλεγχος | Περιβάλλον / δεδομένα | Αποτέλεσμα |
|---|---|---|
| Mapbox style, tiles, glyphs και geocoding | Νέο τοπικό production build `xCq_89TA9D8g3FFngTI4B`, Next 16.4.3, Node 24.22.1, Chromium 148.0.7778.96, desktop 1280×800 και Pixel 7 viewport | 2/2 πέρασαν, πραγματικά HTTP 200, χωρίς uncaught browser errors |
| Επιλογή περιοχής και ακτίνας | Πραγματικό geocoding: `Athens, Attica, Greece`, `[23.729275,37.97757]`, 12 km | Ίδιες συντεταγμένες/ακτίνα σε URL και query· περιοχή και όλα τα φίλτρα διατηρούνται μετά την αγγελία και επιστροφή |
| Αγγελίες κατά τον browser έλεγχο Mapbox | Fixture API/backend/auth, αποκλεισμένα τρίτα endpoints και μη αναγκαίες provider εγγραφές | Αποδεικνύεται η διαδρομή UI/query, χωριστά από τη λειτουργία του πραγματικού RPC |
| `nearby_listings` | Υπάρχον Supabase `qczrqxmewjsydrrvjdil`, δημόσια ανώνυμη HTTP ανάγνωση και ανεξάρτητες PostGIS αποστάσεις | 1 km: 1, 3 km: 5, 6 km: 8 γνωστές καταχωρίσεις, με ακριβή έλεγχο IDs εντός/εκτός |
| Login, εγγραφή/email, δημοσίευση και αποτυχία υποβολής | Τοπικά browser fixtures και unit mocks, ελεγχόμενος χρόνος | Καμία πραγματική εγγραφή λογαριασμού, email ή δημοσίευση |
| Νέοι περιορισμοί demo στη βάση | Η πραγματική τοπική migration εκτελέστηκε σε απομονωμένο PGlite | Δεν εφαρμόστηκε στο live backend |

Τεκμήρια Mapbox: [desktop JSON](D:/Projects/Active/needs/output/playwright/final-verification/real-mapbox-desktop-chromium.json), [mobile JSON](D:/Projects/Active/needs/output/playwright/final-verification/real-mapbox-mobile-chromium.json), [log](D:/Projects/Active/needs/output/playwright/final-verification/real-mapbox.log). Δεν αποθηκεύτηκαν tokens, headers, traces ή πλήρη provider URLs με credentials.

Κέντρο πραγματικού RPC: longitude `23.7305`, latitude `37.9735`. Στα 3 km περιλαμβάνονται κιθάρα (0 m), εργαλεία (1068,87 m), yoga (1323,05 m), βιβλία (1481,83 m), ποδήλατο (2020,80 m). Αποκλείονται υπολογιστής (3203,46 m), σκαμπό (3296,60 m) και αγγλικά (5512,84 m). [HTTP αποτελέσματα](D:/Projects/Active/needs/output/playwright/final-verification/nearby-listings-live.json) · [PostGIS αποστάσεις](D:/Projects/Active/needs/output/playwright/final-verification/nearby-listings-sql.json).

Δεν βρέθηκε κατάλληλος υπάρχων δοκιμαστικός λογαριασμός/password για πραγματικό login: τα παλιά auth/preview fixtures έχουν διαγραφεί και ο demo λογαριασμός έχει απαγόρευση login και τυχαίο μη αποθηκευμένο password. Δεν δημιουργήθηκε νέος λογαριασμός ή OTP. Για αυτή τη συγκεκριμένη επιπλέον επαλήθευση χρειάζεται υπάρχων κατάλληλος λογαριασμός.

Η ιστορική αποτυχία του παλιού χάρτη παραμένει μη αναπαραχθείσα. Δεν άλλαξε provider ή token. Τα επιτυχή desktop/mobile αποτελέσματα αφορούν το ελεγμένο Chromium, όχι κάθε φυσική συσκευή/browser.

## Πρόσθετες διορθώσεις

| Επιβεβαιωμένο πρόβλημα | Τελική συμπεριφορά και αρχεία |
|---|---|
| Προσχέδιο χωρίς ιδιοκτήτη μπορούσε να εμφανιστεί σε άλλον λογαριασμό | Versioned αποθήκευση, δέσιμο στον επαληθευμένο λογαριασμό, απόρριψη μη επαληθεύσιμων legacy records και καθαρισμός στο logout. `lib/listings/publication-intent.ts`, `lib/auth/return-path.ts`, `contexts/auth-context.ts`, auth/login/navbar |
| Ανοικτό παράθυρο auth μπορούσε να κρατήσει ληγμένο draft στη React μνήμη | Αρχικό `expiresAt` και έλεγχος στο handoff, χωρίς ανανέωση 24ώρου. Έλεγχοι στο ακριβές όριο και 1 ms πριν, ακόμη και χωρίς localStorage. `new-listing-button.tsx`, `navbar.tsx` |
| Αλλαγή λογαριασμού όσο εκκρεμούσε geocoding μπορούσε να υποβάλει παλιό περιεχόμενο | Ακύρωση ενεργής υποβολής και έλεγχος αναμενόμενου δημιουργού πριν από database writes· ίδια ταυτότητα σε upload/rollback. `create-ad-dialog.tsx`, `lib/services/listing-service.ts` |
| Demo αγγελίες εμφάνιζαν ενεργές ενέργειες συναλλαγής | Project-bound registry από αξιόπιστη πηγή, EL/EN notice, guard σε chat service, κοινό server transaction context και milestone proposal· UUID canonicalization. `lib/listings/demo-policy.ts`, `components/features/listings/demo-listing-notice.tsx`, search/home/profile/detail/map, `lib/services/chat-service.ts`, `lib/payments/transaction-context.ts`, `app/api/milestones/create/route.ts` |
| Άμεσο chat RPC παρέκαμπτε τον περιορισμό της εφαρμογής | Τοπική migration ενημερώνει δύο υπάρχουσες private functions, με exact IDs + αρχικό profile/user + trusted batch. Καμία νέα στήλη/πίνακας. Ιστορικό και τιμές διατηρούνται. [Migration](D:/Projects/Active/needs/supabase/migrations/20261028153000_demo_listing_transaction_policy.sql) |
| Δύο νέα lint warnings και μη διατηρήσιμα screenshots | Στοχευμένη διόρθωση effect dependency, τεκμηριωμένη εξαίρεση συγχρονισμού εξωτερικού URL state, durable screenshot paths και capture μετά από scroll-to-top/fonts/frame stabilization |

Επαληθεύονται επιπλέον: διατήρηση πρόθεσης/περιεχομένου επισκέπτη→auth, καθαρισμός draft και σχετικής συνέχειας μετά από επιτυχία ή ρητή απόρριψη, διατήρηση μετά από αποτυχία, άμεσο κλείσιμο/απόκρυψη φόρμας σε αλλαγή λογαριασμού. Το συμφωνημένο όριο παραμένει ίδιος browser και 24 ώρες, χωρίς συγχρονισμό μεταξύ συσκευών.

## Οι οκτώ demo αγγελίες

Πηγή **M**: [αρχικό manifest](D:/Projects/Active/needs-runtime-backups/demo-athens-20261014-manifest.json) και [script δημιουργίας](D:/Projects/Active/needs-runtime-backups/create-demo-profile-20261014.mjs), batch `needs-demo-athens-20261014`. Project, IDs, τίτλοι και trusted metadata αντιστοιχίστηκαν με τα live δεδομένα. Η υπάρχουσα περιγραφή δηλώνει: «Δείγμα εμφάνισης, δεν προσφέρεται προς συναλλαγή». Δεν χρησιμοποιήθηκαν τίτλοι, τιμή ή κοινός ιδιοκτήτης ως κριτήριο ταξινόμησης.

| ID | Τίτλος | Πηγή | Live / τελική τοπική συμπεριφορά | Απόφαση |
|---|---|---|---|---|
| `84cb699f-6bcd-46d1-8a48-b011ccb69bb9` | Ακουστική κιθάρα · Δοκιμαστική | M + live αντιστοίχιση | Live: περιγραφή demo, ενεργή καταχώριση· τοπικά: κοινή σήμανση και αποκλεισμός έναρξης συναλλαγής | Δεν λείπει ταυτότητα/πολιτική· εκκρεμεί διάθεση |
| `b471ea17-951b-4b69-b1b7-4adca7a9f834` | Ποδήλατο πόλης · Δοκιμαστική | M + live αντιστοίχιση | Ίδια | Ίδια |
| `16c556c6-4413-48be-bc03-cd4de48b46df` | Ξύλινο σκαμπό · Δοκιμαστική | M + live αντιστοίχιση | Ίδια | Ίδια |
| `9747633d-79e7-404f-a2e5-b64e365d33bb` | Εργαλεία κηπουρικής · Δοκιμαστική | M + live αντιστοίχιση | Ίδια | Ίδια |
| `8588184d-d6e1-4b66-aa11-5eb3128de7d2` | Yoga στη γειτονιά · Δοκιμαστική | M + live αντιστοίχιση | Ίδια | Ίδια |
| `3de235ad-2a89-4ae0-a101-14495078ce04` | Βιβλία για νέο σπίτι · Δοκιμαστική | M + live αντιστοίχιση | Ίδια | Ίδια |
| `a03c17b8-51f5-47ab-ad11-d86427c89e87` | Βοήθεια με υπολογιστή · Δοκιμαστική | M + live αντιστοίχιση | Ίδια | Ίδια |
| `6f193a95-70ca-4cea-9d45-7e4d790fe1d4` | Μάθημα αγγλικών · Δοκιμαστική | M + live αντιστοίχιση | Ίδια | Ίδια |

Η live έκδοση και τα άμεσα chat RPC διατηρούν ακόμη την προηγούμενη συμπεριφορά. Για εφαρμογή των περιορισμών χρειάζεται μελλοντική διάθεση του frontend μαζί με την ελεγμένη migration. Δεν εφαρμόστηκε migration στο πλαίσιο αυτής της εργασίας. Άσχετες αγγελίες του ίδιου προφίλ και direct profile συνομιλίες δεν περιορίζονται αυθαίρετα. [Αναλυτική τεκμηρίωση ταυτότητας και policy](D:/Projects/Active/needs/output/playwright/final-verification/demo-identity-and-rpc.md).

## Αποτελέσματα ελέγχων

Το ευρύτερο suite επαναλήφθηκε επειδή οι νέες διορθώσεις αγγίζουν authentication, δημιουργία αγγελίας και shared payment/chat boundaries· δεν έγινε γενικό cleanup ή αλλαγή εξαρτήσεων.

| Gate | Τελικό αποτέλεσμα / τεκμήριο |
|---|---|
| Production builds | Επιτυχία με πραγματικό Mapbox (`xCq_89TA9D8g3FFngTI4B`) και fixtures (`qPgsvENdCCNhgXYKnoBoK`), ίδιο runtime source hash |
| Real Mapbox browser | **2/2** desktop/mobile, [log](D:/Projects/Active/needs/output/playwright/final-verification/real-mapbox.log) |
| Πλήρες fixture E2E | **36/36**, [log](D:/Projects/Active/needs/output/playwright/final-verification/e2e.log) |
| Στοχευμένη επανάληψη εγγραφής μετά τη σταθεροποίηση screenshot | **2/2**, ίδιο build, [log](D:/Projects/Active/needs/output/playwright/final-verification/registration-recapture.log) |
| Vitest | Πλήρης εκτέλεση **159 αρχεία / 1.851 tests**: 1.843 πέρασαν, 8 παλιά assertions δεν περιλάμβαναν τα νέα expected account/AbortSignal arguments. Ενημερώθηκε μόνο αυτό το test αρχείο· επανέλεγχος **15/15 πέρασε**, χωρίς αλλαγή runtime. [Πλήρες log](D:/Projects/Active/needs/output/playwright/final-verification/unit.log) · [στοχευμένο τελικό rerun](D:/Projects/Active/needs/output/playwright/final-verification/unit-location-rerun.log) |
| Database suite | **130/130** σε απομονωμένο PGlite, [log](D:/Projects/Active/needs/output/playwright/final-verification/database.log). Επιπλέον 5 έλεγχοι της νέας πραγματικής migration περιλαμβάνονται στο Vitest |
| Scripts | **25/25**, [log](D:/Projects/Active/needs/output/playwright/final-verification/scripts.log) |
| TypeScript | `tsc --noEmit --pretty false --incremental false`: exit 0, [log](D:/Projects/Active/needs/output/playwright/final-verification/typecheck.log) |
| ESLint | Exit 0, **0 errors / 325 υπάρχοντα warnings**, [log](D:/Projects/Active/needs/output/playwright/final-verification/lint.log). **0 νέα warnings** σε σύγκριση με τη βάση: [audit](D:/Projects/Active/needs/output/playwright/final-verification/changed-files-lint-final.json). Τα τελευταία τροποποιημένα tests ελέγχθηκαν χωριστά χωρίς diagnostics |
| Dependency audit | **0 vulnerabilities**, χωρίς αλλαγή εξαρτήσεων, [log](D:/Projects/Active/needs/output/playwright/final-verification/dependency-audit.log) |
| Git / έκδοση | `git diff --check`: exit 0· runtime SHA-256 αμετάβλητο μετά τα δύο builds |

Η αρχική προδοκιμή Mapbox είχε αποτυχία στο test λόγω διαφορετικής ισοδύναμης κωδικοποίησης κόμματος στο URL (`%2C`/`,`). Το assertion διορθώθηκε ώστε να συγκρίνει τις πραγματικές παραμέτρους και η τελική εκτέλεση πέρασε. Δεν άλλαξε η συμπεριφορά επιστροφής της εφαρμογής. Τα fixture build logs μπορεί να περιέχουν ελεγχόμενη αποτυχία σύνδεσης του rate limiter στο ανύπαρκτο test backend· δεν είναι αποτυχία πραγματικού Supabase/Mapbox.

## Screenshots

[Άνοιγμα συλλογής 12 εικόνων](D:/Projects/Active/needs/output/playwright/final-verification/screenshots.html) · [Κατάλογος εικόνων με hashes και διαστάσεις](D:/Projects/Active/needs/output/playwright/final-verification/screenshot-manifest.json).

| Σκηνή | Desktop | Mobile | Δεδομένα |
|---|---|---|---|
| Αρχική, δύο κύριες ενέργειες | [Εικόνα](D:/Projects/Active/needs/output/playwright/final-verification/home-desktop-chromium.png) | [Εικόνα](D:/Projects/Active/needs/output/playwright/final-verification/home-mobile-chromium.png) | Fixtures |
| Επιτυχής χάρτης | [Εικόνα](D:/Projects/Active/needs/output/playwright/final-verification/real-mapbox-desktop-chromium.png) | [Εικόνα](D:/Projects/Active/needs/output/playwright/final-verification/real-mapbox-mobile-chromium.png) | **Πραγματικό Mapbox style/geocoding**, fixture αγγελία |
| Fallback χάρτη | [Εικόνα](D:/Projects/Active/needs/output/playwright/final-verification/search-fallback-desktop-chromium.png) | [Εικόνα](D:/Projects/Active/needs/output/playwright/final-verification/search-fallback-mobile-chromium.png) | Ελεγχόμενο σφάλμα 403, fixture αγγελίες |
| Μηδενικά αποτελέσματα / δημοσίευση ανάγκης | [Εικόνα](D:/Projects/Active/needs/output/playwright/final-verification/empty-greek-desktop-chromium.png) | [Εικόνα](D:/Projects/Active/needs/output/playwright/final-verification/empty-greek-mobile-chromium.png) | Fixtures, ελληνικά |
| Δημόσιο προφίλ | [Εικόνα](D:/Projects/Active/needs/output/playwright/final-verification/public-profile-desktop-chromium-el.png) | [Εικόνα](D:/Projects/Active/needs/output/playwright/final-verification/public-profile-mobile-chromium-el.png) | Fixtures, ελληνικά |
| Εγγραφή 360×480 | [Επάνω μέρος](D:/Projects/Active/needs/output/playwright/final-verification/registration-short-mobile-chromium.png) | [Κύρια ενέργεια μετά από εστίαση](D:/Projects/Active/needs/output/playwright/final-verification/registration-short-bottom-mobile-chromium.png) | Fixtures, χωρίς αποστολή |

Οι εικόνες επιθεωρήθηκαν με πραγματική προβολή: κείμενα και κύριες ενέργειες αναγνώσιμα, χωρίς οριζόντια υπερχείλιση ή fixed navbar στη μέση της εικόνας. Η εγγραφή στα 360×480 απαιτεί κατακόρυφη κύλιση· παραδίδονται επάνω και κάτω καρέ, και το κουμπί/έξοδος είναι προσβάσιμα. [Ανεξάρτητη ανασκόπηση οκτώ εικόνων](D:/Projects/Active/needs/output/playwright/final-verification/screenshot-review.md).

Μετά από παρατήρηση του χρήστη, ελέγχθηκε μικρό σκούρο τετράγωνο κάτω από το κουμπί εγγραφής στην αρχική mobile λήψη. Δεν βρέθηκε DOM στοιχείο ή pseudo-element εκεί και δεν αναπαράχθηκε στις νέες λήψεις του ίδιου build. Τα στοιχεία δείχνουν στιγμιαίο ίχνος απόδοσης, χωρίς επιβεβαιωμένη ακριβή αιτία. Προστέθηκε αναμονή fonts/repaint και ολοκλήρωση animations στο screenshot test· οι τελικές desktop/mobile λήψεις είναι καθαρές. Δεν έγινε υποθετική αλλαγή στο CSS της εφαρμογής.

## Ετοιμότητα και συγκεκριμένα υπόλοιπα

Η τοπική έκδοση είναι έτοιμη για οπτικό έλεγχο και αξιολόγηση δοκιμαστικής διάθεσης. Δεν υπάρχει ήδη διαθέσιμο απομακρυσμένο preview αυτής της τελικής έκδοσης και δεν έγινε deployment για να δημιουργηθεί σύνδεσμος.

1. Επιχειρηματικές αποφάσεις: πραγματικός φορέας/επωνυμία και στοιχεία καταχώρισης/διεύθυνσης, κανάλια επικοινωνίας υποστήριξης/ιδιωτικότητας, τελικές χρεώσεις και φορολογική μεταχείριση, εγκεκριμένοι όροι/πολιτικές και ημερομηνία ισχύος. Οι υπάρχουσες πρόχειρες τιμές/πολιτικές δεν εγκρίθηκαν σιωπηρά.
2. Απόφαση διάθεσης: επιλεγμένο περιβάλλον και χρόνος rollout εφαρμογής και της τοπικής migration. Η σημερινή live συμπεριφορά δεν άλλαξε.
3. Πρόσθετος πραγματικός έλεγχος login: απαιτείται υπάρχων κατάλληλος δοκιμαστικός λογαριασμός. Η διαδρομή έχει ελεγχθεί με fixtures, όχι με πραγματικά credentials.

Δεν απαιτείται νέα απόφαση για την ταυτότητα ή τη μη συναλλακτική χρήση των συγκεκριμένων οκτώ demo αγγελιών: αυτά τεκμηριώθηκαν από την υπάρχουσα πηγή και τα δεδομένα.
