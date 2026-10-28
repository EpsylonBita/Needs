# NEEDS — Παράδοση διορθώσεων UX, 28/10/2026

Οι ανεξάρτητες τεχνικές διορθώσεις υλοποιήθηκαν και επαληθεύτηκαν τοπικά. Δεν έγινε deployment, αλλαγή προμηθειών/πληρωμών, αποστολή μηνυμάτων ή email, ούτε δημοσίευση στο live. Το repository ήταν καθαρό στην έναρξη.

## Τι επιβεβαιώθηκε

- Υπήρχαν ήδη οι προθέσεις `Items/Buy`, `Items/Sell`, `Items/Free` και `Services/I want`, `I will`, `I can`. Δεν προστέθηκε δεύτερο μοντέλο αναγκών ή δεύτερη ροή δημοσίευσης.
- Το API ήδη χρησιμοποιούσε το `nearby_listings` με πραγματικές συντεταγμένες και `radius_m`. Το κενό ήταν η εμφανής χειροκίνητη επιλογή στην αναζήτηση και η παρουσίαση του εφαρμοσμένου φίλτρου.
- Η φόρμα επικοινωνίας ήδη ξεχώριζε αποθήκευση αιτήματος από επιβεβαιωμένη/εκκρεμή ειδοποίηση. Η συμπεριφορά διατηρήθηκε και οι σχετικοί έλεγχοι πέρασαν.
- Η φήμη είχε πεδίο με προεπιλεγμένο μηδέν, αλλά μη υλοποιημένο υπολογισμό. Δεν παρουσιάζεται πλέον ως κακή βαθμολογία. Οι πραγματικές αξιολογήσεις εμφανίζονται χωριστά.

## Βασικές αλλαγές

| Περιοχή | Αλλαγή | Κύρια αρχεία στο frontend |
| --- | --- | --- |
| Χάρτης | Καταστάσεις loading/ready/error, χρονικά όρια 15s για renderer και provider, WebGL έλεγχος, cleanup/retry, compact fallback με πλήρη χώρο στη λίστα | `components/features/map/map-loader.tsx`, `map-component.tsx`, `components/features/search/search-map.tsx`, `app/globals.css` |
| Τοποθεσία | «Πού ψάχνεις;», χειροκίνητο geocoding με υπάρχον Mapbox, προαιρετικός γεωεντοπισμός, ανενεργή ακτίνα χωρίς κέντρο, περιοχή/ακτίνα στο URL και πραγματικό query | `components/features/search/search-location.tsx`, `search-filters.tsx`, `search-results.tsx`, `hooks/use-search-state.ts` |
| Επιστροφή | Ασφαλές `returnTo` σε κάρτες και χάρτη, διατήρηση query/κατηγορίας/υποκατηγορίας/tags/περιοχής/ακτίνας/σελίδας, Back/Forward και refresh | `search-results.tsx`, `listing-detail.tsx`, `lib/auth/return-path.ts` |
| Δημοσίευση/auth | Δύο σαφείς ενέργειες στην αρχική και CTA στα μηδενικά αποτελέσματα, επεξεργάσιμη προσυμπλήρωση, κατάλληλη πρόθεση, συνέχεια μετά το auth/επαλήθευση χωρίς αυτόματη δημοσίευση | `components/layout/hero-section.tsx`, `navbar.tsx`, `components/features/ads/*`, `lib/listings/publication-intent.ts`, `components/auth/*`, `app/login/page.tsx` |
| Δημόσιο προφίλ | Υπάρχουσες κάρτες με φωτογραφίες και κατάσταση, δημόσια στοιχεία δημιουργού, ουδέτερο μηδενικό ιστορικό, διαχείριση μόνο στον ιδιοκτήτη | `app/profile/[id]/page.tsx`, `listing-detail.tsx`, `app/api/search/search-query.ts` |
| Συνέπεια | Μικρότερο hero, κοντινές κύριες ενέργειες, συμπαγής εγγραφή, εξήγηση τηλεφώνου, «Δωρεάν» μόνο για πραγματικό `Items/Free`, υπάρχουσες μονάδες χρέωσης, EL/EN | `app/globals.css`, `components/auth/*`, `lib/listings/price-policy.ts`, `locales/*` |
| Δοκιμαστική φάση | Διακριτική ενημέρωση από το υπάρχον `legal-operator.json: releaseStatus=draft`, με σύνδεσμο στους αμετάβλητους πρόχειρους όρους | `components/layout/preview-notice.tsx`, `app/layout.tsx` |

Δεν υπήρχε ανεξάρτητο υποστηριζόμενο φίλτρο ταξινόμησης που να χρειαζόταν νέα υλοποίηση. Οι υπάρχουσες παράμετροι URL διατηρούνται στους προορισμούς επιστροφής.

## Διάγνωση χάρτη

Ο πραγματικός provider είναι Mapbox GL 3.33. Το CSP επιτρέπει Mapbox και blob workers· το public token υπάρχει ως build-time ρύθμιση. Έγινε μόνο ανάγνωση της live εφαρμογής σε Chromium 148: WebGL2 διαθέσιμο, επιτυχής φόρτωση και HTTP 200 για style, tiles, glyphs και map session, χωρίς μήνυμα μη διαθεσιμότητας ή Mapbox/WebGL errors.

**Η αρχική παρατήρηση δεν αναπαράχθηκε· η ιστορική αιτία παραμένει ανεπιβεβαίωτη.** Δεν προκύπτει καθολικό πρόβλημα token/origin/provider και δεν άλλαξε provider ή κλειδί. Επιβεβαιώθηκαν όμως αδυναμίες στην εφαρμογή: απουσία ορίου αναμονής, μόνιμη απόκρυψη ακόμη και μετά από ανακτήσιμο tile error, και μεγάλο κενό πλαίσιο αποτυχίας. Αυτές διορθώθηκαν.

Στο τοπικό production build χρησιμοποιήθηκε πραγματικός Mapbox renderer με ελεγχόμενο fixture style: δοκιμάστηκαν επιτυχία, σφάλμα 403, συμπαγές fallback, πλήρης λίστα και επιτυχές retry χωρίς απώλεια αναζήτησης ή διπλό canvas. Η έλλειψη WebGL και η καθυστέρηση chunk/provider καλύπτονται επίσης από στοχευμένα unit tests.

## Επαλήθευση

Χρησιμοποιήθηκε Node **24.22.1**. Τα E2E έτρεξαν σε τοπικό port 3102 με ψεύτικα credentials, fixture backend, desktop Chromium και mobile viewport. Το διαθέσιμο Chromium ήταν 148, μέσω του προαιρετικού `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Τα fixtures δεν επικοινωνούν με πραγματικό Supabase/Stripe/email provider.

| Έλεγχος | Αποτέλεσμα |
| --- | --- |
| `tsc --noEmit --pretty false --incremental false` | Επιτυχία, exit 0 |
| `eslint .` | Exit 0, 0 errors, 327 warnings· δεν έγινε άσχετο cleanup όλου του repository |
| `vitest run --maxWorkers=2` | **157 αρχεία, 1.825 tests πέρασαν** |
| `node --test --test-concurrency=1 tests/database/*.integration.mjs` | **130/130 πέρασαν**, απομονωμένο PGlite |
| Τα τρία αρχεία του `test:scripts` | **25/25 πέρασαν** |
| `playwright test` | **36/36 πέρασαν**, desktop/mobile |
| Τελικό `playwright test e2e/discovery.spec.ts` μετά τη μικρή διόρθωση σειράς του fallback | **8/8 πέρασαν**, νέο build και screenshots |
| Production build μέσω `scripts/e2e-server.mjs` → `next build --webpack` | Επιτυχία με απομονωμένη E2E ρύθμιση |
| `git diff --check` | Επιτυχία |

Οι browser έλεγχοι καλύπτουν αποτελέσματα/μηδενικά αποτελέσματα, γεωεντοπισμό με άρνηση, χειροκίνητη περιοχή και ακτίνα, Back/Forward/refresh, ασφαλή επιστροφή, συνέχεια δημοσίευσης μετά login, EL/EN, επισκέπτη/ιδιοκτήτη προφίλ, reduced motion και στενή εγγραφή 360×480. Η επαλήθευση email/recovery καλύπτεται με mocks/unit tests· δεν στάλθηκαν πραγματικά email. Το γεωγραφικό RPC ελέγχθηκε ως συμβόλαιο μεταφοράς πραγματικών συντεταγμένων/μέτρων· οι οπτικές αλλαγές αποτελεσμάτων ελέγχθηκαν με γεωγραφικά fixtures, όχι με live δεδομένα.

## Screenshots

Τα screenshots είναι από τοπικά fixtures, όχι πραγματικές αγγελίες. Το απλό υπόβαθρο στον επιτυχημένο χάρτη είναι το ελεγχόμενο test style.

- [Αρχική — desktop](../output/playwright/home-desktop-chromium.png) / [mobile](../output/playwright/home-mobile-chromium.png)
- [Fallback χάρτη — desktop](../output/playwright/search-fallback-desktop-chromium.png) / [mobile](../output/playwright/search-fallback-mobile-chromium.png)
- [Μηδενικά αποτελέσματα στα ελληνικά — mobile](../output/playwright/empty-greek-mobile-chromium.png)
- [Δημόσιο προφίλ στα ελληνικά — desktop](../output/playwright/public-profile-desktop-chromium-el.png) / [mobile](../output/playwright/public-profile-mobile-chromium-el.png)

Τα logs των τελικών ελέγχων βρίσκονται στο τοπικό `output/playwright/` και δεν προστίθενται στο Git.

## Συγκεκριμένες εκκρεμότητες

1. **Ταυτότητα demo αγγελιών:** δεν υπάρχει `is_demo` ή άλλη αξιόπιστη σημαία στο μοντέλο/σχήμα για τις οκτώ παρατηρημένες αγγελίες. Χρειάζονται τα ακριβή IDs ή εγκεκριμένη πηγή σήμανσης, μαζί με τη συμφωνημένη διαθεσιμότητά τους για συναλλαγή. Δεν ταξινομήθηκαν αυθαίρετα από τίτλους και δεν άλλαξαν οι κανόνες συναλλαγών. Τα ήδη εικονογραφικά παραδείγματα της αρχικής παραμένουν σημειωμένα ως τέτοια.
2. **Πραγματικά επιχειρηματικά στοιχεία:** φορέας/επωνυμία και απαιτούμενα στοιχεία καταχώρισης, διεύθυνση, πραγματικά κανάλια υποστήριξης/ιδιωτικότητας, τελικές χρεώσεις/φορολογική μεταχείριση, εγκεκριμένοι όροι και πολιτικές με ημερομηνία ισχύος. Το δοκιμαστικό 5% δεν έγινε τελικός τιμοκατάλογος.
3. **Όριο προσχεδίου:** το πλαίσιο πριν από το auth διατηρείται στο ίδιο browser για 24 ώρες, συμπεριλαμβανομένης νέας καρτέλας επιβεβαίωσης email. Δεν υπάρχει συγχρονισμός προσχεδίου μεταξύ συσκευών. Δεν αποθηκεύονται credentials, τηλέφωνο ή φωτογραφίες σε αυτό το προσχέδιο.
4. **Αρχική αποτυχία χάρτη:** για οριστική απόδοση της παλιάς αποτυχίας χρειάζεται το συγκεκριμένο περιβάλλον/browser ή αντίστοιχα diagnostics. Η επιτυχία στο ελεγμένο Chromium δεν αποδεικνύει συμπεριφορά σε κάθε browser/device.
