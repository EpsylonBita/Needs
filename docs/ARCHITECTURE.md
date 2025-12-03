# System Architecture

## Overview

The NEEDS platform is a marketplace application built with a modern web stack.

- **Frontend**: Next.js 15 (App Router), React, Tailwind CSS, Shadcn UI.
- **Backend**: Supabase (PostgreSQL, Auth, Realtime, Storage).
- **Payments**: Stripe Connect (Destination Charges).
- **Maps**: Mapbox GL.

## Data Model (Supabase)

The core data models are defined in PostgreSQL.

### Key Tables

- **`profiles`**: User profiles (extends `auth.users`).
- **`listings`**: Items or services for sale/request. Includes geospatial data (`location`).
- **`listing_images`**: Images associated with listings.
- **`chats` & `messages`**: Real-time messaging system.
- **`payments`**: Payment records, linked to Stripe Payment Intents.
- **`transactions`**: Financial transactions (charges, transfers, refunds).
- **`reviews`**: User ratings and reviews.

### Security (RLS)

Row Level Security (RLS) is enforced on all public tables.
- **Public Read**: Generally allowed for listings and profiles.
- **Private Write**: Users can only edit their own data.
- **Service Role**: Used by server-side route handlers for privileged actions (e.g., payment updates).

## Frontend Architecture

### Tech Stack
- **Framework**: Next.js 15
- **State Management**: TanStack Query (Server state), React Context (Auth, Theme), URL state (`nuqs`).
- **Styling**: Tailwind CSS, Shadcn UI.

### Directory Structure (`frontend/`)
- `app/`: Routes and pages.
- `components/`: Reusable UI and feature components.
- `lib/`: Utilities, API clients, Zod schemas.
- `hooks/`: Custom React hooks.

## Payments & Escrow Flow

1.  **Negotiation**: Users chat and agree on terms.
2.  **Intent**: Buyer initiates "Get" action -> creates Stripe Payment Intent.
3.  **Hold**: Funds are authorized (manual capture).
4.  **Confirmation**: Both Buyer and Seller must confirm completion.
5.  **Capture**: Funds are captured and transferred to Seller (minus platform fee).

## Deployment

- **Frontend**: Vercel (recommended) or any Node.js/Docker host.
- **Backend**: Supabase Cloud.
