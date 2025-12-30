# Architecture

## System Overview
- Frontend: Next.js 15 App Router, TanStack Query, TailwindCSS, Mapbox.
- Backend: Supabase (Postgres + PostGIS, Auth, Realtime, Storage). Stripe Connect for payments/escrow.

## Schemas (Supabase)
- profiles(id uuid pk, user_id uuid FK auth.users, display_name text, avatar_url text, reputation numeric default 0, rating_count int default 0, created_at timestamptz)
- listings(id uuid pk, seller_id uuid FK profiles, title text, description text, price numeric(12,2), main_category text check in ('Items','Services'), sub_category text check in ('Buy','Sell','Free','I want','I will','I can'), status text check in ('active','sold','suspended') default 'active', location geography(Point,4326), address jsonb, created_at timestamptz)
- listing_images(id uuid pk, listing_id uuid FK, url text, main boolean default false)
- listing_tags(listing_id uuid, tag text)
- chats(id uuid pk, title text, type text check in ('direct','group'), created_at timestamptz)
- chat_participants(chat_id uuid FK, user_id uuid FK profiles, last_read_at timestamptz, primary key(chat_id,user_id))
- messages(id uuid pk, chat_id uuid FK, sender_id uuid FK profiles, content text, attachments jsonb, reply_to uuid null, created_at timestamptz)
- payments(id uuid pk, listing_id uuid FK, buyer_id uuid FK profiles, seller_id uuid FK profiles, amount numeric(12,2), platform_fee numeric(12,2), stripe_payment_intent text, status text check in ('requires_capture','completed','refunded','failed'), created_at timestamptz)
- transactions(id uuid pk, payment_id uuid FK, type text check in ('charge','transfer','refund'), amount numeric(12,2), status text, created_at timestamptz)
- disputes(id uuid pk, payment_id uuid FK, reason text, status text check in ('open','resolved','refunded','rejected'), created_at timestamptz)
- reviews(id uuid pk, listing_id uuid FK, seller_id uuid FK profiles, reviewer_id uuid FK profiles, rating int check 1..5, comment text, votes jsonb default '{}', created_at timestamptz)
- notifications(id uuid pk, user_id uuid FK profiles, type text, payload jsonb, read boolean default false, created_at timestamptz)

## Geospatial
- Enable PostGIS.
- GIST index on listings.location.
- Nearby query with ST_DWithin and ST_Distance for ordering.

## Auth & RLS
- Enable RLS on all public tables.
- Profiles: select all; insert/update only for current user via auth.uid().
- Listings: select active; insert/update/delete only where seller_id = auth.uid().
- Chats/Messages: select/insert allowed only for chat participants.
- Payments/Transactions/Disputes: read own; writes via service role in server route handlers.
- Storage buckets: listing-images and avatars with owner-scoped policies.

## Payments & Escrow
- Stripe Connect destination charges with `application_fee_amount = round(amount * 0.05)`.
- Use `capture_method = 'manual'` to hold funds until both parties confirm completion.
- Funds are authorized to the buyer's payment method; on capture, Stripe automatically transfers to the seller account and retains the 5% platform fee. The platform does not receive 100% of funds at any time.
- Mutual confirmation is enforced: buyer and seller must each set `*_confirmed = true` on the associated `payments` row before capture is permitted.
- Webhooks update `payments`/`transactions`/`disputes` state; disputes mark payment as `failed` and create a `disputes` row; refunds record a `transactions` row with type `refund`.

## Messaging
- Realtime subscriptions on messages by chat_id.
- Unread counts computed via last_read_at in chat_participants.
- Chat surface includes explicit actions: `Get` (proceed to purchase) and `Leave` (decline). `Get` creates a Payment Intent (requires seller onboarded to Stripe). `Leave` records intent and closes the negotiation.

## Frontend Data Layer
- Supabase client for direct reads/writes under RLS.
- Next server Route Handlers for Stripe/webhooks and privileged operations using service role.
- Map interactions use Mapbox GL: clicking a marker opens a modal card with listing title, description, price, seller rating, and actions to `Chat` or `View Profile`.

## Cut-over Plan
- Create SQL migrations and seed/ETL from Mongo.
- Replace axios/proxy with Supabase data layer.
- Feature-by-feature cut-over: Auth → Listings → Search → Messaging → Payments → Reviews → Notifications.
- Remove Express backend after verification.
 
### Must-Do Implementation Priorities
- Payments: add `buyer_confirmed`/`seller_confirmed` fields and RLS policies to allow each party to set their own confirmation; update capture route to check both flags.
- Map: implement marker click modal with listing details and actions to start chat or view seller profile.
- Chat: surface `Get`/`Leave` actions; wire `Get` to `/api/payments/create-intent` and `Leave` to a lightweight status update.
- Profiles: show sold/bought history, aggregate rating, and reputation on profile card.