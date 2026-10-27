# Payment authorization lifecycle

The requested outcome is a complete protected-payment lifecycle, including a real Stripe test-environment exercise. The existing manual-capture and two-party completion requirements remain binding. No deadline or worker may charge a customer automatically.

## Contract

- Retrieve and retain Stripe's actual authorization deadline; never infer a guaranteed holding period. Show the deadline, send deduplicated in-app warnings, and block new completion actions after expiry.
- Either participant may request cancellation before capture. The other participant accepts or rejects that exact request; its author may withdraw it. Acceptance reserves cancellation atomically against capture. An administrator may release an uncaptured authorization with a recorded reason.
- Release is reported only after Stripe confirms cancellation. Timeouts remain pending and retry safely. Captured payments use the existing refund workflow.
- Explicit refresh and a bounded authenticated reconciliation worker retrieve current provider state, recover missed notifications, reconcile refunds, and flag failures without inventing successful settlements.
- Preserve fixed-price payments, agreed service totals, milestone history, both-party confirmations, dispute restrictions and account-change protection.
- Use a dedicated Stripe sandbox where available. Keep production activation, final legal documents and live payment credentials separate from test execution. Do not modify another project's existing Stripe objects or settings.

## Verification plan

Database integration covers permissions, stale cancellation requests, capture/cancel exclusion, expiry, terminal states and notification deduplication. API tests cover verified identities, canonical Stripe amounts and provider-state binding, ambiguous responses, worker authentication and retries. UI tests cover localized deadlines, cancellation consent and account changes. The real Stripe test run must demonstrate actual provider authorization/webhook/capture/transfer/refund/cancel behavior, and clean up only fixtures created by its exact run.

## Running reconciliation

`npm run dev:payments` and `npm run start:payments` start the Stripe webhook forwarder, application and reconciliation worker together. The local launcher generates an ephemeral, server-only worker secret unless one is provided. Webhooks remain required; reconciliation supplements them.

For a hosted environment, configure the same random `PAYMENTS_WORKER_SECRET` (at least 32 characters) in the application and worker. Run `node scripts/payments-reconciliation-worker.mjs` with that secret and the HTTPS application origin in `NEXT_PUBLIC_APP_URL`. The worker drains successful batches, then polls every five minutes while idle. Run it as a supervised service and alert on non-success responses or unexpected process exit. An external scheduler may invoke the exact authenticated `POST /api/internal/payments/reconcile` endpoint; each request leases at most two rows, so scheduler frequency/concurrency must cover the queue volume. `--once` checks one batch and exits nonzero on failure.

Each provider request has a 12-second timeout and no hidden SDK retries. At most two orders are reconciled concurrently. Database leases prevent duplicate workers from selecting the same order, reject expired leases, and back off failed rows. Never deploy this endpoint with a public client secret or use a user-session token as the scheduler credential.

Unsettled payments are due every five minutes; settled payments are revisited every six hours for missed refund/dispute events. The worker may resume a previously accepted cancellation, but it never captures money automatically. More than 100 refund/dispute records on one payment require manual review rather than accepting an incomplete financial snapshot.

## Stripe account separation

The dedicated test sandbox is separate from the existing connector's account and the prior local account. Claim/login, sandbox Connect enablement and the two owner-approved liability/compliance acknowledgements are complete. Anonymous CLI sandbox keys were too restricted for Connect; the actual exercise used the sandbox's own existing test key and a synthetic connected provider. A successful sandbox creation alone does not verify payments.

A later launch account needs its own keys, matching webhook endpoint/signing secret, Connect configuration and connected providers. Test account IDs, connected accounts and PaymentIntents are not portable to another account. Do not switch the provider credentials while older unsettled payments still need reconciliation; settle them first or retain an explicit per-account routing path. No production deployment, live key activation or hosted scheduler configuration is implied by these code changes.

## Execution evidence

- Unit/component/API: 1,193 tests across 128 suites in the full run, plus the 13 existing script tests in their two Vitest suites after narrowing the Node-script exclusion. All 1,206 pass. The final order-feedback change was separately rechecked by 33 order tests.
- Node operational scripts: 15 tests pass (10 verification-runner checks, 5 scheduler checks).
- Database: 103 integration tests pass, including 29 new lifecycle cases independently rerun during review. These use PGlite with the migration SQL; they do not simulate real multi-connection PostgreSQL scheduling.
- Production browser suite: 14/14 pass across desktop and mobile. A stale pending notice found in screenshots was corrected, followed by a fresh production build and 4/4 lifecycle browser rerun. Final screenshots were visually reviewed.
- TypeScript passes. ESLint exits successfully with 0 errors and 312 existing warnings. `git diff --check` passes.
- NEEDS PostgreSQL: applied `escrow_authorization_lifecycle` successfully. Local file version is `20261026232843`; the connector recorded remote version `20261026235813`. Do not replay the same migration because the generated timestamps differ. Post-apply verification confirms RLS, denied browser access to the new financial RPCs/table writes, service-role access, and an empty reconciliation queue. Existing counts remain 8 listings and 0 payments.
- Supabase security-advisor comparison: no new warning/error category or finding. The additional informational no-policy notice belongs to `order_cancellations`, intentionally inaccessible to browser roles and accessed through service-only RPCs. Existing project findings remain unchanged.
- Actual Stripe test cycle: **6/6 groups passed**, exit code 0, on sandbox `acct_1UUqkiLEgZ0a06x6`, run `needs-stripe-test-4af71744-3c6f-41c9-8335-9abc98c53a42`. Identity and test mode were checked before writes. A separate app/listener on port 3003 used API version `2026-09-30.endive`, without global queue/email workers. Coverage includes authenticated Connect status; manual authorization, intent reuse and two-party capture; actual CLI webhook delivery and duplicate replay; buyer complaint plus administrator refund with transfer/fee reversal; hourly proposal and other-party acceptance of a EUR 2 total instead of the EUR 10 hourly rate; Stripe's actual capture deadline; mutual cancellation blocking capture and allowing one replacement intent; and administrator release of an authorized hold.
- The first actual attempt exposed a Connect compatibility bug: controller-based accounts can return `type: "none"`, which the legacy profile column rejects. Synchronization now stores null for non-legacy types while retaining actual capabilities/readiness. Both the status endpoint and `account.updated` webhook are covered; 17/17 focused API regressions pass. Independent review found no blockers. TypeScript and all 15 operational-script tests pass after the fix.
- Cleanup completed successfully. A separate provider read confirmed five test PaymentIntents: two captured EUR 2 payments, each fully refunded, and three canceled intents. No authorization remains open. NEEDS database counts returned to 8 listings, 0 payments, 0 service-price agreements, 0 cancellation requests and 0 users belonging to either test run. Stripe test history and the synthetic connected provider are retained for inspection. The temporary app/listener stopped cleanly, restored generated Next configuration, and the existing application on port 3002 still returned HTTP 200.
- The sandbox's existing test key remains in ignored local configuration; no new CLI OAuth authorization was approved. The other project's keys, webhook configuration and application environment were not changed. No live money was used.

The actual provider-run transcript is `stripe-sandbox-verification-attempt2.log`; the independent final Stripe snapshot is `stripe-sandbox-results.json`. Both are local review artifacts, alongside screenshots, under the task's `2026/10/26/01a177a2-ad08-7d92-80f5-586d2402dafd` visualization directory. They contain no API keys. Optional milestone execution was not enabled against the shared database; milestone behavior remains covered by automated tests.

Natural authorization expiry, a completed browser SCA challenge, actual bank payout and real email delivery require separate verification; mocked expiry/race tests do not establish those outcomes. Final operator identity and legal/email configuration remain deferred by the project owner. No percentage alone establishes production readiness.
