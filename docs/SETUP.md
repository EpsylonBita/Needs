# Needs setup

The retained application is `D:\Projects\Active\needs\frontend`. It uses Next.js and the existing Supabase backend. The original page styling and assets are retained.

## Start locally

Use Node.js 24.21.0 or newer within the 24.x release line and npm, matching `frontend/package.json`. The reproducible dependency lock is `frontend/package-lock.json`; the older pnpm lockfiles are historical and are not synchronized with these repairs. If using the portable Node runtime, put its directory first in the process PATH so child tools use the same version.

```powershell
Set-Location D:\Projects\Active\needs\frontend
npm ci
npm run dev
```

Open http://127.0.0.1:3002. For a local production run, stop the development server, run `npm run build`, then `npm start`. Both the default Turbopack build and `npm run build -- --webpack` passed on 26 October with Next.js 16.4.3 and the pinned runtime; see [the current audit report](AUDIT_REPAIRS_2026-10-26.md).

Keep credentials in the ignored `frontend/.env.local`. Required variables:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`: the existing project's URL and public key.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only key for that same project.
- `NEXT_PUBLIC_MAPBOX_TOKEN`: public token for map/geocoding.
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`: matching Stripe environment for payment features. Use test mode for verification.
- `NEXT_PUBLIC_PAYMENTS_ENABLED`: enable payment UI only after its backend is configured.
- `NEXT_PUBLIC_APP_URL`: canonical origin for payment and Auth callbacks; locally `http://127.0.0.1:3002`, in production `https://getneeds.app`.
- `RESEND_API_KEY`, `CONTACT_EMAIL_FROM`, `CONTACT_NOTIFY_TO`: server-only contact delivery settings. The From address must belong to the verified sending domain. The recipient is configured privately in `.env.local`.
- `CRON_SECRET`: a long random server-only secret for the contact notification worker.
- `ADMIN_EMAILS`: optional server-managed admin allowlist; otherwise use trusted `app_metadata.role`, never editable `user_metadata.role`.

Do not copy secrets into logs, source control, or chat. The `.env.example` template lists the active configuration only; MongoDB, Redis and Wit.ai tokens are not required by this app.

## Production on Vercel

On 19 October 2026, `getneeds.app` was registered through the team's free first-year Pro offer for **USD 0**. Registration expires on **19 October 2027** and automatic renewal is **disabled**. The verified apex domain is assigned to Vercel project `needs`; `www.getneeds.app` redirects to the apex with HTTP 308.

The current production deployment was uploaded manually from the local `frontend` working tree and promoted to production. There is **no Git linkage**: later local edits or Git pushes do not automatically update the site. Deployment settings are Next.js, Node 24.x, `npm ci`, `npm run build -- --webpack`, the default Next.js output, and region `fra1`. For a future repository import, the Root Directory is `frontend`; the existing CLI deployment used that directory as its source root.

Nine approved environment keys were configured in the Vercel **Production** environment. Production uses `NEXT_PUBLIC_APP_URL=https://getneeds.app` and `NEXT_PUBLIC_PAYMENTS_ENABLED=false`. The local `.env.local` remains separate; do not upload it wholesale. Public HTTPS checks passed for the home, login and Auth callback pages; the health endpoint reported a connected database. A browser check loaded the eight existing demo listings and Mapbox map with no console errors or warnings. Stripe Connect, contact-notification delivery and final legal texts remain incomplete; Auth email delivery is verified as described below. See [the domain deployment record](DOMAIN_DEPLOYMENT_2026-10-19.md) for identifiers, recovery notes and verification boundaries.

## Existing Supabase project

On 14 October 2026, after reauthentication, the user selected the existing project **Needs** (`qczrqxmewjsydrrvjdil`) and authorized its reactivation. It is now **ACTIVE_HEALTHY**. The ignored local environment uses that project's URL and matching credentials, and live backend checks passed **7/7** with temporary verification data cleaned up. See [LOCAL_REPAIR_STATUS.md](LOCAL_REPAIR_STATUS.md) for verification limits and remaining advisor findings. The app reports unavailable services rather than inventing listings or showing false success.

If the project is paused again, restore it through Supabase. Keep the URL and keys from the same selected project, and restart the development server after an environment change. Production needs a fresh build because public environment values are bundled into client assets.

The actual remote schema and migration history were inspected before the repairs. Schema-only backups are outside the repository in `D:\Projects\Active\needs-runtime-backups`. The historical baseline is in `supabase/sql/001...029`; it is **not** safe to replay that entire directory on an existing database. This project also contains later remote migrations through `033_security_fixes_retry`, which were preserved.

All ten repair migrations are **already applied**, including the three audit repairs explicitly authorized and applied on 19 October 2026. Their remote application versions differ from the local file creation timestamps:

| Remote version | Local file in `supabase/migrations` | Repair |
| --- | --- | --- |
| `20261014001933` | `20261013232046_webhook_event_atomic_processing.sql` | Atomic payment/webhook operations and financial permissions |
| `20261014001941` | `20261013232103_chat_storage_repairs.sql` | Direct chats, image ownership/paths, main-image operations and Realtime publication |
| `20261014001950` | `20261013232626_listing_fields_and_tag_policies.sql` | Contact field, tag access and protected profile columns |
| `20261014001954` | `20261013233747_support_requests.sql` | Private contact-message storage |
| `20261014002548` | `20261014001726_legacy_application_privileges.sql` | Restricted legacy grants/RPCs, private admin data and trusted admin checks |
| `20261014091454` | `20261014085831_payment_dispute_workflow.sql` | Separate app complaints and atomic per-refund reconciliation |
| `20261014092000` | `20261014085736_support_notification_outbox.sql` | Private contact outbox, deduplication, leases and bounded retries |
| `20261019141954` | `20261019120100_request_offer_transactions.sql` | Request/offer financial roles, selected conversations and legacy authorization holds |
| `20261019142006` | `20261019120200_review_eligibility.sql` | Reviews tied to completed payments and service-only submission |
| `20261019142018` | `20261019120300_listing_moderation.sql` | Protected moderation holds separate from owner visibility |

Do not reapply these migrations or run a blind schema push. Reconcile this version mapping if switching to a CLI migration-history workflow. For further changes, inspect the current remote schema/history and take a suitable backup first.

The 19 October rollout verified actual RPC signatures, grants, triggers, constraints, indexes and visibility invariants in the connected database. All eight existing active listings remained active; payments, milestones and reviews were empty before and after. The security advisor returned the same pre-existing findings, with none added or removed. Affected-object schema metadata and aggregate counts are retained locally in the ignored `supabase/.temp/audit-rollout-20261019-before.json`; this is not a full database backup. See [the audit repair report](AUDIT_REPAIRS_2026-10-19.md) for the application rollout and verification boundaries.

On 19 October 2026, Supabase Auth's site URL was changed to `https://getneeds.app`. Allowed redirects now include `https://getneeds.app/auth/confirm` and `https://getneeds.app/auth/reset-password`, while preserving `http://127.0.0.1:3002` and `http://127.0.0.1:3002/**` for local work. The config push changed exactly `auth.site_url` and `auth.additional_redirect_urls`; ten undeclared remote settings, including existing security settings, were preserved. Configuration previews and the earlier values are saved outside the repository in `needs-runtime-backups/config-review`. Correct callback URLs do not establish successful SMTP or inbox delivery.

Stripe test-mode keys are connected. Connect enrollment is still required on the existing Stripe account before a connected test seller and a full checkout can be verified. Contact submissions are stored privately in `support_requests`; Resend delivery is implemented but is inactive until the sending credentials/domain are configured. The existing contact-page address, telephone and office hours still need the owner's real business details before public launch.

## Payment and email services

For local payment testing, start the app and its Stripe event forwarder together:

```powershell
npm run dev:payments
# Or, after npm run build -- --webpack:
npm run start:payments
```

These commands accept Stripe test keys and local HTTP origins only. They obtain the CLI signing secret privately, pass the matching value to Next.js and stop the app if forwarding fails. They also start the contact retry worker when email is configured. Plain `npm run dev` / `npm start` do not start these background services. `npm run payments:listen` can attach to an already running app only when its configured webhook secret matches the listener.

For a full test payment, activate Connect, prepare a connected **test** seller with active transfers, and follow [the opt-in payment verification instructions](../frontend/scripts/verify-stripe-test-payments.md). No live charge is required. Stripe test receipts are not automatically emailed; validating `receipt_email` does not prove inbox delivery.

Resend must be configured separately for contact notifications and Supabase Auth:

1. The existing Resend Free account and `getneeds.app` sending domain are verified. The user-approved domain-restricted sending key, Supabase SMTP and Greek Auth templates are configured. Real confirmation and recovery emails reached the approved recipient's Inbox with SPF/DKIM/DMARC passing. Browser confirmation and recovery-form entry passed; an HTTP/SDK check using an actual received recovery link verified password change, rejection of the old password and sign-in with the new password. The disposable fixture was deleted, its sessions revoked and private test links/password removed. Supabase's send limit is the user-approved **30 emails per hour**, with the **60-second** minimum interval unchanged. See [the Auth email delivery record](AUTH_EMAIL_DELIVERY_2026-10-19.md). Contact notifications are configured separately: keep their key private, set `CONTACT_EMAIL_FROM` to an address on the verified domain and `CONTACT_NOTIFY_TO` to the owner's recipient.
2. Supabase Auth custom SMTP uses `smtp.resend.com`, port `465`, username `resend`, the private Resend sending key and sender `NEEDS <noreply@getneeds.app>`. Never place the key in source control or client-side variables.
3. Restart the app. The combined local commands above run retries automatically; for a plain app process, run `npm run emails:worker` in a separate terminal. The worker calls the secret-protected internal dispatcher once per minute. Public deployment needs its own authenticated scheduler invoking the same endpoint.
4. Check provider acceptance and actual arrival in the owner's mailbox separately. Contact storage success is reported independently of email availability. Historical records from before the outbox migration are not emailed retroactively.

Email confirmation, resend and password recovery callbacks are implemented under `/auth`. `npm run test:auth-links:live` creates a temporary Auth user, verifies generated one-time confirmation/recovery links and cleans up the fixture. It calls no email-send API and does not verify SMTP acceptance, inbox delivery or browser callbacks. Add `--app-url https://getneeds.app` to check the production redirect origin. Password update, old-password rejection and new-password sign-in are separately opt-in: `npm run test:auth-links:live -- --app-url https://getneeds.app --verify-password-update`. That optional mutation can trigger a Supabase password-change notification depending on configuration, so use it only when those notifications are understood. Custom SMTP, actual Inbox delivery and password update through a received email were verified separately on 19 October 2026. Supabase's default mail service is limited to project-team recipients and is not a replacement for custom SMTP.

References: [Stripe local forwarding](https://docs.stripe.com/cli/listen), [Stripe test receipts](https://docs.stripe.com/receipts#test-receipts), [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Resend SMTP setup](https://resend.com/docs/send-with-supabase-smtp).

## Verification

```powershell
npm run lint -- --quiet
npm run typecheck
npm test -- --run --pool=forks --maxWorkers=1 --minWorkers=1
npm run test:db
npm run build -- --webpack
```

`test:db` runs isolated PostgreSQL permission/transaction checks using PGlite. It does not replace Supabase or a complete browser checkout/email-delivery test. The reconnected backend has passed seven live smoke checks with cleanup; the latest integrated test totals and production-build result are tracked in [the 19 October audit report](AUDIT_REPAIRS_2026-10-19.md), with earlier work in [LOCAL_REPAIR_STATUS.md](LOCAL_REPAIR_STATUS.md).


## 26 October 2026 local audit changes

Next.js and its companion tooling are pinned to 16.4.3; fast-uri is overridden to patched 3.1.9. `npm run test:ci` runs the complete unit/component/API suite. `npm run test:db` covers isolated database migrations; `npm run test:e2e` builds and launches a separate production app on port 3102 using dummy environment values and browser network fixtures. Install its Chromium once with `npx playwright install chromium`. The test build is placed in ignored `.next-e2e/`; no live account, listing or payment is created by this suite.

CI now runs the full suite, database tests, dependency audit, typecheck/lint and desktop/mobile browser journeys. Runtime setup uses Node from `.nvmrc` and npm 11.19.0. The older pnpm examples are superseded.

Email configuration and final legal documents were explicitly deferred by the owner on 26 October; they are not release-complete. See [current repairs](AUDIT_REPAIRS_2026-10-26.md) for the per-finding disposition and new migration rollout status. The two 26 October migrations were explicitly authorized and applied to the connected NEEDS project; their remote versions are `20261026130307` (atomic rate limits) and `20261026130320` (account privacy requests). See the current report for local-to-remote mapping and verification. Historical applied-migration tables above cover earlier rollout batches only.
