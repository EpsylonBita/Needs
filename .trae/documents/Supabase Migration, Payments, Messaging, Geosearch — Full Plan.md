# Objective
Build a marketplace for buying/selling/giving services/items with: geolocation search, accounts, direct messaging, Stripe-based escrow with 5% platform fee, abuse handling, reputation ratings. Migrate backend from Express/Mongo to Supabase (Postgres + PostGIS, Auth, Realtime, Storage). Remove the old backend after cut-over.

## Brutal Truth
- You don’t have a real payment system. Backend uses a mock Stripe client and pretends to charge and refund (backend/routes/payment/payment.routes.ts:9–33). There’s no Connect accounts, no webhooks, no escrow, and the 5% fee isn’t actually collected.
- Messaging is a placeholder both server and client. No rooms, no realtime (backend/controllers/chatController.ts:41–49, 54–67). Frontend chat page is a stub (frontend/app/chat/page.tsx:1–10).
- Auth on the frontend is tied to the old backend via axios and proxy routes, not Supabase (frontend/contexts/auth-context.tsx:3–8, 124–138; frontend/app/api/proxy/[...path]/route.ts:26–56). This will fight with Supabase RLS until replaced.
- Geosearch exists only in scaffolding. Frontend map is client-side-only and not wired to real data (frontend/components/features/map/map-component.tsx:52–60, 136–146). Old backend uses Mongo 2dsphere (backend/models/Listing.ts:171), not PostGIS.
- Ratings exist server-side, but they’re tied to Mongo models and not aggregated to user reputation or surfaced in the UI (backend/routes/reviews/reviews.routes.ts:135–248, 395–468). 
- You’re carrying redundant map stacks (Mapbox + Google Maps). Pick one. Mapbox is already in code and better for clustering + vector tiles.
- Dependency posture is fair on the frontend. React is 18 but @types/react is 19.x, which can create type noise. The backend is sunk-cost; only keep it alive long enough to ETL data.

# Current State Summary
- Frontend: Next.js 15 App Router, TanStack Query, Tailwind, Mapbox. Supabase client exists but unused (frontend/lib/supabase/client.ts:1–6). Heavy axios proxy to old backend.
- Backend: Express/Mongoose, JWT, mock Stripe, Swagger, tests. Mongo geospatial index on listings.
- Docs: You already have ARCHITECTURE.md/TODO.md in frontend, but they are high-level and not enforced.

# Target Architecture
- Frontend: Next.js 15; data via Supabase JS client and server Route Handlers/Server Actions for secure operations (Stripe webhooks, privileged calls). TanStack Query for caching, RLS-aware queries. Mapbox for geosearch visualization.
- Backend: Supabase services only. 
  - Postgres + PostGIS for geospatial. 
  - Auth users in `auth.users` with profiles in `public.profiles`.
  - Realtime on `messages` and notifications.
  - Storage buckets for images.
  - Stripe Connect handled via Next.js server routes and webhooks; DB keeps authoritative payment/transfer state.

## Core Data Model (Supabase)
- `profiles(id uuid pk, user_id uuid FK auth.users, display_name text, avatar_url text, reputation numeric default 0, rating_count int default 0, created_at timestamptz)`
- `listings(id uuid pk, seller_id uuid FK profiles, title text, description text, price numeric(12,2), main_category text check in ('Items','Services'), sub_category text check in ('Buy','Sell','Free','I want','I will','I can'), status text check in ('active','sold','suspended') default 'active', location geography(Point,4326), address jsonb, created_at timestamptz)`
- `listing_images(id uuid pk, listing_id uuid FK, url text, main boolean default false)`
- `listing_tags(listing_id uuid, tag text)`
- `chats(id uuid pk, title text, type text check in ('direct','group'), created_at timestamptz)`
- `chat_participants(chat_id uuid FK, user_id uuid FK profiles, last_read_at timestamptz, primary key(chat_id,user_id))`
- `messages(id uuid pk, chat_id uuid FK, sender_id uuid FK profiles, content text, attachments jsonb, reply_to uuid null, created_at timestamptz)`
- `payments(id uuid pk, listing_id uuid FK, buyer_id uuid FK profiles, seller_id uuid FK profiles, amount numeric(12,2), platform_fee numeric(12,2), stripe_payment_intent text, status text check in ('requires_capture','completed','refunded','failed'), created_at timestamptz)`
- `transactions(id uuid pk, payment_id uuid FK, type text check in ('charge','transfer','refund'), amount numeric(12,2), status text, created_at timestamptz)`
- `disputes(id uuid pk, payment_id uuid FK, reason text, status text check in ('open','resolved','refunded','rejected'), created_at timestamptz)`
- `reviews(id uuid pk, listing_id uuid FK, seller_id uuid FK profiles, reviewer_id uuid FK profiles, rating int check 1..5, comment text, votes jsonb default '{}', created_at timestamptz)`
- `notifications(id uuid pk, user_id uuid FK profiles, type text, payload jsonb, read boolean default false, created_at timestamptz)`

## Geospatial
- PostGIS extension enabled.
- GIST index on `listings.location`.
- Nearby query: `select *, ST_Distance(location, ST_SetSRID(ST_MakePoint($lon,$lat),4326)) as dist from listings where ST_DWithin(location, ST_SetSRID(ST_MakePoint($lon,$lat),4326), $radius_m) order by dist limit $n`.

## Auth & RLS (Supabase)
- RLS enabled on all public tables.
- Policies:
  - profiles: users can select all minimal fields; insert/update only self using `auth.uid()`.
  - listings: select all active; insert/update/delete only where `seller_id = auth.uid()`.
  - messages/chats: select/insert only if user is participant via subquery.
  - payments/transactions/disputes: select own; inserts only performed by server via service role.
  - notifications: select `user_id = auth.uid()`; updates read flag allowed for owner.
- Storage buckets: `listing-images` and `avatars` with authenticated insert + owner-only select policies as per Supabase Storage policy examples.

## Payments & Escrow (Stripe Connect)
- Marketplace: require Stripe Connect accounts for sellers. Use destination charges with `application_fee_amount = round(amount * 0.05)`.
- Escrow semantics: either manual capture or capture to platform → delayed `transfer` to seller upon confirmation. Disputes freeze transfer; refunds create negative transfers. Webhooks drive state transitions.
- Compliance: KYC/KYB flows for sellers; tax reporting; PCI handled by Stripe elements. You must not proxy card details through your server.
- Webhooks: `payment_intent.succeeded/failed`, `charge.succeeded`, `charge.refunded`, `transfer.created/failed`, `customer.dispute.created/closed` → update `payments`/`transactions`/`disputes` tables.

## Messaging
- Use `supabase-js` Realtime channels on `messages`. Frontend subscribes by `chat_id`, server sets RLS allowing only participants. Write via supabase client for standard messages; server action for attachments if needed.

## Moderation & Abuse
- Disputes table and admin UI. 
- Automated flags: rate-limit message sends, ML-assisted tag filters optional (your NLP libs can be removed initially; reintroduce later behind server functions). 
- User suspension: set `profiles.status = 'suspended'` and RLS denies listing/message writes.

# Migration Strategy (Mongo → Supabase)
1. Define SQL migrations: tables, constraints, indexes, RLS, PostGIS.
2. Stand up Supabase project; set envs in frontend (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
3. Write ETL scripts (Node or SQL) to export Mongo collections (`users`, `listings`, `images`, `reviews`, `messages`) and import into Supabase. Map `ObjectId`→`uuid`, normalize addresses to jsonb, compute `geography(Point,4326)` from Mongo coords.
4. Validate geosearch queries against seeded data.
5. Implement Stripe Connect onboarding and webhook handlers in Next route handlers; store records in `payments/transactions`.
6. Cut-over feature-by-feature: Auth → Listings → Search → Messaging → Payments → Reviews → Notifications.
7. Decommission Express backend: remove axios proxy; delete backend code after verification and data audit.

# Frontend Refactor Plan
- Replace axios/proxy with Supabase data layer:
  - Auth: use `supabase.auth` for login/register/profile; remove TokenService and CSRF flows (frontend/lib/api/axios.ts:40–69, 71–90).
  - ProfileContext/AuthContext: switch to `supabase.auth.onAuthStateChange` and select from `profiles`; remove `/api/proxy` calls (frontend/contexts/auth-context.tsx:88–166, 169–293).
  - Listings: CRUD via Supabase tables; image uploads via Storage.
  - Search pages: wire filters to PostGIS queries; use TanStack Query with query keys for location/radius/category.
  - Messaging UI: build chat list/thread/composer; subscribe to `messages` channel.
  - Payments UI: Stripe Elements, intents created via Next server route; display escrow status; confirmation flow to release funds.
  - Ratings: write reviews via supabase; display aggregated reputation on user profile/listing cards.
- Map: standardize on Mapbox only; remove `@react-google-maps/api`.
- Routing: keep Next App Router; server routes for Stripe webhooks and privileged actions.

# Dependencies Update Plan
- Frontend:
  - Remove `@react-google-maps/api`.
  - Align `react` and `@types/react` (React 18 or upgrade to 19 end-to-end; prefer 18 until Supabase/Next combo verified).
  - Keep `next@15.2.x`, `@tanstack/react-query@5.x`, `tailwind@3.4.x`. 
  - Introduce `stripe` server SDK in frontend’s server routes (not in browser), and `@stripe/stripe-js` for Elements (already present).
- Backend:
  - Freeze; only use it to run ETL if needed. No version upgrades beyond what’s required to extract data reliably.

# SQL & Policies (deliverable snippets to implement after approval)
- Enable PostGIS: `create extension if not exists postgis;`
- Listings index: `create index listings_location_gix on listings using gist (location);`
- Examples for RLS policies (profiles/listings/messages) using `auth.uid()` and participant checks.

# Operational Concerns
- Secrets: use environment vars; never log keys.
- Webhooks: verify signatures; queue retries; idempotent handlers.
- Rate limiting: per-user/per-IP where writing actions exist.
- Observability: Supabase logs + Sentry on frontend/server routes.
- Backups: Supabase automated backups; daily export for listings/messages.

# Deliverables on Confirmation
- Update ARCHITECTURE.md with finalized schema, flows, and RLS specifics.
- Create TODO.md with phase-by-phase checklist tied to confirmations.
- Implement migrations (SQL) and initial ETL scripts.
- Refactor frontend contexts/services to Supabase.
- Implement Stripe Connect + webhooks with escrow semantics.
- Remove axios proxy and old backend after cut-over.

# Initial TODO.md (to be created after approval)
1. Supabase env + client wiring.
2. SQL migrations: tables, indexes, RLS, PostGIS.
3. ETL: users/listings/images/reviews/messages.
4. Auth refactor to Supabase; replace axios proxy.
5. Listings CRUD + Storage uploads.
6. Geosearch + Mapbox integration.
7. Messaging (Realtime) with chat UI.
8. Payments (Connect, 5% fee, escrow) + webhooks.
9. Ratings aggregation + profile reputation.
10. Moderation/disputes + admin screens.
11. Notifications.
12. Dependency cleanup and Map API consolidation.
13. Decommission Express backend.

# Next Step
Confirm this plan. On approval, I’ll ship the updated ARCHITECTURE.md, create TODO.md, implement Supabase migrations, and start the auth/data refactor immediately, with Stripe Connect integration following right after.