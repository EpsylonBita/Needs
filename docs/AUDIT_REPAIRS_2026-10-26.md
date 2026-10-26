# NEEDS — Audit repairs, 26 October 2026

This report supersedes the open-item status in the initial 26 October audit and the historical GAP_ANALYSIS / SECURITY_AUDIT documents. It describes the current local working tree, including pre-existing changes. The user subsequently authorized committing/pushing these changes and applying pending migrations. Both migrations are now applied. No frontend deployment, real payment, listing publication or account deletion was performed during this rollout.

## Finding disposition

| Finding | Implemented behavior | Verification / remaining boundary |
| --- | --- | --- |
| Rate limiting could allow sensitive requests after a database error; counters raced | Atomic `consume_rate_limit` RPC with validated inputs; returned Supabase errors and malformed replies handled; fail-closed policy preserved through burst/progressive paths and sensitive callers | Unit/API tests and PGlite quota/atomicity/privilege tests pass. Migration applied and live quota/privilege verification passed. |
| Paid listings require Stripe onboarding | Existing business rule retained. The form explains the requirement, opens onboarding in a separate tab, preserves the draft, and re-fetches the profile when saving again | Source review and save-failure/retry browser tests. No real Stripe onboarding/payment completed. |
| Misleading mock APIs | Removed unused `/api/profile`, `/api/test`, `/api/example-error-handling`; real `/api/auth/profile` retained | Build/type checks and caller search. |
| Health endpoints could report healthy on database failure | Shared bounded database probe; HTTP 503 on failure; no-store; no internal database details in the response; no self-fetch dependency | Tests cover success, errors, missing environment and timeout. |
| Incomplete CI | Entire Vitest suite, PGlite suite, production dependency audit, production build and Chromium desktop/mobile journeys in CI; generated route types before typecheck | Local equivalents pass; check hosted GitHub Actions against the published commit. |
| Email provider and delivery setup | Deferred at the user's explicit request | Provider/domain settings and real delivery checks remain. Weekly Monday 09:00 thread reminder configured. |
| Final terms/privacy/operator details | Deferred at the user's explicit request; existing draft notices preserved | Operator name, public address, support/privacy email and approved final text remain. Same reminder. |
| Account data export and deletion self-service absent | Recent authenticated sign-in required for own-data JSON export and deletion requests; durable request status/cancellation; administrator review queue; allowlisted export fields; live transaction/dispute flags for administrator review (requests remain submittable) | API/component and PGlite access-control tests pass. Migration applied and service-only access verified. This implements a deletion request, not irreversible account erasure. Retention/erasure policy remains part of deferred legal work. |
| Camera policy prohibited in-page camera access | Permissions-Policy permits same-origin camera while retaining browser consent | Native phone camera capture still needs a real-device check; desktop file upload and mobile-layout tests do not prove hardware behavior. |
| Vulnerable production dependencies / security-gated build failure | Next.js and matching packages updated to 16.4.3; fast-uri overridden to 3.1.9; pinned Node 24.21.0 / npm 11.19.0 used | Production npm audit reports zero vulnerabilities; both default Turbopack and production Webpack builds exit 0. This is not a claim that the entire application has no security issues. |
| `/nearby` was placeholder text | Explicit geolocation action or manual area search, suggestions, distance/category/query filters, real results and map, clear empty/error states | Component tests and real in-app browser: Athens suggestions, eight listings, filter updates, empty state, reset; no horizontal overflow at mobile width. |
| Milestones/payments hid errors and allowed repeated actions | Loading/error/retry states, pending locks, refresh after uncertain outcomes, localized labels/statuses/EUR | Component tests; real authenticated read-only payments page. Missing milestone feature flag now safely means disabled, with readable history; real query errors remain errors. |
| Active checkout/onboarding/return screens retained English labels and misreported pending capture | Greek/English text, Stripe field locale, localized status/currency; HTTP 202 capture shows pending verification and refresh; language changes do not recreate payment intents | 26 focused tests pass, including pending-to-confirmed refresh, duplicate-action locking and uncertain refresh. |
| Public profiles fabricated success states / dashboard had duplicate main | Distinct missing/error/retry states, localized UI, single dashboard main landmark | Focused component tests and full lint/type checks. |

## Listing workflow retained and covered

Optional photos come first, followed by a note and editable details. The local rules-based parser removes transaction verbs, prices and contact/address details from titles. Examples: `Πωλώ μεταχειρισμένο ποδήλατο` → `Μεταχειρισμένο ποδήλατο`; a declared Trek brand → `Trek μεταχειρισμένο`. Tags track recognized item, brand, condition, category, current price and selected area. Full street addresses and phone numbers are not added as tags.

Mapbox address suggestions support keyboard selection, stale-response cancellation and manual fallback. Profile phone prefill respects explicit phone information in the note and subsequent manual changes or removal. The public visibility of a listing phone number is disclosed in the form.

The permanent browser suite covers photo preview/removal, skipping photos, extraction, phone prefill/removal, address suggestions, manual price/tag update, submission payload, failed save retaining the draft, and successful retry. It runs the production application with isolated fake credentials and blocked external network routes; it does not create live listings.

## Verification evidence

Completed after integration, using the pinned runtime:

- Full Vitest: **122 files / 956 tests passed**, exit 0.
- Database integration: **50 tests passed**, exit 0 (isolated PGlite, not the live database).
- Production browser suite: **4/4 passed**, desktop Chromium and Pixel 7 viewport; production Webpack compilation, type checking and prerendering succeeded, exit 0.
- Full ESLint: **0 errors / 312 warnings**, exit 0. Warnings remain technical debt, mainly existing `any` types; they are not 312 demonstrated runtime defects.
- Production `npm audit`: **0 vulnerabilities**, exit 0.
- Additional milestone regression (included in the full suite): **7/7 passed**, including absent-feature-flag handling and true database errors.

Final payment flow checks: **26/26 passed**. Default `npm run build` also passed with **Next.js 16.4.3 Turbopack**, including TypeScript and 30 prerendered pages (exit 0). The previous default-build failure and security-gated build failure did not recur.

Live local HTTP check: `/api/health` returned 200 with connected database and `Cache-Control: no-store`; the response included `camera=(self)` and `microphone=()` permissions policy. No real dependency outage was induced; failure behavior is covered by tests.

Authenticated in-app browser QA also verified public profile, payments history, payment return and the corrected disabled-milestone state. Before rollout, account privacy controls rendered but status was unavailable while migrations were absent. Post-migration checks are recorded below; no real deletion request or personal-data download was performed. A browser message-channel warning was observed without an application stack; it did not reproduce as a page failure.

## Database rollout

Prepared and tested migrations:

1. `supabase/migrations/20261026140000_atomic_rate_limits.sql`
2. `supabase/migrations/20261026141000_account_privacy_requests.sql`

**Both migrations were applied successfully on 26 October 2026**, after explicit user authorization, to the connected NEEDS project (`qczrqxmewjsydrrvjdil`).

| Local file | Applied remote version |
| --- | --- |
| `20261026140000_atomic_rate_limits.sql` | `20261026130307` |
| `20261026141000_account_privacy_requests.sql` | `20261026130320` |

The MCP service assigns application timestamps, so remote versions differ from local creation filenames. Match this mapping; do not replay already applied migrations or run a blind schema push. Other environments must apply them before dependent application code.

Live verification passed: first quota request allowed, second denied; the check ran inside a rolled-back transaction and left zero probe rows. All seven new public RPCs deny execution to `anon` and `authenticated` and allow `service_role`. The request table has RLS enabled, no direct anon/authenticated read grant, and service-only access. The service-role queue read succeeds. Authenticated in-app browser verification now loads the account-privacy status successfully and renders the deletion-request confirmation controls without the former unavailable error. Counts stayed at eight listings, zero payments and zero deletion requests.

The connected schema was checked read-only against every referenced account-export column and existing grants. Metadata/count baseline: eight listings, zero payments; latest applied migration was `20261019183527`. The saved baseline is schema/grant/count metadata, not a full database backup.

New security-definer functions use an empty search path, explicit qualified names and service-role-only execution. Public/anonymous/authenticated direct execution is revoked; API authorization remains mandatory. The new request table uses RLS and service-only access. Account erasure is deliberately not automated because existing account foreign keys can cascade into financial and communication history.

Existing Supabase advisor categories predate these changes: mutable search paths in legacy functions, extension placement/PostGIS metadata, GraphQL exposure warnings, legacy function execution warnings and leaked-password-protection configuration. Their presence is recorded separately from this repair set; the database is not certified free of security advisories. No extension-owned objects, live credentials or authentication settings were modified. Advisor comparison added only the expected informational `rls_enabled_no_policy` notice for the deliberately service-only request table; warning/error findings were unchanged.

## Description extraction follow-up

The two descriptions reported in screenshots now have permanent parser, form and desktop/mobile browser regressions:

| Original description | Result |
| --- | --- |
| `πωλειται κινητο smasung s25 ultra ελαχειστα χρησιμοποιημενοαπο 220 στα 130` | Items / Sell; `Samsung μεταχειρισμένο s25 ultra`; final price `130€`; brand, condition, item, category and current-price tags. |
| `μπορω να αναλαβω  ηλικιωμενους κατοικον με 10 ευρω την ωρα` | Services / I can; `Φροντίδα ηλικιωμένων κατ’ οίκον`; `10€/ώρα`; care, home, category and hourly-price tags. |

Controlled spelling/spacing corrections apply only to recognition; the original description is retained. Explicit discounts choose the final amount, while ranges, conflicting amounts and unsupported currencies remain editable rather than guessed. Hour/day/month rates retain their basis in the form and saved-listing displays. Manually changed amounts update price tags without losing the unit.

Existing checkout treats a listing price as the complete payment. Per-unit listings therefore show an agreement hint and cannot create a fixed-total Stripe intent or milestone proposal. There is no new quantity-based billing feature or database migration; the saved description remains the source of rate terms even if its smart tag is removed.

Clearing a per-unit price now produces a validation message before create/update writes. Older per-unit listings with a zero amount show that the price needs confirmation, including in payment context, instead of being presented as free. Explicit Items / Free listings retain their giveaway behavior.

Final follow-up verification: **124 Vitest files / 1,058 tests passed**, **6/6 production Playwright tests passed** across desktop and mobile, fresh TypeScript check passed, and full ESLint reported **0 errors / 312 existing warnings**. The browser journey now includes rejected blank hourly prices and successful manual correction to 12/hour against an isolated mocked backend. Real authenticated in-app browser inspection confirmed both original examples without publishing a live listing. Independent review verified the payment guards, zero-price handling and explicit Free exception. Screenshots and command logs are stored with this task's local artifacts.

## Remaining checks

- Deploy the reviewed frontend when separately authorized; run hosted CI.
- Complete real-device camera QA and test-environment Stripe Connect/payment journey.
- Resume email delivery and legal/retention content when the user provides final business decisions.

Local screenshots and detailed command logs are stored with the original audit artifacts in the Codex visualization folder for this task.
