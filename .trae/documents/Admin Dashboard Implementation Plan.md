## Scope
- Build a first‑class admin dashboard to control and monitor all marketplace operations: revenue, payments, disputes, listings moderation, users, notifications, milestones, webhooks/health, and audit logs.

## Information Architecture
- Root: `/dashboard/admin` with a persistent left sidebar and top filters.
- Sections (routes):
  - Overview: `/dashboard/admin/overview`
  - Revenue & Payments: `/dashboard/admin/payments`
  - Disputes: `/dashboard/admin/disputes`
  - Listings Moderation: `/dashboard/admin/listings`
  - Users: `/dashboard/admin/users`
  - Notifications: `/dashboard/admin/notifications`
  - Milestones: `/dashboard/admin/milestones`
  - Webhooks & Health: `/dashboard/admin/status`
  - Audit Logs: `/dashboard/admin/logs` and detail `/dashboard/admin/logs/[id]`
  - Settings & Feature Flags: `/dashboard/admin/settings`

## Access Control
- Gate all admin routes/actions behind `requireAdmin` (existing helper) using `ADMIN_EMAILS`.
- Server Route Handlers perform privileged operations via `supabaseAdmin`.
- Client pages read under RLS where possible; write via admin API endpoints only.

## Data & Queries
- Payments aggregation via `monthly_payments_agg` view (already created) for charts and KPIs.
- Moderation logs (`moderation_logs`) for auditability (notes supported).
- Webhook idempotency (`webhook_events`) for status and retries.
- Milestones table with mutual confirmations and Stripe intent linkage.
- Disputes/payments/transactions/notifications tables for management views.

## Overview Page (KPIs)
- KPIs: Total Volume, Platform Fees, Active Listings, New Users (last 30 days), Open Disputes, Transfers Pending.
- Time range filter (Month to date, Last 30 days, Custom range).
- Comparison toggle (vs previous period).

## Revenue & Payments
- Monthly chart with filters (year; show/hide Volume/Fee).
- Payments table: status filter (requires_capture/completed/refunded/failed), column sort, CSV export.
- Actions: view intent id, open refund (admin), jump to dispute if exists.

## Disputes Management
- Table (status: open/resolved/refunded/rejected), reason; actions: resolve/refund (admin buttons wired to existing endpoints).
- Detail view showing payment linkage, timeline.

## Listings Moderation
- Listings table: status, seller, category, created; actions: suspend/unsuspend, view listing.
- Suspend dialog with admin note (logged to `moderation_logs`).

## Users
- Users list (profiles): email, display_name, reputation, rating_count, stripe status; actions: force stripe onboarding email, deactivate/suspend (soft) listings.
- Filters: onboarded vs not onboarded, high dispute rate.

## Notifications
- Admin broadcast: create notification to a user or cohort (optional V1: per‑user only).
- User notifications list with mark‑read for admin troubleshooting.

## Milestones
- List milestones: status, amount, parties; actions: create intent, mark confirmations (for support), capture (admin override).
- Creation flow: from chat/listing (already wired) and admin page for testing.

## Webhooks & Health
- Webhook events list (latest 100), duplicate count, last error.
- Health checks: Stripe keys present, Supabase reachable, Realtime publications.
- Retry webhook (manual re‑send test with sample payload) – optional V2.

## Audit Logs
- Logs list with filters (action, admin, date range), export.
- Detail view with listing title, admin notes edit (implemented), and related actions.

## Settings & Feature Flags
- Toggles: `NEXT_PUBLIC_PAYMENTS_ENABLED`, dummy feature flags stored in `feature_flags` table (create if missing).
- Admin emails editor (append/remove) with confirmation.

## UI/UX & Components
- Use existing shadcn UI, Recharts for charts, tables with pagination and column filters.
- Sidebar icons for quick section access; breadcrumbs and time filters on top.
- Consistent “danger” actions behind confirm dialogs.

## APIs & Route Handlers (Server)
- Listings: suspend/unsuspend with notes (exists for suspend; add unsuspend).
- Payments: list/export, refund (exists), capture check (exists), webhook status.
- Disputes: resolve/refund (exists), create (exists for buyers).
- Milestones: create (exists), create intent (exists), confirmations via RLS updates.
- Notifications: list and mark‑read (exists), admin create (new minimal endpoint).
- Feature flags: CRUD for admin table.

## Security & Compliance
- No service‑role exposed client‑side; all privileged mutations via admin route handlers.
- Confirm CSRF for destructive admin actions (already used for disputes admin); extend to suspend/unsuspend and flags updates.
- Log every destructive action to `moderation_logs` with admin email and note.

## Performance
- Charts read from server‑side views and paginate tables; use count queries for KPIs.
- Map viewport fetch already debounced to 1200ms; admin pages use server chunks and lazy loading.

## Rollout Steps
1) Create AdminLayout and sidebar; wire routes under `/dashboard/admin`.
2) Build Overview KPIs using aggregated queries and views.
3) Implement Payments page with filters and monthly chart from `monthly_payments_agg`.
4) Complete Disputes and Listings pages with actions and notes logging.
5) Users page: basic list with filters (onboarded, disputes count).
6) Notifications page: admin view and simple broadcast endpoint.
7) Milestones admin page: intent creation, confirmations, capture.
8) Webhooks/Health page: latest events and checks.
9) Settings/Flags: minimal table and toggles.
10) Add CSRF to new destructive endpoints; verify audit logs.

## Acceptance Criteria
- All admin routes gated; unauthorized redirects.
- KPIs and charts match `monthly_payments_agg` for selected year.
- Moderation actions write to `moderation_logs` and change listing status.
- Disputes can be resolved/refunded from admin; logs reflect changes.
- Milestones can be created, intent generated, and captured after confirmations.
- Notifications list updates in realtime; navbar bell count increments.
- Webhooks page shows recent events; health shows green checks.
- Settings page toggles at least one feature flag with CSRF.

Confirm this plan; then I’ll implement AdminLayout, overview KPIs, and the remaining pages with secure endpoints in the next pass.