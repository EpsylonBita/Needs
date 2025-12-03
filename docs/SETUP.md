# Project Setup Guide

This guide covers how to set up the NEEDS project locally for development.

## Prerequisites

- **Node.js**: v18 or higher
- **Package Manager**: pnpm (recommended) or npm
- **Database**: Supabase (local or cloud)

## Repository Structure

- `frontend/`: Next.js application
- `supabase/`: Supabase configuration and migrations (inside frontend folder currently)
- `docs/`: Project documentation

## Quick Start

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd needs-root
    ```

2.  **Install dependencies:**
    ```bash
    cd frontend
    pnpm install
    ```

3.  **Environment Configuration:**
    Copy the example environment file in `frontend/`:
    ```bash
    cp .env.example .env.local
    ```
    Update `.env.local` with your credentials:
    - `NEXT_PUBLIC_SUPABASE_URL`: Your Supabase project URL
    - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Your Supabase anon key
    - `NEXT_PUBLIC_MAPBOX_TOKEN`: Mapbox public token
    - `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`: Google Maps API key (if used)

4.  **Run the development server:**
    ```bash
    pnpm dev
    ```
    The app should be running at `http://localhost:3000`.

## Database Setup (Supabase)

The project uses Supabase for the backend.

1.  **Local Development (Optional but recommended):**
    - Install Supabase CLI.
    - Run `supabase start` in the `frontend` directory (where `supabase/` config lives).
    - Link your local project if needed.

2.  **Migrations:**
    - Database schemas are managed via SQL files in `frontend/supabase/sql` or migrations.
    - Ensure your local or remote instance has the latest schema applied.

## Scripts

In `frontend/` directory:
- `pnpm dev`: Start dev server
- `pnpm build`: Build for production
- `pnpm start`: Start production server
- `pnpm lint`: Run linter
- `pnpm test`: Run tests
- `pnpm typecheck`: Run TypeScript check

## Troubleshooting

- **Missing Environment Variables**: Ensure all required keys in `.env.local` are set.
- **Dependency Issues**: Try deleting `node_modules` and `pnpm-lock.yaml` and reinstalling.
