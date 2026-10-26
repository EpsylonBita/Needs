# NEEDS

Marketplace built with Next.js App Router, React, Supabase Auth/Postgres/Storage and Stripe Connect.

## Local development

Use Node **24.21.x or newer 24.x** and **npm 11.19.0**. The supported lockfile is `frontend/package-lock.json`.

```sh
cd frontend
npm ci
# Copy .env.example to .env.local and fill the required values.
npm run dev
```

Open http://127.0.0.1:3002. Never commit `.env.local` or service keys.

## Checks

```sh
npx next typegen
npm run typecheck -- --incremental false
npm run lint
npm run test:ci
npm run test:db
npm run build
npx playwright install chromium
npm run test:e2e
npm audit --omit=dev
```

The browser suite starts an isolated production build at port 3102, uses fixture responses and fake credentials, and does not create live listings/accounts/payments. Database integration tests use isolated PGlite databases. CI runs these checks on pull requests and pushes; it does not deploy.

- [Setup and configuration](docs/SETUP.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Current audit repairs and rollout checklist](docs/AUDIT_REPAIRS_2026-10-26.md)
- [Contributing](docs/CONTRIBUTING.md)
- [Legal drafts and unresolved business details](docs/legal/README.md)

`frontend/` contains the application and tests, `supabase/migrations/` contains database migrations, and `docs/` contains operational records. Historical audits are dated records, not a current vulnerability inventory.
