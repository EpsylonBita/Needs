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

`npm run dev:payments` and `npm run start:payments` start the Stripe webhook forwarder, application, reconciliation worker and contact-email retry worker together. The contact worker remains inactive without its separate delivery configuration. The local launcher generates an ephemeral, server-only payment-worker secret unless one is provided. Webhooks remain required; reconciliation supplements them. The isolated sandbox verification launcher deliberately excludes unattended queue/email workers.

For a hosted environment, configure the same random `PAYMENTS_WORKER_SECRET` (at least 32 characters) in the application and worker. Run `node scripts/payments-reconciliation-worker.mjs` with that secret and the HTTPS application origin in `NEXT_PUBLIC_APP_URL`. The worker drains successful batches, then polls every five minutes while idle. Run it as a supervised service and alert on non-success responses or unexpected process exit. An external scheduler may invoke the exact authenticated `POST /api/internal/payments/reconcile` endpoint; each request leases at most two rows, so scheduler frequency/concurrency must cover the queue volume. `--once` checks one batch and exits nonzero on failure.

Lifecycle provider reads use a 12-second timeout; approved-recovery provider requests use 8 seconds. Both disable hidden SDK retries. At most two orders are reconciled concurrently. The process limits each application request to 125 seconds. Database leases prevent duplicate workers from selecting the same order, reject expired leases, and back off failed rows. Never deploy this endpoint with a public client secret or use a user-session token as the scheduler credential.

Unsettled payments are due every five minutes; settled payments are revisited every six hours for missed refund/dispute events. The worker may resume a previously accepted cancellation or an existing administrator-approved seller recovery. It cannot create a new recovery approval or capture money automatically. More than 100 refund/dispute records on one payment require manual review rather than accepting an incomplete financial snapshot.

Optional `PAYMENTS_WORKER_HEALTH_FILE` records only health status, timestamps, counts and consecutive failures. Startup, failure, shutdown, malformed state and a success older than 450 seconds fail the local probe; recovery restores health. A missing/unwritable configured destination fails closed. [Worker operations](../frontend/docs/payments-worker-operations.md) documents the credential-free probe and inactive systemd service/timer templates. They have not been installed on a production host or connected to an external alert channel.

## Stripe account separation

The dedicated test sandbox is separate from the existing connector's account and the prior local account. Claim/login, sandbox Connect enablement and the two owner-approved liability/compliance acknowledgements are complete. Anonymous CLI sandbox keys were too restricted for Connect; the actual exercise used the sandbox's own existing test key and a synthetic connected provider. A successful sandbox creation alone does not verify payments.

A later launch account needs its own keys, matching webhook endpoint/signing secret, Connect configuration and connected providers. Test account IDs, connected accounts and PaymentIntents are not portable to another account. Do not switch the provider credentials while older unsettled payments still need reconciliation; settle them first or retain an explicit per-account routing path. No production deployment, live key activation or hosted scheduler configuration is implied by these code changes.

## Earlier lifecycle execution evidence

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

## Browser SCA and automatic reconciliation verification

On 2026-10-27, the additional run `needs-sca-worker-2cc63e48-4b79-420d-8429-57eb3dd7947f` completed **10/10 checks**, exited 0 and reported `passed-cleaned` with no cleanup errors. It used only sandbox `acct_1UUqkiLEgZ0a06x6`, the existing synthetic connected provider and a separate application at `http://localhost:3003`. Using a separate hostname also kept the original application's browser session and CSRF cookies separate. The original application's environment file was not changed.

- The actual in-app browser completed Stripe's 3DS2 challenge with test card `4000000000003220`. Failure and cancellation both returned a usable checkout with an authentication error, no captured amount and no charge ledger entry. Retrying the same PaymentIntent and completing the challenge produced Stripe evidence `result: authenticated`, `authentication_flow: challenge`, and `requires_capture`. The return page showed EUR 2 awaiting completion with finalization disabled. The application captured only after both canonical completion confirmations, then completed a complaint/admin refund.
- The reconciliation endpoint returned HTTP 401 for missing and incorrect worker secrets. An authenticated empty-queue check returned zero claimed, completed and failed rows.
- A loopback relay deliberately withheld only exact run-owned Stripe events while forwarding all others unchanged. Three actual authorizations remained unverified in the database until the production worker drained bounded batches of **2, 1, then 0**. It recovered Stripe's authorization state and actual capture deadlines, with no failed rows.
- Even with both participants' completion confirmations present, a reconciliation pass left the authorization uncaptured. The worker never charged automatically.
- After an explicit test capture and refund with their webhooks withheld, the worker recovered the completed and refunded states. Repeated checks left exactly one charge entry and one canonical refund entry.
- The worker resumed an already accepted, durably claimed cancellation after a simulated interruption before the Stripe request. It released that exact authorization and cleared the cancellation claim without recording a charge.
- The database queue is global: this run began with zero payments and checked full-table fixture ownership and absence of leases before every worker request. These checks support an exclusive test window; they are not a guarantee against concurrent foreign inserts. Only run-owned due timestamps were adjusted to make individual batches deterministic.
- Cleanup restored webhook forwarding, settled the four new test intents, and removed only verified run-owned dependencies and users. Independent reads confirmed two fully refunded EUR 2 charges and two canceled intents for this run, with no open authorization. Database counts returned to 8 listings, 0 payments, 0 service-price agreements, 0 cancellation requests and 0 run-owned users. Including the prior cycle, the sandbox contains four fully refunded and five canceled intents.

The sanitized results are preserved in [the verification record](verification/stripe-sca-reconciliation-2026-10-27.json). Local evidence includes `stripe-sca-reconciliation.log`, `stripe-sca-reconciliation-results.json`, `stripe-sca-challenge.png`, `stripe-sca-success.png` and the updated independent `stripe-sandbox-results.json` in the same task visualization directory. The isolated app, relay and CLI listener stopped cleanly and restored generated Next configuration. The private harness and relay were independently reviewed; they were not installed as hosted services.

That earlier SCA run verified bounded draining/recovery but stopped on reaching idle. The later resilience run below adds real multi-worker concurrency, bank disputes and a five-minute wall-clock idle cycle. Neither run establishes a deployed scheduler or natural provider expiry.

## Resilience, bank disputes and settlement-currency correction

The later sandbox run is `needs-escrow-resilience-cc8c6e56-80c7-4ff2-95ac-420187dde479`, begun on 2026-10-27 at 11:36:11 UTC and completed at 11:56:50 UTC. It exited 0 with **11 checks, `passed-cleaned`, and no cleanup errors**. The target remained platform `acct_1UUqkiLEgZ0a06x6`, synthetic connected provider `acct_1UUyVUL5kmhcKzLl` and the isolated application on `http://localhost:3003`. Account identity and test-only credentials were checked before fixture writes. The original application's environment checksum remained unchanged; the other project's account/settings were outside the exercise.

The run recorded **nine financial/security groups plus one actual idle-cycle check**:

1. Missing and incorrect scheduler secrets were rejected before fixture writes.
2. Concurrent claimers on real PostgreSQL reserved four distinct payment rows. An incorrect lease token could not finish another worker's claim.
3. Two simultaneous authenticated HTTP workers completed separate two-row batches, released their leases and left all four holds uncaptured.
4. Disposable PostgreSQL deadline boundaries blocked confirmation/capture and deduplicated 24-hour, one-hour and expired warnings. The actual Stripe deadline was retained; Stripe time was not accelerated.
5. A simultaneous capture/cancellation request produced one terminal result: capture HTTP 409, cancellation HTTP 200, provider state `canceled`.
6. An already accepted cancellation remained exclusively canceled when capture raced it, again returning 409/200.
7. An actual test-card bank dispute reached `won`; open-dispute refund restrictions, canonical outcome and duplicate/late event handling were verified.
8. Another actual bank dispute reached `lost`. Its deliberately missed opening notification was recovered by the worker; no second customer refund was created for the bank loss.
9. Explicit administrator approval recovered the lost fixture's original seller transfer. Non-admin execution and a stale preview were rejected. Concurrent execution returned HTTP 202/200 and converged on one recovery and one provider reversal, with a separate recovery ledger.
10. The continuous worker waited **301,777 ms** and woke to reconcile one due authorization without capturing it. An independent empty-queue/health exercise also covered a full five-minute idle interval; successful idle rounds, invalid authentication and shutdown produced the expected health states.

The eleventh check recorded completion of the separate browser review described below.

These are actual sandbox/PostgreSQL results, separate from PGlite's deterministic state-transition tests. The shared queue was audited for exact fixture ownership and absent leases before worker calls. This remains an exclusive test-window procedure, not permission to run a sandbox worker unattended alongside another account's orders.

### Failure discovered and corrected

The first resilience attempt, `needs-escrow-resilience-dff61943-6ea3-4407-a65f-b7594b08181c`, reached both bank outcomes but stopped when recovery/cleanup incorrectly assumed the transfer currency matched the customer charge. It preserved its fixtures and failed-run report rather than guessing a settlement. The values were **200 EUR minor units (€2.00)** for the customer charge, **223 USD minor units ($2.23)** for the original destination transfer, **10 EUR minor units (€0.10)** for the original application fee and **11 USD minor units ($0.11)** for the destination fee/refund. Values in these different currency domains must not be directly compared or subtracted.

Recovery now binds the original charge, transfer, connected account, destination payment and fee identities. It retains original payment/fee amounts separately from settlement amounts. Full transfer reversal is verified in the transfer's own currency; the original fee's fully-refunded state is checked in its own units, and the fee-refund record is checked against the destination-payment fee in settlement currency. The verified recovery example is **€2.00 original payment → $2.23 gross reversal, $0.11 fee refund, $2.12 seller net**, not a conversion rate invented by the application. The exact fixture-cleanup helper performs no new product approval and refuses unknown, partial or foreign state.

An independent currency audit also found that the payment dashboard had labelled transfer amounts with the parent payment's currency. The additive transaction-currency migration stores/backfills only verified currency evidence; unknown transfer currency remains explicit rather than falling back to EUR. It does not rewrite transaction amounts or statuses. The local migration is `20261027113829_payment_transaction_currencies.sql`; Supabase recorded its successful application under remote version **`20261027115134`**. Do not replay it merely because those timestamps differ. Readback of the then-current fixture rows confirmed four charge rows in EUR and two transfer rows in USD.

The payment dashboard and exported account data now retain transaction currency. Administrator overview totals come from the authenticated summary API, remain grouped by currency and are labelled as requested amounts across all statuses, including failures/refunds—not collected revenue. The transfer count is labelled as recorded transfers and explicitly includes records later reversed. A subsequent browser check found another defect: browser-side counts were RLS-filtered and showed zero transfers although the service query found two. The summary endpoint now provides authenticated service-side global counts; the overview performs no browser table reads. The actual browser then showed **2 recorded transfers**, matching the SQL count.

### Canonical disputes and manual recovery

Newer authoritative Stripe snapshots can correct `lost` to `won` without allowing stale/open/regressive events to overwrite terminal truth. Webhooks handle dispute updates and reinstated funds through an atomic canonical-state/event-marker operation. Real refund history and other open/lost cases still govern payment state. The prior loss audit is retained and late wins require settlement review; attention is not blindly cleared and no automatic compensating transfer is issued.

Seller recovery requires an authenticated administrator's explicit approval of a fresh preview. The durable approval binds platform/test mode, original provider identities and both original/settlement currency domains. Refund reservations exclude recovery; partial/ambiguous histories stop for review. Retries and worker continuation use the existing approval and stable reversal idempotency key. A recovered seller transfer is recorded separately from a customer refund. This code does not itself establish the legal authority for production recovery.

### Browser and final code verification

This resilience run used an **isolated Playwright CLI browser** because the CUA kernel was unavailable. The historical SCA challenge above was performed in the in-app browser; these are separate browser exercises. The isolated browser verified the lost case as completed with the original EUR payment and USD recovery breakdown, while the won case did not allow loss recovery. The filtered CSV reflected the selected bank-dispute filter. A mobile overflow found during this review was fixed in the shared admin layout, dispute table and recovery detail. A fresh viewport check confirmed document width **390 px** equals viewport width **390 px**; long provider identifiers and the table remain contained.

Verification sequence, without treating older runs as fresh tests of later edits:

- Before the final transaction-currency/overview follow-up: full Vitest **1,290/1,290** across **134 files**, full local DB **117/117**, Node scripts **25/25**, and TypeScript passed.
- After the final transaction-currency and overview changes: focused UI/API **23/23** and the two affected DB suites **43/43** passed. Dispute/recovery component checks passed **20/20** after mobile changes.
- Full ESLint after the currency/overview changes: **0 errors, 324 warnings** across 559 files. After the final mobile CSS changes, TypeScript and scoped lint of the affected admin files passed again. The new overview page and tests have no lint warnings.
- After the global-count/RLS correction: **21/21** focused overview, summary-API and existing payment-admin component tests passed; TypeScript and scoped ESLint passed without warnings/errors.
- The first overview regression failed on the old raw financial browser read before its fix. The currency tests cover separate EUR/USD presentation, unknown-currency behavior, provider-evidence backfill and malformed/mismatched evidence.
- The final production build and **14/14 desktop/mobile E2E tests** passed with exit 0 in approximately 1.3 minutes. The first invocation could not locate the browser executable; the successful rerun used the already installed `.tools/playwright-browsers` via `PLAYWRIGHT_BROWSERS_PATH`. Its log is `final-production-e2e-attempt2.log`; this was an environment-path repair, not a silently ignored test failure.

### Final cleanup and independent state check

The final cleanup settled only exact run-owned provider objects and removed their verified database dependencies/users. Stripe test history and the synthetic connected provider were retained. A separate read-only verification at **2026-10-27 11:57:18 UTC** passed across **21 test PaymentIntents** from the exercised runs: **13 canceled**, **6 fully customer-refunded**, and **2 lost bank disputes with the original seller transfer fully reversed**. The lost disputes were not refunded to the customer a second time. Transfer and application-fee settlement were verified in each object's own currency.

Database counts returned to **8 listings and 0 payments, service-price agreements, cancellation requests, recoveries and recovery-ledger rows**. The original `frontend/.env.local` checksum was unchanged. The isolated application/listener stopped cleanly and generated Next configuration was restored. These are point-in-time results before any separately arranged natural-expiry fixture; they do not assert that future test data cannot exist.

The post-migration security-advisor comparison added only **two informational no-policy notices** for the recovery tables, which intentionally deny browser access and use service-side operations. All warning/error findings were unchanged.

The archived [resilience result](verification/stripe-escrow-resilience-2026-10-27.json) and [independent final-state snapshot](verification/stripe-escrow-final-state-2026-10-27.json) were scanned for API keys, webhook/client secrets, authentication tokens and password fields before copying into the repository. They contain test-object identifiers and sanitized outcomes, not credentials. The original failed-run evidence and detailed private logs remain available to the coordinating task.

## Scheduled natural expiry

The user explicitly authorized one separate EUR 2 test authorization to remain until Stripe's natural expiry. It exists only in Stripe, with no shared database listing/payment/user or running application worker. The sandbox app, relay and CLI listener were stopped before it was created.

- Platform: `acct_1UUqkiLEgZ0a06x6`; PaymentIntent: `pi_3UV98JLEgZ0a06x60Cd6e9Ig`.
- Run: `needs-natural-expiry-52b57489-2316-4e85-a242-6495563b9e71`.
- Stripe returned `requires_capture`, EUR 200 minor units held, and zero amount received. Its actual `capture_before` is **2026-11-03 12:05:39 UTC** (13:05:39 Europe/Berlin).
- A subsequent read-only verification returned `not_due`, not a fabricated expiry success. [Scheduled-fixture evidence](verification/stripe-natural-expiry-scheduled-2026-10-27.json) is archived. This is the only intentionally open authorization after the independently verified cleanup of the previous 21 intents.
- An active thread heartbeat named **NEEDS: φυσική λήξη δοκιμαστικής δέσμευσης**, automation ID `needs`, was created on 2026-10-27 at 12:06 UTC with its initial check after 169 hours, after the provider deadline. It invokes only the ignored local helper's `--verify-read-only` mode. If Stripe needs more time, it switches the same reminder to hourly follow-up. It stays quiet for unchanged expected state and deletes itself after verified completion.
- Natural expiry requires the exact original uncaptured charge, zero received/refunded amount, internal automatic/expired cancellation at or after the saved deadline, and a matching provider cancellation event with no manual API request. The scheduled check must never capture/cancel/refund or create a replacement, modify another account, start a global worker, or manufacture webhook evidence.
- Preparation encountered two explicit validation rejections: an API-removed request parameter and its cached idempotency mismatch. Complete provider-list reads proved no intent existed before the audited request/key revision. The same run was retained, both rejection/absence records preserved, and only the accepted request created the hold. Fifteen offline helper tests cover identity, uncertain responses, retry keys, saved deadlines and read-only verification.

After final code integration, a fresh six-suite financial/admin regression run passed **75/75 tests**. The original `.env.local` checksum and generated Next configuration remained unchanged. A final HTTP probe of port 3002 found no listener; this run did not start or reconfigure that original application. The isolated verification server was stopped intentionally.

## Remaining verification and activation boundary

- **Natural provider authorization expiry: PENDING.** Deadline-boundary tests above changed only disposable database fixtures. They do not prove a real Stripe hold reached its natural deadline and was automatically released. The coordinating task will add the actual result when available.
- Production supervision and alert delivery: deployment templates and local health checks are prepared, but an intended production host, installed service/timer and received external alert have not been verified.
- Live credentials, live checkout, real bank payout and email delivery have not been activated or verified by this work.
- Legal/operator/email preparation uses clearly marked Greek/English drafts and inactive `.invalid` mock contacts. The offline placeholder check deliberately reports not ready. Final operator details, approved legal texts, sender/domain/provider configuration and inbox delivery checks remain separate; see [launch and email preparation](LAUNCH_EMAIL_PREPARATION_2026-10-27.md).

No production-host installation, live payment activation or external email send was performed. No percentage alone establishes production readiness.
