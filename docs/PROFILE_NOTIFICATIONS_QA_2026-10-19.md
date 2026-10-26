# Profile and notifications verification — 2026-10-19

## Released

- Vercel NEEDS production deployment: `dpl_BnAsfbzKaRymu1E1pCoHfcZjmXKc`.
- Built successfully (webpack + TypeScript), promoted to `https://getneeds.app`.
- Supabase migration: `20261019164527_listing_history_and_notifications.sql`; local version matches hosted migration history.

## Implemented

- Responsive account profile, compact statistics, working dashboard/listings/reviews/settings sections, direct avatar/cover controls and public-profile link.
- Editable name, email, title, location and bio. Optional fields can be cleared. Email changes use Auth confirmation.
- Raster uploads (JPG/PNG/WebP/GIF, UI limit 5 MB), preview, awaited persistence, inline failures and safe retry. Saved Supabase photos allowed by the Next image configuration.
- Asynchronous updates bound to the initiating account across lookup, upload and form completion.
- Notifications with localized event descriptions, loading/error/retry, stable pagination, verified read updates and synchronized unread counts. Realtime with polling/focus fallback.
- Listing creation invalidates that user's profile overview, including partial image failure outcomes.
- Historical listing deletion protected by trigger plus RESTRICT foreign keys; unused listings remain deletable.

## Verification

- Focused profile/context/service/forms/config suites passed; header integration updated for expected-user binding (3/3).
- Combined focused run: 83 cases, initially 2 assertions needed the new identity parameter; both passed on targeted rerun. Additional navbar/notification-format suite: 7/7.
- Database migration regression suite: 3/3; agent's full database suite: 16/16.
- TypeScript passed; modified source lint had no errors. Existing warnings in legacy ad/context tests remain.
- Browser: 1280 desktop, 390 and 320 mobile; no page horizontal overflow after compact navigation fix; light/dark review.
- Disposable fixture: avatar and cover uploaded through the actual browser forms; name/location/bio edited and optional title cleared. Reload retained all values and both images loaded.
- Hosted Realtime: intended recipient received INSERT, other account received no event and could not read it.
- Browser notification changed from unread to read; database confirmed `read=true`.
- Hosted post-deploy profile and upload modal checked read-only with the existing account.
- Cleanup verified: both temporary Auth users/profiles, notification, all four fixture storage objects and private credentials/links removed. No real account fields changed by these tests.

A local build retry hit a Windows `.next` EPERM while development preview was active. The final hosted production build passed all compilation, TypeScript and prerender steps. Development-only CSS HMR noise was not reproduced as a production error.

## Remaining product limits

- Notification producers cover payment/dispute/transfer events and, after the Inbox release below, new chat messages. Review notifications remain a separate follow-up.
- Payments and milestones are still disabled by the existing configuration; Stripe Connect readiness is separate.
- Listing management lacks direct View/Edit entry points; some legacy query errors still appear as empty data on other dashboard pages.
- The public profile route retains its existing separate design.
- Replaced/abandoned photo objects are not automatically garbage-collected. Storage bucket limits remain unchanged; the new 5 MB/raster validation is in the UI.

## Inbox follow-up released

- Production deployment `dpl_FqdLYw7xuxc9bZYPFyAE8kRcubwv` promoted to `https://getneeds.app`; hosted webpack/TypeScript build passed.
- Applied migration `20261019172004_chat_inbox_notifications.sql`, matching hosted migration history.
- Inbox now shows members, last messages, recent ordering and unread counts. Exact conversation links, explicit loading/retry states, paged history, retained drafts on failed sends and idempotent retries are implemented.
- Leave/Return updates membership without deleting history or transaction records. Sending stops while a member is absent; returning does not rejoin the other member.
- New messages atomically create recipient-only in-app notifications. Reading a visible conversation advances an exact message watermark and synchronizes notification counts. Realtime includes foreground polling/focus fallback.
- 88 focused component/service tests passed; the final corrected UI suite passed 12/12 again and full TypeScript passed. All 24 database integration tests passed. Scoped changed-source lint passed.
- Hosted disposable-account tests verified concurrent sends, retry deduplication, exact read cutoff, expected-account guards, recipient/outsider Realtime isolation, leave/rejoin and notification payload privacy.
- Browser verified message send, notification deep link, unread badge arrival without manual refresh, read synchronization, leave/return, 320/390 mobile and 1280 desktop layouts, light/dark themes. Production message survived reload and production console had no errors/warnings during the check.
- Cleanup verified all three temporary users/profiles absent, one fixture conversation with its nine messages and nine notifications removed, and the private credential ledger deleted. No real account details or conversations were changed by QA.
