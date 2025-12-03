# Project Direction and Deliverables
- Migrate backend to Supabase (Postgres + Auth + Realtime + Storage) and decommission current Express/Mongo backend after data/schema migration.
- Implement core marketplace features: ads for items/services (sell/buy/free), geolocation search, messaging, payments with 5% fee and escrow-style protection, ratings/reputation, abuse/dispute handling, admin oversight.
- Produce two living docs: `TODO.md` (tracked task list) and `ARCHITECTURE.md` (system design and data flow). Update dependencies and refactor frontend for Supabase.

## Gap Analysis (What’s done vs missing)
- Listings & Models
  - Present: Listing model with geolocation and tags (`backend/models/Listing.ts:65-175`), basic CRUD controller but mismatched fields.
  - Issues: Controller uses `category` and regex location (`backend/controllers/listingsController.ts:76-93, 149-176`) while schema defines `mainCategory`/`subCategory` and GeoJSON `location`. Payment refund sets invalid status "available" (`backend/routes/payment/payment.routes.ts:336`) not in enum.
  - Missing: Business flows for sell/buy/free, moderation, publication lifecycle.
- Search & Map
  - Present: MapService using Mongo geo (`backend/services/MapService.ts`), frontend search UI skeleton (`frontend/components/features/search/*`).
  - Missing: Actual search results, map integration on frontend, PostGIS queries in Supabase, URL-param driven search to API.
- Messaging
  - Present: Chat routes/controllers placeholders (`backend/controllers/chatController.ts`).
  - Missing: Real chat DB, realtime updates, inbox UI, notifications.
- Payments
  - Present: Payment/Transaction models (`backend/models/Payment.ts`, `backend/models/Transaction.ts`), mock Stripe routes with 3% fee (`backend/routes/payment/payment.routes.ts:83`).
  - Missing: 5% platform fee, escrow/capture & release flow, Stripe Connect/webhooks, dispute/refund policy.
- Ratings/Reputation
  - Present: Review model (`backend/models/Review.ts`) and user rating aggregates (`backend/models/User.ts:96-106`).
  - Missing: Posting reviews, aggregation, display, anti-abuse checks.
- Auth
  - Present: JWT-based auth, SIWE optional (`backend/controllers/authController.ts` + middleware). Frontend auth context (`frontend/contexts/auth-context.tsx`), axios proxy (`frontend/lib/api/axios.ts`).
  - Missing: Supabase Auth integration, token/CSRF removal where unnecessary.
- Frontend
  - Present: Next.js App Router pages for search/items/services/nearby/chat/profile/dashboard; API proxy and health checks.
  - Issues: Mixed base URLs (3001 vs 3002) (`frontend/app/api/proxy-health-check/route.ts:9`, `frontend/app/api/proxy/[...path]/route.ts:29`, `frontend/lib/api/axios.ts:4`). Search results stubbed (`frontend/components/features/search/search-results.tsx`).

# Target Architecture (Supabase-centric)
- Data
  - Postgres with PostGIS (`extensions: postgis`); Storage buckets for uploads; Realtime on `messages`/`chats`.
  - Core tables: `users`, `profiles` (linked to Supabase auth), `listings`, `listing_images`, `listing_tags`, `transactions`, `payments`, `reviews`, `chats`, `messages`, `notifications`, `disputes`, `categories`, `tag_interactions`.
  - Geospatial: `listings.location` as `geography(Point, 4326)`; indexes for `ST_DWithin` queries.
- Auth
  - Supabase Auth (email/password + optional SIWE via wallet auth strategy). Policy-based row-level security (RLS) for user-owned data.
- Messaging
  - `chats` and `messages` tables with Realtime subscriptions; delivery receipts and unread counts via triggers.
- Payments
  - Stripe integration via serverless API routes or Supabase Edge Functions; 5% platform fee using Stripe Connect `application_fee_amount`; escrow via manual capture or `destination_charge` with delayed transfers; webhook-driven status updates.
- Ratings
  - `reviews` table; aggregate reputation via materialized view or trigger-maintained columns on `profiles`.
- Abuse/Dispute
  - `disputes` table with states; admin workflows; evidence attachments in Storage; time-based holds on transfers.
- Frontend
  - Supabase client SDK (`@supabase/supabase-js`), TanStack Query for data; map integration (Mapbox GL JS) for nearby search; unified API layer calling Supabase or Next serverless functions for Stripe/disputes.

# Supabase Schema (Initial DDL Outline)
- `profiles(id uuid pk, full_name text, phone text, avatar_url text, created_at timestamptz, reputation numeric, ratings_count int)` linked to `auth.users.id`.
- `listings(id uuid pk, seller_id uuid fk profiles, title text, description text, price numeric, main_category text, sub_category text, status text, location geography(Point,4326), address jsonb, created_at timestamptz)` + GIST index on location.
- `listing_images(listing_id uuid fk, url text, main boolean)`.
- `listing_tags(listing_id uuid fk, tag text)`.
- `chats(id uuid pk, created_by uuid fk profiles, is_group boolean, created_at timestamptz)`.
- `chat_participants(chat_id uuid fk, user_id uuid fk)`.
- `messages(id uuid pk, chat_id uuid fk, sender_id uuid fk, content text, attachments jsonb, created_at timestamptz)` with Realtime enabled.
- `payments(id uuid pk, listing_id uuid fk, buyer_id uuid fk, seller_id uuid fk, amount numeric, platform_fee numeric, stripe_payment_intent text, status text, created_at timestamptz, updated_at timestamptz)`.
- `transactions(id uuid pk, payment_id uuid fk, status text, created_at timestamptz)`.
- `reviews(id uuid pk, listing_id uuid fk, seller_id uuid fk, reviewer_id uuid fk, rating int, comment text, created_at timestamptz)` plus trigger to update `profiles.reputation` and `ratings_count`.
- `disputes(id uuid pk, payment_id uuid fk, opened_by uuid fk, status text, reason text, created_at timestamptz, resolved_at timestamptz)`.
- `notifications(id uuid pk, user_id uuid fk, type text, payload jsonb, read boolean, created_at timestamptz)`.

# Implementation Phases
## Phase 0: Foundations
- Add Supabase project credentials; set envs in frontend (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) and server (`SUPABASE_SERVICE_ROLE_KEY`, Stripe keys).
- Introduce supabase client and base data layer; keep Next API for payment/disputes webhooks.

## Phase 1: Schema & Migration
- Create SQL migrations for all tables, indexes, RLS policies.
- Data migration plan: if existing Mongo data is minimal, seed test data; otherwise write one-off ETL to Supabase using scripts.
- Validate PostGIS queries with `ST_DWithin` for nearby.

## Phase 2: Auth Refactor
- Replace `AuthProvider` with Supabase auth hooks; update `profile-context` to source profile row; remove axios CSRF/token logic; keep proxy only for server-side payments.

## Phase 3: Listings & Search
- Implement listing CRUD via Supabase; enforce publication statuses; map category/subcategory to enums.
- Implement geosearch API: client calls supabase RPC or filter with `ST_DWithin`; render map + result cards; URL-driven filters with `nuqs`.

## Phase 4: Messaging
- Implement chats/messages tables; client realtime subscriptions; basic chat UI: list + thread + composer.

## Phase 5: Payments (5% Fee + Escrow)
- Replace mock Stripe with real integration:
  - Create PaymentIntent with `application_fee_amount=amount*0.05` and `transfer_group`.
  - Use manual capture or delayed transfer to seller upon completion; store intent id; webhook handlers for `payment_intent.succeeded`, `charge.refunded`.
  - Dispute flow: open disputes, freeze transfer, optionally refund buyer.
- Update listing status transitions: `active → sold` on capture; `sold → active` only via explicit refund path.

## Phase 6: Ratings & Reputation
- Review submission UI and API; server triggers that update profile aggregates; display ratings on listings and profiles.

## Phase 7: Abuse/Moderation & Admin
- Admin screens for disputes, user suspensions, content flags; audit logging; notification emails.

## Phase 8: Frontend Polishing
- Replace axios proxy usage with supabase queries; keep minimal Next API for payments/disputes.
- Implement Nearby page with map and radius slider; optimize TanStack Query caches.

## Phase 9: Decommission Express Backend
- Document cut-over checklist; stop backend dev server; remove backend directory after confirmation.

# Dependency Updates & Refactors
- Frontend
  - Add `@supabase/supabase-js`, `@mapbox/mapbox-gl` (or `react-map-gl`), Stripe JS if using client-side confirmation.
  - Remove or minimize axios proxy and CSRF overhead once Supabase direct reads are in place.
  - Fix base URL inconsistencies (3001 vs 3002) noted in `frontend/lib/api/axios.ts:4` and proxy health (`frontend/app/api/proxy-health-check/route.ts:9`).
- Backend (to be removed)
  - No further expansion; only used to verify current behavior until Supabase cut-over.

# Immediate Fixes Noted (to schedule)
- Platform fee: change to 5% (`backend/routes/payment/payment.routes.ts:83`).
- Listing status bug: refund handler sets `available` (invalid) (`backend/routes/payment/payment.routes.ts:336`).
- Listings controller: align fields with schema (`mainCategory`, `subCategory`, GeoJSON `location`).
- Search endpoints: implement real queries or remove once Supabase search is live.

# Testing & Verification
- Unit tests on Supabase RPCs and data layer; integration tests for payments webhooks; E2E for listing publish → purchase → rating.
- Map queries validated with sample data and radius sweeps; messaging realtime tested with two clients.

# Docs to Create (after confirmation)
- `ARCHITECTURE.md`: system overview, data models, auth, payments/escrow flow, geosearch.
- `TODO.md`: phase-based task list with checkboxes, updated at each approval checkpoint.

# Next Step
- On your confirmation, I will:
  1) Create `ARCHITECTURE.md` and `TODO.md` with the above structure.
  2) Initialize Supabase client in frontend and scaffold migrations (SQL files) for schema.
  3) Implement Phase 1 tasks and start refactoring auth/listings/search accordingly.