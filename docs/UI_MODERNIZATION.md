# Needs UI modernization — 14 October 2026

## User decisions

The user authorized a visual modernization, then specifically asked to retain the full Athens photograph with animated illustrative listing cards appearing around the city. That later decision takes precedence over the initial split-layout concept. The original `athens.jpg` remains the hero asset.

## Implemented experience

- Full photograph hero with animated location cards and rotating phrases. Cards are explicitly labelled as illustrative, never inserted into search results or treated as actual orders. A pause control and reduced-motion support are included; timers stop updating hidden tabs and clean up on unmount.
- Real search form with encoded, trimmed URL queries; category links and an authenticated new-listing flow. The desktop and mobile actions both continue to creation after a successful sign-in, while confirmation-required signup does not pretend the user is authenticated.
- Compact navigation, accessible mobile sheet, keyboard-operable account menu, Greek and English copy, Greek-capable self-hosted Noto Sans, shared color and control sizing, skip link and visible focus treatment.
- Real neighborhood listing summaries and Mapbox map. The map requests location only after a deliberate click, keeps zoom controls available, respects reduced motion, and provides keyboard-operable listing markers. An empty database produces an honest empty state.
- Search results with real stored listing images, image-failure fallback, useful empty/error/reset states, localized filters and compact expandable filters on mobile.
- A single accessible auth dialog, labelled fields, busy states, password/recovery feedback and correctly scoped registration. Contact preserves draft/idempotency behavior and no longer displays fictional office, phone or support-address details.
- One Radix toast renderer and a QueryClient created per provider instance, avoiding duplicate notifications and shared server request caches.

## Boundaries

Payment, email and database behavior from the previous repair is retained. Stripe Connect enrollment, a sender domain and a Resend account remain deferred by the user; the UI upgrade does not activate those services or send real email. No fabricated accounts, listings or orders were added to Supabase.

Dependencies, compatibility exceptions and the open development-only audit advisory are documented in `DEPENDENCY_UPGRADE.md`. Verification results are recorded after the integrated build and browser checks.

## Verification

- Integrated checks: 377/377 Vitest cases across 81 files, 11/11 database fixtures, TypeScript and production build passed. ESLint reports zero errors and 354 remaining warnings. See the dependency report for commands and logs.
- Real browser checks at desktop 1440×1000 and mobile 390×844: hero search navigates with its Greek query; category selection and reset update the URL; mobile menu opens one sign-in dialog and signup scrolls within the viewport; dark/light themes, language switching, map controls and contact form rendering work without horizontal overflow.
- Production serves HTTP 200 on `http://127.0.0.1:3002/`. The local payment launcher successfully started Stripe test forwarding on the pinned API `2026-09-30.endive`. Email delivery remains unconfigured and queued. No real transactions or messages were sent.
- A development-only React script warning appeared during a root-layout hot replacement. A clean production reload produced no new browser warnings/errors; the earlier log entry remains in the browser history.
- Direct visual comparison checked the white navigation, cobalt controls, Greek typography, rounded surfaces, pale discovery band, real map/empty state and compact footer against the concept. The full photograph and location popups intentionally follow the user's later hero correction. At mobile width the hero reserves space below its controls for one animated card, and the discovery/map columns stack.
- Final screenshots are outside source control: `D:\Projects\Active\needs-runtime-backups\ui-modern-desktop-20261014.png` and `ui-modern-mobile-20261014.png`.
