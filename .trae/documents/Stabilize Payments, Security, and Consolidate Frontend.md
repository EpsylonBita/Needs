## Objectives
- Eliminate critical payment correctness bugs and CSRF/XSS vulnerabilities.
- Consolidate duplicated components and tame monolithic code.
- Add essential DB indexes and integrity constraints for scale.
- Establish tests, observability, and strict build gates to prevent regressions.

## Phase 1 — Critical Hotfixes (Priority: CRITICAL)
### Stripe Webhook Idempotency and Correctness
- Fix event construction order in `frontend/app/api/payments/webhook/route.ts:12–24`:
  - Construct the event first: `event = stripe.webhooks.constructEvent(raw, sig, secret)`.
  - Then read `event.id` and record idempotency in `webhook_events` (unique id).
- Stop inserting duplicate payments on `payment_intent.succeeded`:
  - Replace insert with update of existing row found via `stripe_payment_intent`.
  - File: `frontend/app/api/payments/webhook/route.ts:37–50` → change to update `status = 'completed'` and then insert `transactions` referencing the same `payments.id`.
- Add `webhook_events` table with `id text primary key` and enforce uniqueness; upsert on duplicate.
- Acceptance:
  - Multiple deliveries of the same webhook do not create duplicate `payments`/`transactions`.
  - A previously created intent progresses to `completed` only once; refunds/disputes link back correctly.

### CSRF Enforcement Alignment
- Implement a client helper to fetch and attach CSRF header:
  - New utility (client-only) `lib/utils/csrf.ts`: `getCsrfToken()` → fetch `/api/csrf`, read cookie, return header value.
  - Wrap all POST/PUT/DELETE calls to include `X-CSRF-Token`.
- Update payment-related client calls:
  - `frontend/app/payments/return/page.tsx` and `frontend/app/dashboard/orders/page.tsx` to attach CSRF.
- Acceptance:
  - All state-changing fetches succeed under middleware CSRF validation in `frontend/middleware.ts:67–96`.

### XSS Removal in Map Component
- Remove or quarantine unsafe component using `setHTML`:
  - File: `frontend/components/map/map-component.tsx` — delete usages of `setHTML` or replace with React-rendered popovers.
  - Standardize usage on `components/features/map/map-component.tsx` only.
- Acceptance:
  - No user-controlled HTML is injected; static analysis shows no raw `innerHTML`/`setHTML`.

## Phase 2 — Database Indexes & Integrity (HIGH)
- Add indexes via migrations (Supabase SQL):
  - `CREATE INDEX payments_intent_idx ON payments(stripe_payment_intent);`
  - `CREATE INDEX messages_chat_idx ON messages(chat_id, created_at);`
  - `CREATE INDEX notifications_user_idx ON notifications(user_id, created_at);`
- Confirm & add constraints:
  - Ensure `transactions.payment_id` has FK to `payments(id)` (it does in `001_init.sql:76–82`; verify cascade semantics).
  - Add `webhook_events(id text primary key)` and use `INSERT ... ON CONFLICT DO NOTHING` semantics.
- Acceptance:
  - Hot-path queries use indexes; query plans show index scans not full scans.

## Phase 3 — Component Consolidation & Refactor (MEDIUM)
### De-duplicate Components
- Canonicalize feature components in `components/features/*`; remove legacy duplicates in `components/*`:
  - Auth: `components/features/auth/*` vs `components/auth/*`.
  - Map: `components/features/map/*` vs `components/map/*`.
  - Ads: `components/features/ads/*` vs `components/ads/*`.
- Update barrel exports and imports to point to canonical paths only.

### Break Down Monolith: `create-ad-dialog.tsx`
- Split `frontend/components/features/ads/create-ad-dialog.tsx` (~1200 lines) into:
  - `AdBasicInfoForm.tsx` (title, description, price)
  - `CategoryTagsPicker.tsx` (taxonomy UI)
  - `LocationPicker.tsx` (map + geolocation)
  - `ImageUploader.tsx` (image selection & upload)
  - `AiExtractPanel.tsx` (WIT extraction flow)
- Move `CATEGORY_STRUCTURE` to a shared module `lib/constants/categories.ts` and import where needed.
- Acceptance:
  - File size < 300 lines; subcomponents individually testable; unchanged UI behavior.

## Phase 4 — Rate Limiting & Security Hardening (HIGH)
- Replace process-local rate limit with distributed store:
  - New `lib/utils/rate-limit.ts` using Redis/Upstash (or Supabase RLS-safe counters) with IP+route keys.
- Review CSP in `frontend/middleware.ts:23–52`:
  - Ensure `connect-src` includes Supabase and Stripe domains precisely; avoid overly broad wildcards in prod.
- Acceptance:
  - Rate limiting holds across multiple instances; security headers verified by Lighthouse/Observatory.

## Phase 5 — Testing & Observability (HIGH)
- Introduce tests (Vitest/Jest + MSW where applicable):
  - Unit: payment intent creation (fee calc), CSRF helper, category taxonomy utilities.
  - Integration: webhook → update payments; refund/dispute flows; ensures idempotency.
  - E2E (Playwright): checkout → capture → webhook reconciliation and UI reflection.
- Structured logging:
  - Replace `console.log` in server routes with a minimal logger; redact PII; include correlation IDs.
- Acceptance:
  - CI passes on tests; coverage for payment/webhook/CSRF > 80% of critical paths.

## Phase 6 — Build Config Hardening (MEDIUM)
- In `frontend/next.config.js:27–35`:
  - Set `ignoreDuringBuilds: false` and `typescript.ignoreBuildErrors: false` for production.
  - If needed, gate via `process.env.CI_STRICT=true` to enable strict mode on CI first, then production.
- Acceptance:
  - Broken types/lint block the build on CI; developers fix before merging.

## Phase 7 — State Management Consistency (MEDIUM)
- Decide and commit:
  - Adopt `@tanstack/react-query` for data fetching/caching or remove it.
- Implement standard hooks:
  - `usePayment`, `useListings`, `useMessages` built on React Query with stale time tuned; avoid ad-hoc `useEffect` fetches.
- Acceptance:
  - Consistent data-fetching across app; fewer bespoke fetches; cache working correctly.

## Phase 8 — Deployment Strategy & Rollback (MEDIUM)
- Use `feature_flags` (`frontend/supabase/sql/011_feature_flags.sql`) to gate:
  - Payments actions while refactor lands.
- Progressive rollout:
  - Canary environment exercises webhook idempotency; collect logs; then flip flag.
- Rollback:
  - Keep previous migration versions; if webhook changes misbehave, revert to old implementation (but never back to duplicate inserts).

## Deliverables & Acceptance Criteria
- Payments: Single row lifecycle (`requires_capture` → `completed/refunded/failed`) with consistent `transactions`.
- Security: All POST/PUT/DELETE include CSRF; no XSS vectors via map or dialogs.
- DB: Indexes in place; query plans show index usage on hot paths.
- Frontend: No duplicated components; `create-ad-dialog` modularized.
- Testing: CI running unit/integration/E2E; strict build gates enforced.

## Risks & Mitigations
- Risk: Enabling strict build gates breaks existing code.
  - Mitigation: Enable in CI first; fix violations incrementally; set `CI_STRICT` gates.
- Risk: Webhook changes mis-handle certain Stripe events.
  - Mitigation: Add idempotent `webhook_events` store; verify event types in staging with replay tools.
- Risk: Component consolidation causes import breakage.
  - Mitigation: Provide temporary re-export shims; run `eslint --fix` and a codemod to rewrite imports.

## Sequencing Summary
1) Fix webhook idempotency and update logic; add DB indexes and `webhook_events`.
2) Implement CSRF helper and patch all client mutations.
3) Remove unsafe map, consolidate feature components.
4) Replace rate-limit; harden CSP.
5) Add tests and logging; turn on strict build gates.
6) Refactor `create-ad-dialog` into subcomponents; move taxonomy constants.
7) Standardize state management; finalize rollout behind feature flags.

Confirm this plan and I’ll execute Phase 1 immediately, then proceed through the phases with verification at each step.