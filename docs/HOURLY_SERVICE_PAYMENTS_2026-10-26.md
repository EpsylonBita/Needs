# Agreed totals for hourly services

The user requested that participants agree a total in their listing conversation before paying for a service advertised at an hourly rate. This extends the existing Stripe checkout and keeps the public listing rate unchanged.

## Contract

- Either active participant in a direct service conversation can propose a EUR total (0.50–999,999.99, at most two decimal places). Only the other participant can accept or reject that exact proposal.
- A new proposal supersedes the current one using its expected identifier; stale tabs must refresh. Before checkout, a proposal can be withdrawn. An accepted agreement requires fresh acceptance after any change.
- The accepted total belongs to one listing, conversation, payer and provider. Request listings retain the existing reversed requester/provider roles. Listing terms are snapshotted; changed terms require a new agreement before payment.
- Checkout uses the accepted database amount, never the hourly listing amount or a client-supplied total. The payer alone can start it. The existing 5% platform fee, manual capture, completion confirmations and dispute flow remain in force.
- While a payment can still be completed, the agreement and its listing terms are locked. Retrying resumes the same Stripe intent. A replacement attempt requires Stripe-confirmed cancellation recorded through a server-only RPC; a generic failed status is not sufficient. Explicit status refresh reconciles a canceled intent and permits renegotiation. Completed payments cannot be paid again.
- The Stripe client secret is returned only after atomic database persistence. If acceptance is withdrawn or replaced while Stripe creates an unconfirmed intent, persistence fails and the unpersisted intent is canceled.
- Rate milestones remain unavailable; this feature pays one agreed total and does not implement time tracking, automatic hours multiplication or installment billing.

## Implementation and verification plan

Use an RLS-enabled agreement table with service-only RPC access, immutable proposal history, atomic row locking, and an agreement link on canonical payment rows. Keep direct browser writes disabled. The chat panel shows proposal/acceptance/checkout state, refreshes after actions and while visible, and checkout displays the server-confirmed total.

Verify actor boundaries, stale proposals, changed listing terms, amount limits, self-acceptance rejection, payment locking, duplicate requests, canceled versus failed intent retries, and compatibility with existing fixed-price payments. Use isolated PostgreSQL integration tests, API/component regressions and desktop/mobile browser journeys with mocked Stripe; do not charge real users during QA.

## Verification and rollout

Implemented the agreement API, role-checked context, chat controls and checkout integration. Explicit refresh can reconcile a canceled Stripe attempt without creating or canceling an external payment. Checkout resets on account changes and rechecks the signed-in user before confirmation. Agreement history is retained when an advertisement is removed; the existing pause-instead message handles retained proposals.

- Full Vitest: **126 files / 1,137 tests passed**, exit 0.
- Database integration: **50 existing tests passed** in the full database run, followed by **24/24 agreement tests passed** against the final two-migration fixture. The tests apply real schema, existing confirmation guards and the new RPCs in isolated PGlite. They cover state transitions and constraints; PGlite is not evidence of real multi-connection concurrency.
- Production browser suite: **10/10 passed**, desktop Chromium and Pixel 7 viewport. Two independent browser sessions perform provider proposal → buyer acceptance → checkout for EUR75, including comma decimals, no self-accept control, no payment link before consent, stale-response draft preservation and the exact agreement identifier sent to checkout. Supabase and Stripe are isolated fixtures; no real card confirmation occurred.
- Production Webpack build, TypeScript validation and prerendering passed. Full ESLint: **0 errors / 312 existing warnings**. `git diff --check` passed.
- Independent review found no remaining blocker in the implemented agreement/payment path.

Both migrations were applied to connected NEEDS (`qczrqxmewjsydrrvjdil`) on 26 October 2026 under the user's standing instruction to apply required migrations:

| Local file | Applied remote version |
| --- | --- |
| `20261026213133_service_price_agreements.sql` | `20261026214459` |
| `20261026214557_service_agreement_api_access.sql` | `20261026214956` |

The MCP assigns remote application timestamps. Do not replay these migrations in this project merely because those versions differ from local filenames. Other environments must apply both before deploying the agreement API.

Live verification confirmed RLS enabled, no direct anonymous/authenticated table reads or writes, service-role reads, and service-only execution of all four mutation/payment RPCs. A rollback-only database probe verified rejection of self-acceptance, mutually accepted EUR75 with EUR3.75 fee, same-intent idempotency and rejection of a second unretired intent. It left zero agreements and payments; the existing eight listings remained. No Stripe API mutation was involved in that live database probe.

The follow-up migration removes an unnecessary authenticated table-read grant, so GraphQL does not expose the table. Final security advisor categories and counts match the pre-change baseline; existing unrelated notices remain. Detailed logs and browser screenshots are in the task's local visualization directory. A real Stripe Connect/card authorization journey remains unverified; the feature preserves the project's existing payment enablement, provider onboarding, authorization, capture and dispute requirements. The frontend has not been deployed to a hosted environment by this work.

References checked: [Supabase function permissions](https://supabase.com/docs/guides/database/functions), [Supabase API access controls](https://supabase.com/docs/guides/api/securing-your-api), [Stripe idempotency](https://docs.stripe.com/api/idempotent_requests).
