# Needs Platform Structure

## Project Overview
Supabase-first architecture with Next.js frontend. Data models and constraints live in SQL, consumed via shared types and Zod.

## Supabase
- SQL: `frontend/supabase/sql`
- Migrations: `frontend/supabase/migrations`
- Policies: `frontend/supabase/sql/002_indexes_policies.sql`
- Payments confirmations: `frontend/supabase/sql/004_payment_confirmations.sql`

## Frontend Structure

```
frontend/
├── app/
├── components/
│   ├── features/
│   ├── layout/
│   └── ui/
├── contexts/
├── hooks/
├── lib/
│   ├── api/
│   ├── supabase/
│   │   ├── client.ts
│   │   ├── server.ts
│   │   └── typed.ts
│   ├── utils/
│   └── validations/
│       ├── api-schema.ts
│       ├── common-schema.ts
│       └── db-schema.ts
├── locales/
├── public/
├── scripts/
├── supabase/
│   ├── migrations/
│   └── sql/
├── tests/
├── ARCHITECTURE.md
├── README.md
└── types/
    ├── db.ts
    └── index.ts
```

## Validation & Types
- Types: `frontend/types/db.ts`
- Zod: `frontend/lib/validations/db-schema.ts`
- API schemas: `frontend/lib/validations/api-schema.ts`

## Development
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- Tests: `npm run test`

## Architecture Reference
See `frontend/ARCHITECTURE.md` for tables, geospatial indexes, RLS, and payments flow.
