## Objectives
- Make secure implementations the live endpoints across payments.
- Enforce authentication, rate limiting, audit logging, and consistent error handling everywhere.
- Fix database migration drift and align tests with live code.

## Key Risks & Constraints
- Next.js App Router serves `route.ts` (not `secure-route.ts`), causing drift.
- Migration `frontend/supabase/sql/022_milestone_rate_limits.sql` conflicts with actual `rate_limits` schema.
- CSRF middleware may block Bearer-token payment calls if headers are not aligned.

## Endpoint Unification (Primary Changes)
- `app/api/payments/create-intent/route.ts`: Replace body with the secure implementation from `secure-route.ts` (auth, zod validation, rate limiting, audit logging, structured errors).
- `app/api/payments/milestones/create-intent/route.ts`: Replace with secure implementation (auth, zod validation, per-listing logic, rate limiting, audit logging).
- `app/api/payments/webhook/route.ts`: Replace with secure handler (signature verification, duplicate detection via `webhook_events`, atomic DB functions, comprehensive audit logging).
- Remove duplicate `secure-route.ts` files after merging to avoid future drift.

## Authentication & Authorization
- Derive buyer identity strictly from Bearer token using `supabaseAdmin.auth.getUser` and `profiles.user_id` mapping.
- Prevent self-purchase and self-milestone creation.
- Validate listing status (`active`).

## Rate Limiting
- Use `rateLimitEnhanced` consistently:
  - Apply to `create-intent` and `milestones/create-intent` (already in secure versions).
  - Add to `app/api/payments/capture/route.ts` and admin disputes routes (`refund`, `resolve`) with appropriate keys (e.g., `capture:${ip}`, `admin:refund:${ip}`, `admin:resolve:${ip}`) and windows.
- Remove/replace `rateLimit` usages with `rateLimitEnhanced` for consistency.

## Stripe Idempotency & Safety
- Supply idempotency keys for `stripe.paymentIntents.create` and refunds/captures derived from deterministic inputs (e.g., `userId:listingId:milestoneId:tsbucket`).
- Cancel Stripe intent on DB insert failure (already done in secure routes).

## Webhook Processing (Atomic & Audited)
- Validate signature; parse and zod-validate event payload.
- Check and insert `webhook_events` to avoid duplicates.
- Use atomic SQL functions for payment lifecycle (`payment_complete_atomic`, `payment_fail_atomic`, `payment_refund_atomic`).
- Log detailed audit entries for each event type and create notifications as needed.

## Audit Logging Standardization
- Add audit logs for:
  - Payment capture attempts and outcomes.
  - Admin dispute refund and resolve actions.
  - Intent and milestone intent creation (already present in secure versions).
- Ensure consistent metadata (requestId, ip, userAgent, actor profile).

## Error Handling Standardization
- Wrap all payment endpoints with `withApiErrorHandler` to unify error schema and include `requestId`.
- Replace ad-hoc `try/catch` and `console.error` in `capture` and admin routes.

## CSRF Scope & Middleware Alignment
- Review `frontend/middleware.ts` rules for CSRF:
  - Confirm Bearer-token payment routes either include CSRF header (`X-CSRF-Token`) via client (`frontend/lib/utils/csrf.ts`) or are exempted when using stateless tokens.
- Adjust middleware exceptions to avoid blocking secure Bearer-token-backed payment operations.

## Database Migrations (Fix Drift)
- Correct `frontend/supabase/sql/022_milestone_rate_limits.sql`:
  - Remove unsupported columns (`reset_at`, `burst_count`, `burst_reset_at`) to match `rate_limits (key, window_start, count)`.
  - Keep runtime rate limit configs in code; avoid persisting burst metadata in table.
- Validate and re-run migrations for atomic functions and unique constraints (`024`, `025`, `026`).

## Tests (Align With Live Endpoints)
- Update test imports to target `route.ts` files (post-unification):
  - `tests/api/payments/create-intent/secure-route.test.ts` → renamed/updated to hit live `route.ts`.
  - `tests/api/payments/milestones/create-intent/secure-route.test.ts` → same.
  - `tests/api/payments/webhook/secure-route.test.ts` → same.
- Add new tests:
  - Capture route: auth, confirmation prerequisite enforcement, Stripe capture outcomes.
  - Admin disputes refund/resolve: auth via `requireAdmin`, rate limiting, success/failure paths.
  - Webhook duplicate handling and atomic transitions.
  - CSRF behavior for payment endpoints with Bearer tokens.

## Documentation Synchronization
- Update `frontend/docs/security-implementation-summary.md` to reflect unified endpoints and remove claims until changes are applied.
- Ensure `SECURITY.md` and `ARCHITECTURE.md` reflect new standardized patterns (auth derivation, error handling, rate limiting, audit logging, webhook atomic processing).
- Provide a concise changelog entry per task (timestamp, what, why, affected files).

## Rollout Plan
- Create a development branch and implement all changes.
- Run full test suite locally; fix failing tests.
- Deploy to staging with Stripe test keys; validate flows with test cards.
- Monitor logs for rate-limits, webhook processing, and error consistency.
- Toggle feature flags and roll out gradually; provide rollback path by keeping prior `route.ts` in VCS history.

## Deliverables
- Patches replacing `route.ts` contents with secure implementations (diffs for review).
- Migration fix patch for `022_milestone_rate_limits.sql`.
- Updated tests and coverage report.
- Updated documentation and consolidated changelog entries.

## Acceptance Criteria
- All payment-related endpoints enforce auth, validation, rate limiting, and standardized error handling.
- Webhook processing uses signature verification, duplicate detection, and atomic functions.
- Audit logs created for intent creation, milestone creation, capture, and admin dispute actions.
- Tests cover the live endpoints and pass in CI.
- Database migrations apply cleanly without schema conflicts.

Please confirm, and I will proceed to implement the changes and provide diffs for review before applying them.