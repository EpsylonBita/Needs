# Dependency update — 27 October 2026

Updated 19 direct packages to the current compatible stable releases and aligned the Node type definitions with the Node 24 runtime. The npm lockfile was regenerated and verified with a clean npm ci. No force or legacy-peer-deps flags were used.

## Versions

| Package | Before | After |
| --- | --- | --- |
| @hookform/resolvers | 5.9.1 | 6.0.1 |
| @stripe/react-stripe-js | 7.0.0 | 7.0.1 |
| @stripe/stripe-js | 10.1.0 | 10.2.0 |
| @supabase/supabase-js | 2.117.3 | 2.118.0 |
| @tanstack/react-query | 5.104.2 | 5.105.0 |
| framer-motion | 14.2.0 | 14.7.1 |
| lucide-react | 1.57.0 | 1.62.0 |
| natural | 8.1.1 | 8.2.6 |
| react | 19.3.0 | 19.3.1 |
| react-dom | 19.3.0 | 19.3.1 |
| react-hook-form | 7.90.0 | 7.91.0 |
| stripe | 23.0.0 | 23.0.1 |
| @electric-sql/pglite | 0.5.9 | 0.5.12 |
| @stripe/cli | 1.53.1 | 1.55.2 |
| @types/node | 26.6.5 | 24.19.2 |
| @vitest/ui | 5.0.4 | 5.0.5 |
| jsdom | 30.1.2 | 30.1.3 |
| postcss | 8.5.30 | 8.5.32 |
| vite | 8.3.4 | 8.3.5 |
| vitest | 5.0.4 | 5.0.5 |

Next.js 16.4.3, Tailwind CSS 4.3.3, Mapbox GL 3.33.0, Node 24.21.0 and npm 11.19.0 remain unchanged.

## Security and cleanup

- Updated development-only undici 8.12.1 to 8.12.3 within jsdom's supported dependency range. Vitest and its UI are both 5.0.5. These changes resolve every advisory reported by the initial frontend audit.
- The final full npm audit returns zero known vulnerabilities, including development dependencies. npm ls --all exits successfully with no invalid or missing peer dependencies.
- CI now runs npm audit --audit-level=moderate across both application and development dependencies.
- Removed the unused root package.json and pnpm-lock.yaml containing Express, the deprecated @types/joi stub and Joi. There was no root installation, source import, workspace configuration or valid Storybook command using them. The application remains installed exclusively from frontend/package-lock.json.
- The Stripe CLI install-script allowlist follows its new pinned version; no new lifecycle scripts were enabled.
- No database migration, remote database update or deployment is part of this update. Git publication is handled separately after verification.

## Compatibility holds

| Package | Kept | Latest | Reason |
| --- | --- | --- | --- |
| TypeScript | 6.0.3 | 7.0.2 | Next supports the new compiler CLI, but the latest stable typescript-eslint/parser 8.72.1 still requires TypeScript >=4.8.4 <6.1.0. Keep the existing single-compiler setup until the lint toolchain supports 7. |
| ESLint | 9.39.5 | 10.13.0 | The latest stable React, import and accessibility plugins used by eslint-config-next still declare support only through ESLint 9. |
| @types/node | 24.19.2 | 26.6.5 | Deliberately use the latest Node 24 definitions to match the runtime and CI. |

ESLint 9 is outside upstream support and emits a deprecation warning. This remains maintenance debt; a clean vulnerability audit does not mean that unsupported tooling will receive future security fixes. No incompatible peers were forced and no lint rules were disabled to mask this limitation.

Sources: [typescript-eslint support](https://typescript-eslint.io/users/dependency-versions/), [ESLint support policy](https://eslint.org/version-support/), [React plugin peers](https://registry.npmjs.org/eslint-plugin-react/latest), [import plugin peers](https://registry.npmjs.org/eslint-plugin-import/latest), [accessibility plugin peers](https://registry.npmjs.org/eslint-plugin-jsx-a11y/latest), [Undici advisory](https://github.com/advisories/GHSA-xjj6-f33q-929c), [Vitest advisory](https://github.com/advisories/GHSA-p458-7748-mcp3).

## Reduced-motion regression discovered during verification

The expanded browser run passed 35 of 36 cases but exposed an intermittent pending price-marker transition at a 320px mobile viewport with reduced motion enabled. The global accessibility rule reduces transition duration to .01ms; the marker still inherited the initial transition-property: all when its motion-safe utilities were inactive. A price edit could therefore create a very short CSS transition.

Added motion-reduce:transition-none only to the marker. A permanent Playwright regression checks the rendered transition property and absence of animations after a price edit. It first failed against the old production build with expected none / received all, proving the cause independently of frame timing. The homepage and global motion rules were not changed.

## Verification

- Clean npm ci: passed; zero known vulnerabilities.
- Full npm audit and npm ls --all: passed.
- TypeScript: passed.
- ESLint: zero errors; 326 pre-existing warnings, unchanged from the before-upgrade baseline.
- Complete Vitest suite: 154 files, 1,779 tests passed.
- After the scoped marker fix: all 30 price-guidance component tests passed again; full lint still has zero errors and the same 326 baseline warnings.
- Isolated PGlite database checks: 17 files, 130 tests passed.
- Offline executable-script checks: 3 files, 25 tests passed.
- Production webpack build, including the TypeScript check: passed.
- Final production browser verification: all 38 cases passed with retries disabled. This includes 16 tracked desktop/mobile journeys, six compact-gauge cases (light/dark/mobile and reduced motion), and 16 buyer-comparison cases (recorded retailer responses and a nine-store fixture).
- Development app restarted on port 3002; home, search and login returned HTTP 200.

The first browser invocation could not find Chromium in the default user cache. The successful runs use the existing project cache through PLAYWRIGHT_BROWSERS_PATH. The subsequent 35/36 run exposed the marker issue described above; the final 38/38 result follows the source fix and a fresh production build. All initial failure logs are retained.

Logs and machine-readable reports are stored outside the repository at C:/Users/epsyl/.codex/visualizations/2026/10/27/01a17df0-0b8f-7290-8be5-89aee7bd78c4/dependency-audit. Browser checks use dummy Supabase/Stripe settings and intercepted responses; they do not create live listings, send email or execute payments.
