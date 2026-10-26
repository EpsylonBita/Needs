# NEEDS frontend

Next.js 16 App Router / React 19 application. Use Node 24.21.x or newer within 24.x and npm 11.19.0; `package-lock.json` is authoritative.

```sh
npm ci
npm run dev                 # http://127.0.0.1:3002
npm run build  # production compilation
npm start
npx next typegen           # route declarations for a fresh checkout
npm run typecheck -- --incremental false
npm run lint
npm run test:ci             # all unit/component/API tests, bounded workers
npm run test:db             # isolated PGlite integration tests
npx playwright install chromium
npm run test:e2e            # isolated production browser journeys, desktop/mobile
npm audit --omit=dev
```

Browser fixtures and their dummy server configuration live only in `e2e/`, `playwright.config.ts` and `scripts/e2e-server.mjs`. They do not bypass production authentication. They exercise sign-in, optional photos, inferred details, address suggestions, publication and retry without contacting live Supabase or Stripe. Real database ownership/atomicity behavior is covered separately by `test:db`.

Use `.env.example` as the configuration inventory and keep actual credentials in ignored `.env.local`. The local Node/npm copies under the repository's ignored `.tools/` directory are optional; CI installs the pinned runtime. Place the intended Node directory first in PATH for child processes.

See [setup](../docs/SETUP.md), [architecture](../docs/ARCHITECTURE.md) and [current audit repairs](../docs/AUDIT_REPAIRS_2026-10-26.md). Do not replay historical SQL or publish to production without the documented migration review.
