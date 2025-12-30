# Project TODO

## Phase 0: Foundations
- [ ] Configure Supabase envs (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
- [ ] Wire Supabase client and verify connection.
- [ ] Prepare Stripe keys and webhook secret; add server routes plan.

## Phase 1: Schema & Migration
- [ ] Create SQL migrations (tables, constraints, PostGIS, indexes, RLS).
- [ ] ETL plan from Mongo → Supabase (users, listings, images, reviews, messages).
- [ ] Validate ST_DWithin/ST_Distance queries on seeded data.

## Phase 2: Auth Refactor
- [ ] Replace axios auth with `supabase.auth`.
- [ ] Update profile context to `profiles`.
- [ ] Remove CSRF/token handling and proxy routes.

## Phase 3: Listings & Storage
- [ ] CRUD for listings via Supabase.
- [ ] Storage uploads for listing images; main image selection.
- [ ] Status transitions (`active/sold/suspended`).

## Phase 4: Geosearch
- [ ] Nearby search API using PostGIS.
- [ ] Mapbox integration with markers, clustering, bounds.
- [ ] URL-driven filters (category/subcategory/radius).

## Phase 5: Messaging
- [ ] Chats/messages tables; RLS policies.
- [ ] Realtime subscriptions; unread counts via last_read_at.
- [ ] Chat UI (list/thread/composer).

## Phase 6: Payments (5% Escrow)
- [ ] Stripe Connect onboarding for sellers.
- [ ] PaymentIntent creation with 5% fee; capture to platform.
- [ ] Transfers to seller on confirmation; refunds/disputes.
- [ ] Webhook handlers (idempotent) → payments/transactions/disputes.

## Phase 7: Ratings & Reputation
- [ ] Review submission; vote helpful.
- [ ] Aggregate reputation to profiles; display badges.

## Phase 8: Moderation & Admin
- [ ] Disputes UI and actions.
- [ ] User suspension and audit logs.
- [ ] Notifications center.

## Phase 9: Frontend Polishing
- [ ] Replace axios/proxy with Supabase throughout.
- [ ] Optimize caching and skeletons; Nearby map page.

## Phase 10: Decommission Backend
- [ ] Cut-over checklist; delete Express/Mongo backend.

## Dependency Hygiene
- [ ] Remove `@react-google-maps/api`; standardize on Mapbox.
- [ ] Align `react` and `@types/react` versions.
- [ ] Keep Next 15, TanStack 5, Tailwind 3.