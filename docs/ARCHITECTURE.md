# NEEDS architecture

Updated for the 26 October 2026 local audit repairs. Deployment state is recorded separately; source changes are not evidence of a live rollout.

## Runtime and boundaries

- Next.js 16 App Router and React 19, TypeScript, Tailwind CSS, Radix UI and React Query.
- npm with `frontend/package-lock.json`; Node 24.21.x or newer 24.x.
- Supabase Auth identifies accounts; `profiles.user_id` links an auth account to its application profile. Public and owner-scoped queries use the browser/anonymous client with RLS. Privileged endpoints verify the account/role before using server-only service credentials.
- Supabase Postgres, Storage and Realtime support listings/images, conversations/messages, notifications, transactions and moderation.
- Stripe Connect handles configured payment operations. Mapbox provides map tiles and forward/reverse geocoding. Optional Resend delivery uses the contact outbox; configuration is deferred by the owner.

## Application

`app/` owns pages and API routes; `components/` owns rendered UI; `lib/services/` owns client-facing data contracts; `lib/utils/` owns common server guards; `supabase/migrations/` contains reviewable database changes. Legacy parallel component directories remain compatibility surfaces; follow active imports rather than folder names.

New listings use optional photos first, then one description with local deterministic field extraction, editable tags, location autocomplete and optional profile-phone prefill. Uploaded files are validated before persistence. Unknown facts remain editable rather than fabricated.

## Payments

Transactions identify payer/payee from the listing request/offer direction. PaymentIntent authorization uses manual capture; completion checks precede capture and Connect transfer. This is an authorization workflow with provider limits, not an unlimited funds-holding guarantee. Webhook operations and refund reconciliation use idempotent database functions. Rate-limit counters use an atomic service-only database function; sensitive routes fail closed if it is unavailable.

## Operations and tests

`proxy.ts` applies CSP/security headers and CSRF checks. Health probes return non-success when a required dependency is unavailable. Production demo/profile stub APIs have been removed. Contact delivery retries use the existing outbox and authenticated dispatch worker.

Unit/component/API tests run with Vitest; database policies and transactional behavior run against isolated PGlite fixtures. Playwright journeys use an isolated production build, mock external network responses, and test desktop/mobile listing flows. This browser coverage complements database tests and does not prove real Stripe/email delivery.

Production is an existing Vercel deployment with a separate Supabase project. See [SETUP](SETUP.md) for historical applied migration mappings and [current repairs](AUDIT_REPAIRS_2026-10-26.md) for new rollout requirements. A source edit, CI run or local build does not deploy automatically.
