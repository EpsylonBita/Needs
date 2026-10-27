# Stripe test payment verification

This opt-in script exercises the local application without changing its UI. It creates temporary Supabase users, listings and conversations and real **test-mode** Stripe PaymentIntents. It never uses a real card or a live key. Stripe retains its test payment history. Running it requires explicit authorization for the chosen Stripe platform and Supabase project; knowing an account ID is not authorization to switch accounts.

Prerequisites:

- Activate Connect for the existing Stripe platform. The platform's own charges/payouts flags are insufficient.
- Prepare a disposable connected test seller owned by that platform. Its `transfers` capability must be `active`. The platform account ID itself is not a valid seller fixture.
- Configure matching test publishable/server keys, the local Stripe CLI webhook signing secret, `NEXT_PUBLIC_APP_URL=http://127.0.0.1:3002`, and `STRIPE_TEST_CONNECTED_ACCOUNT`. Set `STRIPE_TEST_EXPECTED_PLATFORM_ACCOUNT` to the independently checked platform account ID. The runner retrieves the account using the selected key and fails before fixture writes if it differs. A platform's test key and its connected seller must belong to the same test environment.
- Accepted server-key families are `sk_test_`, `rk_test_` and the CLI sandbox's short-lived `rkcs_test_`. All live-mode variants are rejected. A short-lived sandbox key still requires explicit platform selection and a matching disposable connected seller; renew an expired key through the authorized sandbox setup.
- Use the selected Supabase project's URL, anon key and service-role key, with `SUPABASE_TEST_EXPECTED_PROJECT_REF` matching its hostname exactly. Apply the payment, agreement and authorization-lifecycle migrations first. Enable payments through the existing application configuration. The optional milestone journey additionally requires its feature flag already enabled; the runner never changes shared flags.
- The local application and Stripe CLI must use the same selected credentials and API version as the runner. Restart the application after changing server configuration; rebuild if the public Stripe key changes. A separate test environment file does **not** change or restart the app automatically.
- Before running against a shared database, verify the service role can read and remove the exact fixture dependencies: transactions, disputes, payment audit, order cancellations, payments, milestones, service agreements, messages, chat participants, chats, listings and temporary auth users. The private order-notification ledger cascades when its fixture payment is deleted. The runner does not change grants, disable history triggers or remove unrelated financial history. If the final schema adds restrictive dependencies, update the fixture cleanup before running.
- Keep Stripe CLI forwarding both platform and Connect events to `/api/payments/webhook`. Include `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `payment_intent.amount_capturable_updated`, `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`, `transfer.created`, `charge.dispute.created`, `charge.dispute.closed`, and `account.updated`.

From `frontend`:

Server requests and this script explicitly use `2026-09-30.endive` from `lib/stripe/api-version.mjs`. The local runner uses `listen --latest` and refuses startup if Stripe announces another version. Configure future deployed webhook endpoints to the same explicit version; changing the SDK does not update remote endpoint versions.

```powershell
node scripts/verify-stripe-test-payments.mjs --allow-test-payments
```

By default this reads `.env.local` without changing it. Prefer a separately prepared test file when testing a different authorized account, or use an inherited environment only:

```powershell
node scripts/verify-stripe-test-payments.mjs --allow-test-payments --env-file .env.stripe-verification.local
node scripts/verify-stripe-test-payments.mjs --allow-test-payments --no-env-file
```

The selectors are mutually exclusive. Inherited environment values override file values; empty inherited values stay empty and fail validation when required. The runner never writes an environment file or modifies `process.env`. Keep credentials in ignored local files or the invoking process, never command arguments or source control.

The default journeys check:

- Authenticated fixed-price creation/reuse, manual authorization with Stripe's `pm_card_visa`, both participants' canonical `/api/orders/confirm` calls and capture. One participant's confirmation cannot capture payment.
- Actual CLI-delivered webhooks, duplicate signed replay of an actual Stripe event, complaints and admin refunds including seller transfer/platform-fee reversal. Replay happens only after successful CLI delivery was observed, so it cannot conceal a broken forwarder.
- Hourly service proposal, rejection of self-acceptance, acceptance by the other participant and checkout/capture/refund of the accepted EUR2 total instead of the EUR10 hourly rate.
- Reconciliation of the actual Stripe card `capture_before` deadline into the order DTO. This verifies deadline provenance, not natural passage of the authorization window.
- A participant cancellation request on an order already confirmed by both parties that leaves funds authorized until the other party accepts; capture blocked by the pending cancellation, Stripe cancellation, recorded release and a single reusable replacement intent.
- Administrator cancellation of another exact authorized test hold.

Append `--include-milestones` to verify proposal funding, canonical confirmation, capture and refund for a fixed-price milestone. It fails before fixture writes if milestones are disabled. This option does not enable milestones for hourly listings.

Temporary fixtures are removed in `finally`, after canceling or refunding exact test intents owned by that run. Cleanup verifies the random run marker, listing ownership, both payment parties, destination, test mode and manual EUR payment type. It discovers persisted or response-lost intents only through owned listings and parties. Foreign participants, reviews or conversations on a fixture stop cleanup. Financial dependencies are removed explicitly before history-protected listings; no trigger is bypassed. Settlement or ownership uncertainty preserves local fixtures and prints the marker for recovery. A deletion failure stops further dependent cleanup and reports remaining records; earlier successful deletions are not rolled back. Existing connected seller accounts are never deleted. Do not stop the CLI forwarder before cleanup completes. Late Stripe retries can still arrive after cleanup; test objects and events remain in Stripe history.

The runner does not accelerate a real card authorization clock, test completed browser SCA challenges, verify bank payouts, send receipts, call the scheduled reconciliation endpoint, or mutate real-user records. Those remain separate checks. Local database/unit tests exercise expiry transitions, races and uncertain provider responses; they are not substitutes for this real test-mode cycle. No successful external run is implied by the presence of this script.

A separate authorized sandbox run on 2026-10-27 completed browser SCA failure/cancellation/success and real reconciliation-worker recovery checks. See [the execution evidence](../../docs/ESCROW_LIFECYCLE_2026-10-27.md#browser-sca-and-automatic-reconciliation-verification) for results and limits; these checks are not part of this script's default journeys.

Offline checks, requiring no credentials or network calls:

```powershell
node --check scripts/verify-stripe-test-payments.mjs
node --test tests/scripts/verify-stripe-test-payments.test.mjs
```

The script asserts `receipt_email` matches the verified temporary buyer. Stripe does not automatically send test receipts; sending a test receipt manually from Stripe Dashboard is a separate explicit email-delivery check. No real inbox delivery is claimed by this script.

References: [Stripe Connect testing](https://docs.stripe.com/connect/testing), [manual capture](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method), [refund lifecycle](https://docs.stripe.com/refunds), [test receipts](https://docs.stripe.com/receipts#test-receipts).
