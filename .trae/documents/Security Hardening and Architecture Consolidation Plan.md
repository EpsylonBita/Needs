## Objectives
- Harden payment and API security, ensuring consistent protections.
- Consolidate frontend architecture to remove duplication and drift.
- Improve database integrity and performance with constraints and indexes.
- Standardize error handling and observability across the stack.
- Expand tests to cover middleware, non-payment APIs, and critical flows.
- Establish operational rigor: CI/CD, env validation, and background processing.

## Scope
- Payment endpoints, shared utilities, middleware, database migrations, admin dashboards, and testing.

## Area 1: Payment Security Hardening
- Rate limiting
  - Change key to `payments:${user.id}:${ip}` and use user-only if IP missing.
  - Fail-closed on limiter errors for payment-sensitive routes.
  - Return consistent `Retry-After` and `X-RateLimit-Remaining` headers.
- Idempotency
  - Extend key to include `amount` or a price version: `intent:${buyerId}:${listingId}:${amount}`.
  - Document behavior for listing price updates.
- Audit trail taxonomy
  - Add actions: `intent_creation_attempt`, `intent_created`, `intent_creation_failed`, `payment_record_created`, `intent_cancelled_on_db_error`.
  - Include `request_id`, `intent_id` in all entries.
- Stripe config validation
  - Validate `STRIPE_SECRET_KEY` presence at init; throw descriptive error if missing.
- Atomicity (optional RPC)
  - Create a Postgres function to insert payment + audit in one call where feasible.
- DB constraints
  - Add partial unique index to prevent multiple open intents per `(buyer_id, listing_id)` (statuses `requires_capture`, `requires_payment_method`).
- Tests
  - Update/create tests for idempotency changes, audit events, limiter behavior, and failure/rollback paths.

## Area 2: API Standardization & Security
- Error handling
  - Wrap all `app/api/*` routes with `withApiErrorHandler` for consistent envelopes.
  - Always include `X-Request-Id` on success and error responses.
- Auth & rate-limit helpers
  - Centralize auth guard patterns (Bearer token checks) and rate-limit invocation in shared utilities.
- CSRF policy
  - Confirm Bearer-only flows for payments; if cookies are introduced, enforce CSRF token checks via middleware and tests.
- Tests
  - Add contract tests for representative non-payment routes: search, admin, listings moderation.

## Area 3: Frontend Architecture Consolidation
- Component duplication
  - Identify duplicated modules (e.g., map components) and select a single authoritative implementation under `components/features/*` for domain components and `components/ui/*` for primitives.
  - Replace imports via barrel files and remove deprecated duplicates.
- Developer experience
  - Add guidance in `ARCHITECTURE.md` to reflect the consolidated structure.

## Area 4: Database Modeling & Indexing
- Constraints & indexes
  - Add missing indexes for common filters: `payments.status`, `disputes.status`, `transactions.type/status`, foreign keys.
  - Ensure RLS policies remain consistent after changes.
- Migrations
  - Create new SQL migrations in `supabase/sql` and mirror in `frontend/supabase/migrations` if required.

## Area 5: Admin Dashboards & KPIs
- Server-side KPIs
  - Create API endpoints returning pre-aggregated metrics for admin overview to avoid client-side multi-query aggregation.
- Dashboard updates
  - Refactor admin pages to consume KPI endpoints; add pagination and caching where reasonable.

## Area 6: Testing Expansion
- Middleware tests
  - Verify CSRF enforcement and security headers for state-changing endpoints; include exclusion paths.
- API tests
  - Add tests for search, admin, listings moderation; enforce error envelope and request ID.
- Payments tests
  - Expand to cover new audit events, idempotency key with amount, limiter fail-closed behavior.

## Area 7: DevOps & Deployment
- CI/CD
  - Add deploy workflow with environment validation and secrets scanning.
  - Enable strict lint/typecheck gating (`CI_STRICT=true`).
- Observability
  - Standardize logging event names and required fields; ensure request ID propagation.
  - Evaluate APM/error tracking (e.g., Sentry) without committing to a vendor in code until approved.

## Area 8: Background Jobs & Webhooks
- Background processing
  - Offload webhook-driven state transitions and notifications to background workers (Supabase Edge Functions or scheduled jobs) for reliability.
- Idempotency enforcement
  - Maintain webhook idempotency and add tests for replay/duplicate scenarios.

## Deliverables & Acceptance Criteria
- Updated payment routes with hardened limiter, idempotency key, and full audit taxonomy; tests green.
- Error wrapper applied to all API routes; `X-Request-Id` present on success/error; tests verify.
- Consolidated components with removed duplicates; app builds and UI flows intact.
- New DB constraints/indexes in migrations; verified by query performance checks.
- Admin KPI endpoints live; dashboards use them; reduced client queries.
- Middleware and non-payment API tests added; consistent error envelopes verified.
- CI deploy pipeline added with env validation; strict lint/typecheck enabled.
- Background job strategy defined and initial functions for webhook processing implemented.

## Risks & Mitigations
- Stricter limiter may block legitimate users → tune configs and add clear error messaging.
- Idempotency key change may collide with existing intents → transition strategy: accept old keys for a period or cancel duplicates.
- Component consolidation may break imports → use codemods and CI to catch regressions.

## Verification Plan
- Run `npm run lint`, `npm run typecheck`, and targeted tests: `npm run test:payments` and added suites for middleware and admin.
- Manual checks on payment flows (create, capture, error rollback) in staging environment.

## Sequencing
1. Payment hardening (limiter, idempotency, audit taxonomy, env validation).
2. API standardization and response normalization.
3. DB constraints/indexes and migrations.
4. Component consolidation.
5. Admin KPI endpoints and dashboard refactor.
6. Testing expansion and middleware coverage.
7. CI/CD and observability.
8. Background jobs for webhooks.

## Confirmation
Please confirm this plan. On approval, I will prepare diffs for each area, execute changes incrementally, and validate via tests and staging verification.