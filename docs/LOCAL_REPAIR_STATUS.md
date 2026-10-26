# Local repair status — 14 October 2026

## Scope

Retained `D:\Projects\Active\needs`, based on Git revision `b71ed31`. Original global styles, public assets, navbar and footer were not changed. Existing components were connected to real services, with functional validation/error states and missing actions using the existing styles.

The two archive projects (`needs-v0-bazaar`, `needs-v1-mongodb`) were stopped and moved to the Windows Recycle Bin as requested. The active project was not moved or deleted.

## Repairs

- Authentication: nonblocking Supabase auth callbacks, account-switch protection, email confirmation, protected dashboard and destination-preserving login.
- Language preference: server and browser now share the initial locale from the cookie. Legacy browser-only preferences are restored after hydration without overwriting the saved language; this fixes the React text hydration error found in the final visual check.
- Listings/search: actual public active listings, filters and URL state, details, currency formatting, validated coordinates/prices/categories, contact number and tag/image rollback.
- Profiles/chat/storage: profile creation races, email changes, correct chat selection and membership, stored image paths and atomic main-image updates.
- Payments: usable Stripe Elements checkout, authenticated CSRF requests, milestone proposal funding, retryable canceled intents, atomic webhook handling and financial permissions.
- Contact: validated private database persistence, Resend adapter, durable retry queue and protected local worker. Storage success is reported separately from provider acceptance.
- Administration/database access: settings and moderation logs use authenticated admin APIs; private records, reporting views and legacy maintenance RPCs have restricted grants. Admin database checks use trusted JWT app metadata.
- Runtime: pinned Next.js 15.5.27 and matching tooling, npm lockfile, port 3002, production CSP nonces, strict build/type/lint checks.

## Verification and limits

The latest integrated verification passed **70 Vitest files / 329 tests**, **11 database integration cases**, and the **Next.js production build**, including TypeScript and ESLint checks. The email worker's five checks are included in Vitest. An initial full run exposed a test-runner mismatch (a Node test file collected by Vitest); the import/environment were corrected and the fresh complete run passed. Existing nonblocking lint/tooling warnings remain. Database integration checks use isolated PGlite PostgreSQL to exercise real permissions, transactions and rollback; they do not establish independent multi-session concurrency behavior. Logs are saved outside the repository in `D:\Projects\Active\needs-runtime-backups`.

The production server is running on `http://127.0.0.1:3002`. HTTP checks returned 200 for the home, items, services, search and login pages and the real search API. Unauthenticated admin settings and dispute-export requests returned 403. The home response includes the original Athens image and nonce-based CSP. Compiled browser assets reference the selected Supabase project and contain no references to the obsolete project.

After the user reopened the preview, the browser visual pass confirmed the original Athens hero, navigation/footer and rendered Mapbox map. The sign-in dialog, search query/category/reset controls and contact-page navigation were exercised. An initial React text hydration error with saved Greek was reproduced and fixed. The subsequent production build passed, and a fresh browser reload retained Greek, rendered the map and completed the search request with no new console warnings or errors. Screenshot: `D:\Projects\Active\needs-runtime-backups\needs-final-preview-20261014.jpg`. Source comparison confirms no changes to the original global styles, public assets, navbar or footer.

The user selected the existing Supabase project **Needs** (`qczrqxmewjsydrrvjdil`) and authorized its reactivation. The project is now **ACTIVE_HEALTHY**, and the ignored local environment is connected with matching URL and credentials. The prior environment and schema-only metadata were backed up outside the repository in `D:\Projects\Active\needs-runtime-backups`. The existing schema was compared before applying the repair migrations; the seven remote/local version mappings are recorded in [SETUP.md](SETUP.md). Existing migrations through the remote `033_security_fixes_retry` were retained.

Live backend checks passed **7/7**, with the temporary verification records and files cleaned up. Auth's site and redirect URLs were corrected from the old port 3000 to port 3002; a follow-up configuration diff confirmed zero outstanding changes to those settings. These checks supplement the automated local tests; they do not constitute a complete browser end-to-end payment or email-delivery test. Stripe test-mode keys are connected, but a complete checkout/payment/webhook flow and actual email delivery remain unverified. Contact-page business details remain the original placeholders. Original global styles, public assets and existing page appearance were preserved.

## Payment and email follow-up

The existing Stripe account has not enrolled in Connect: an attempt to create a disposable test connected seller was rejected before creating any account. No charges were made. A real end-to-end destination payment therefore still requires the owner to activate Connect and a test seller with active transfers. The local Stripe CLI forwarder connected successfully; its signing secret remains private. The combined local runner rejects live keys/public destinations and stops child process trees together. Its commands are documented in [SETUP.md](SETUP.md).

Payment fixes include capability checks and honest onboarding callbacks, verified buyer receipt addresses, separate application complaints, seller-transfer/platform-fee reversal on refunds, and atomic reconciliation of pending/successful/failed/canceled refunds. The payment migration was reviewed independently, applied remotely, and its service-only execute privileges verified. The guarded full Stripe test harness is prepared but has not run while Connect remains unavailable. Stripe does not automatically send test receipts.

Auth now has confirmation, resend and password-recovery routes. Actual Supabase one-time signup/recovery tokens, replay rejection, password update and subsequent sign-in passed a temporary-user live check; the user was cleaned up and no email was sent. Login dialogs close when navigating to these routes, preventing stacked modal dialogs without changing Navbar/styles.

Contact notifications use Resend with an owner-configured recipient, visitor Reply-To, stable provider idempotency key, persisted sender/recipient, claim leases, and a bounded retry window beginning at the first attempt. Never-attempted messages can wait for provider configuration. The local worker retries automatically; an exact secret-protected internal endpoint supports a deployment scheduler. The outbox migration was reviewed independently and applied remotely. Historical pre-migration contacts remain unrequested and are not mailed retroactively.

The owner has no email provider yet. Resend credentials, a verified sending domain and Supabase custom SMTP are still required. No test email was sent, provider acceptance and inbox delivery are unverified, and the app reports unavailable email separately from a saved contact message. No credentials are included in this report.

Final local checks confirmed the combined app/Stripe runner starts cleanly in production mode and stops its child processes together. Live HTTP checks verified contact persistence, idempotent replay, changed-payload conflict, queued/unattempted state, worker authorization and invalid Stripe-signature rejection. The temporary contact record was removed. A real browser submission also saved successfully under production CSRF/CSP settings, displayed the correct unavailable-email notice, and its exact temporary database row was removed. The sign-in → Forgot password → close flow used a single modal at each step; browser warnings/errors were empty. Screenshot evidence is in `needs-runtime-backups/needs-contact-verification-20261014.png` and `needs-payments-email-preview-20261014.png`.

## Remaining database advisor findings

- Fifteen legacy functions have a mutable `search_path`. Set an explicit safe path and qualify referenced objects when reviewing those functions, especially the active geographic search RPCs. [Supabase guidance](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable).
- The read-only `seller_can_receive_payments` helper remains executable by anonymous and authenticated users as a security-definer function. Review whether this public endpoint is required. Other identified legacy write/maintenance RPCs were restricted to the service role. [Supabase guidance](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).
- Some private application tables retain anonymous `SELECT` grants, making their schema discoverable through GraphQL; RLS still controls row access. Tighten unnecessary grants separately from the intended public listing/profile/flag reads. [Supabase guidance](https://supabase.com/docs/guides/database/database-linter?lint=0026_pg_graphql_anon_table_exposed).
- PostGIS remains in `public`; its extension-owned `spatial_ref_sys` table and `st_estimatedextent` functions cause extension-related warnings. These objects were deliberately not changed during application repairs; any extension relocation needs a compatibility review of geographic queries. [Supabase guidance](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public).

The informational “RLS enabled, no policy” notices for `moderation_logs`, `payment_audit_logs`, `rate_limits`, `support_requests` and `webhook_events` are intentional: public/authenticated access was revoked, and authorized server operations use the service role. The dormant, service-only `cleanup_security_tables()` function still references the absent legacy `rate_limits.reset_at` column and needs correction before scheduling it.
