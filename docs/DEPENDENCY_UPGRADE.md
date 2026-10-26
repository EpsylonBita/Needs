# Dependency upgrade — 14 October 2026

The frontend uses npm and the checked-in `package-lock.json`. Direct dependency versions are pinned to the stable npm registry `latest` tags checked on this date, with the two peer-compatibility exceptions below. The obsolete pnpm lockfile was removed so the package managers cannot resolve different applications.

## Runtime and main versions

Use Node **24.21.0 LTS** and npm **11.19.0**, recorded in `frontend/.nvmrc` and `frontend/package.json`. CI reads the same Node version. On this Windows machine a checksum-verified, official portable runtime is available at `D:\Projects\Active\needs-runtime-backups\runtimes\node-v24.21.0-win-x64\node.exe`; the system Node installation and global PATH were not changed.

| Package | Version |
| --- | --- |
| Next.js / Next ESLint config / bundle analyzer | 16.4.0 |
| React / React DOM | 19.3.0 |
| Tailwind CSS / PostCSS adapter | 4.3.3 |
| Vitest / Vitest UI | 5.0.4 |
| Vite | 8.3.4 |
| jsdom | 30.1.2 |
| Zod | 4.6.7 |
| Stripe server SDK | 23.0.0 |
| Stripe React / browser SDK | 7.0.0 / 10.1.0 |

## Compatibility exceptions

`npm outdated --json` reports only these two direct packages. Neither `--force` nor `--legacy-peer-deps` was used.

| Package | Installed | Registry latest | Reason |
| --- | --- | --- | --- |
| TypeScript | 6.0.3 | 7.0.2 | `typescript-eslint@8.71.2`, required by Next's ESLint configuration, declares TypeScript `>=4.8.4 <6.1.0`. |
| ESLint | 9.39.5 | 10.12.0 | Next's current `eslint-plugin-react@7.37.5` and `eslint-plugin-import@2.32.0` support ESLint 9 but do not declare ESLint 10 support. ESLint 9 is now out of upstream support; upgrading these plugins is required before moving to 10 without bypassing their peer contracts. |

These exceptions should be revisited when the plugins publish compatible stable releases. Registry evidence is saved outside the repository at `needs-runtime-backups/dependency-latest-20261014.json`.

## Tooling and source changes

- Next 16 uses Turbopack. The existing worker alias moved to `turbopack.resolveAlias`, and `middleware.ts` became `proxy.ts`, preserving nonce, CSP and CSRF behavior. `npm run lint` invokes ESLint directly because Next no longer provides `next lint`.
- Tailwind 4 uses `@tailwindcss/postcss`, a CSS import and explicit `@config` for the existing theme. The container utility retains its existing geometry. The UI redesign remains a separate source change.
- Vitest uses an ESM configuration, automatic JSX and bounded workers. Its new two-parameter assertion types are extended through `Matchers` in `tests/vitest.d.ts`; runtime assertions are unchanged.
- Zod record schemas now explicitly declare string keys, errors use `issues`, and the terms-acceptance error uses the current API. Calendar component slots and class names follow DayPicker 10.
- React Compiler is not enabled. Newly introduced compiler diagnostics for effect state updates, refs, JSX try/catch and immutability remain visible as warnings while existing code is migrated. `react-hooks/rules-of-hooks` remains an error and `exhaustive-deps` retains its previous warning severity. This does not assert that all warnings are harmless.
- Unused axios, axios-hooks, jwt-decode and ts-node were removed after checking source, scripts and CI. Mapbox now supplies its own types. Tailwind handles prefixing, so autoprefixer was removed. The deprecated Critters optimizer and its optional Next setting were removed.
- Only the reviewed install scripts for `@stripe/cli@1.53.1` and `unrs-resolver@1.12.2` are allowlisted. Their platform binaries are installed through package dependencies; both rebuild successfully.

## Audit result

`npm audit --omit=dev` reports **zero vulnerabilities**. The full audit reports five affected package entries from a single development-only chain: `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces@3.0.3`. [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) reports no patched release. The Next plugin uses this code for configured root-directory globs; this app does not provide an untrusted root glob. There is no compatible patched stable override, so no framework downgrade or custom dependency fork was applied. The advisory remains open.

## Verification

The completed application was checked with the portable Node 24.21.0 runtime after the final search location-permission change:

- Full Vitest suite: **377 tests passed across 81 files** (`vitest run --maxWorkers=2 --reporter=dot`).
- Database fixtures: **11 tests passed** (`node --test --test-concurrency=1 tests/database/*.integration.mjs`); these run against local test databases and do not modify the connected Supabase project.
- TypeScript: `tsc --noEmit --pretty false --incremental false` passed.
- ESLint: **0 errors, 354 warnings** across the frontend. The final layout and skip-link changes also passed a separate scoped lint check. Existing warnings remain visible and are not counted as fixed.
- Production build: `next build` passed with Turbopack, including TypeScript validation and **32/32 generated pages**. This build includes the final layout, skip-link and CSS changes. The local development server remained available because Next 16 separates `.next/dev` from production output.
- Dependency tree: `npm ls --depth=0` passed; `npm outdated` reports only the two documented compatibility exceptions.

Detailed logs are stored outside the repository in `D:\Projects\Active\needs-runtime-backups` (`upgrade-final-tests-20261014.log`, `upgrade-database-tests-20261014.log`, `upgrade-final-types-20261014.log`, `upgrade-final-eslint-20261014.json` and `upgrade-production-build-20261014.log`). The upgrade checks did not send external payments or emails.

## References

- [Next 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16)
- [Tailwind 4 upgrade guide](https://tailwindcss.com/docs/upgrade-guide)
- [Vitest 5 migration guide](https://vitest.dev/guide/migration/)
- [Zod 4 migration guide](https://zod.dev/v4/changelog)
- [DayPicker 10 migration guide](https://daypicker.dev/upgrading)

The full pre-upgrade source snapshot and prior dependency tree are preserved outside the repository under `D:\Projects\Active\needs-runtime-backups`.
