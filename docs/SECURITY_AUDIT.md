# Security Audit (2025-11-18)

## Overview
- Current state mixes Supabase auth and an external JWT backend, duplicating attack surface and creating inconsistent authorization paths.
- Admin operations are callable with a static header and run with `supabaseAdmin` privileges.
- Secrets (including Supabase Service Role Key) are committed to the frontend repo.
- CSP is duplicated and permissive (includes `'unsafe-inline'`/`'unsafe-eval'`). CSRF checks exist without a token issuance flow.

## Current Controls
- Authentication
  - Supabase client session management: `frontend/contexts/auth-context.tsx`
  - External backend auth proxies: `frontend/app/api/auth/login/route.ts`, `frontend/app/api/auth/register/route.ts`, `frontend/app/api/auth/profile/route.ts`
  - Supabase clients: `frontend/lib/supabase/client.ts`, `frontend/lib/supabase/server.ts`
- Authorization
  - RLS policies across core tables: `frontend/supabase/sql/002_indexes_policies.sql`
  - Admin endpoints using `supabaseAdmin`: `frontend/app/api/admin/create-user/route.ts`
  - Payments admin actions: `frontend/app/api/payments/disputes/[id]/resolve/route.ts`, `frontend/app/api/payments/disputes/[id]/refund/route.ts`
- Secrets & Config
  - Committed `.env` with Supabase keys: `frontend/.env`
  - Stripe integration: `frontend/lib/stripe/server.ts`, `frontend/app/api/payments/webhook/route.ts`
- Middleware & Headers
  - Security headers + CSP + CSRF enforcement: `frontend/middleware.ts`
  - Additional CSP and headers via Next config: `frontend/next.config.js`
- Storage & Files
  - Listing images and avatars via Supabase Storage: `frontend/lib/services/storage-service.ts`, `frontend/lib/services/profile-service.ts`

## High-Risk Findings
- Committed Supabase Service Role Key and anon key in frontend repo
  - Evidence: `frontend/.env:2-4`
  - Impact: Full DB compromise if leaked; cannot be in client-facing codebase.
- Admin endpoints protected only by a static header and run with service role
  - Evidence: `frontend/app/api/admin/create-user/route.ts:8-11`, `:16-21`, `:25-28`
  - Impact: User creation and profile insertion without proper auth; trivial to exploit if header discovered.
- Payments dispute refund/resolve endpoints lack role checks
  - Evidence: `frontend/app/api/payments/disputes/[id]/resolve/route.ts` (uses `supabaseAdmin`), `refund/route.ts`
  - Impact: Unauthorized refunds/resolutions; financial loss.
- Permissive and duplicated CSP
  - Evidence: `frontend/middleware.ts:20-34` (`'unsafe-inline'`, `'unsafe-eval'`), `frontend/next.config.js:78-91`
  - Impact: Increased XSS risk; conflicting policies cause maintenance errors.
- CSRF enforcement without issuance
  - Evidence: `frontend/middleware.ts:55-79` checks `csrf_token` cookie and `X-CSRF-Token`; no route issuing tokens identified.
  - Impact: Either legitimate requests break or CSRF gets disabled; both are security regressions.

## Medium-Risk Findings
- Dual auth systems (Supabase sessions vs external JWT)
  - Evidence: Mixed usage in `auth-context.tsx` and `lib/services/auth-service.ts`/`token-service.ts`
  - Impact: Inconsistent state, bypass opportunities, complex debugging.
- Public storage URL assumptions, bucket policies not codified
  - Evidence: `storage-service.ts`, `profile-service.ts`
  - Impact: Potential unintended public write/read if bucket rules misconfigured.

## Required Work (Prioritized)
1) Secrets management overhaul
   - Remove committed `.env` from repo; rotate Supabase keys; store secrets in server-only environment (CI/CD, host env vars).
   - Use correct casing: `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (service role key must never be exposed to the client).
2) Admin authorization hardening
   - Replace static header checks with server-side auth verification (Supabase JWT) and role gating (`profiles.is_admin` or custom claim).
   - Add rate limiting, audit logging, and structured error responses.
3) Lock down payments admin endpoints
   - Require admin role; verify requester identity on server; restrict methods; add idempotency for refunds.
4) CSP consolidation and hardening
   - Remove `'unsafe-inline'`/`'unsafe-eval'`; adopt nonce or hashes.
   - Consolidate CSP to one mechanism (middleware or `next.config.js`) and align directives strictly to needed domains.
5) CSRF token issuance
   - Add `/api/csrf` route issuing a strong random token in `csrf_token` HttpOnly+SameSite cookie and echo in response for header usage.
   - Require `X-CSRF-Token` on all state-changing requests; integrate in fetch clients.
6) Authentication unification
   - Choose Supabase-native or external JWT; remove the other path. Normalize profile flows accordingly.
7) Storage policies and validations
   - Explicit bucket policies: private write, public read only if intended; validate file type/size server-side; consider signed URLs.

## Configuration Corrections
- `.env` key casing mismatch with runtime expectations
  - Evidence: `frontend/.env:1-7` vs `frontend/lib/supabase/server.ts` expecting `SUPABASE_SERVICE_ROLE_KEY`.
  - Action: Standardize env names; never include service role key in client bundle.

## Admin Access Plan
- Server-side verify Supabase JWT; fetch user profile and check `is_admin` flag.
- Gate `/dashboard/payments/admin` and all admin APIs; return 403 for non-admins.
- Log admin actions with user ID, timestamp, and payload; add rate limiting.

## CSP Hardening Plan
- Single CSP source; strict `default-src 'self'`.
- `script-src` via nonces/hashes; remove unsafe directives.
- Restrict `connect-src` to exact backend/Supabase domains; limit `frame-src` to Stripe where required.

## CSRF Implementation Plan
- Issue CSRF tokens via dedicated API; set cookie `HttpOnly`, `SameSite=Strict`, `Secure` in production.
- Clients include token in `X-CSRF-Token` for POST/PUT/PATCH/DELETE.
- Exempt webhook endpoints that validate their own signatures.

## Auth Unification Decision
- Supabase path: Drop external login/register proxies; rely on Supabase sessions and RLS.
- External backend path: Stop Supabase session usage; centralize auth with backend JWT + SSR verification.

## Storage Policy Checklist
- Buckets: `listing-images`, `avatars` — enforce private writes, public read only if intentional.
- Validate MIME types and size limits server-side; sanitize filenames; use signed URLs for private content.

## Verification Checklist
- Secrets removed from repo; keys rotated; server-only envs configured.
- Admin endpoints reject non-admins; static header unused; rate limiting active.
- Single, strict CSP applied; no `'unsafe-*'` directives.
- CSRF token issuance works; state-changing requests succeed with matching token; blocked otherwise.
- Auth paths unified; tests cover login, profile, admin flows.
- Storage policies confirmed; uploads validated.

## Key File References
- `frontend/app/api/admin/create-user/route.ts:8-11,16-21,25-28`
- `frontend/middleware.ts:20-34,55-79`
- `frontend/next.config.js:78-91`
- `frontend/.env:2-4`
- `frontend/contexts/auth-context.tsx`
- `frontend/app/api/auth/*`
- `frontend/lib/supabase/*`
- `frontend/app/api/payments/*`
- `frontend/supabase/sql/*.sql`