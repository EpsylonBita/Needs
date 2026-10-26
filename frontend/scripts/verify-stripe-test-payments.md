# Stripe test payment verification

This opt-in script exercises the existing application without changing its UI. It creates temporary Supabase users and listings and real **test-mode** Stripe PaymentIntents. It never uses a real card or a live key. Stripe retains its test payment history.

Prerequisites:

- Activate Connect for the existing Stripe platform. The platform's own charges/payouts flags are insufficient.
- Prepare a disposable connected test seller owned by that platform. Its `transfers` capability must be `active`. The platform account ID itself is not a valid seller fixture.
- Configure matching test publishable/server keys, the local Stripe CLI webhook signing secret, `NEXT_PUBLIC_APP_URL=http://127.0.0.1:3002`, and `STRIPE_TEST_CONNECTED_ACCOUNT` in the local environment. Restart the application after changing server configuration; rebuild if the public Stripe key changed.
- Use the existing Supabase project's URL, anon key, and service-role key. Apply the payment migrations first. Enable the existing payment and milestone feature flags.
- Keep Stripe CLI forwarding both platform and Connect events to `/api/payments/webhook`. Include `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `payment_intent.amount_capturable_updated`, `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`, `transfer.created`, `charge.dispute.created`, `charge.dispute.closed`, and `account.updated`.

From `frontend`:

Server requests and this script explicitly use `2026-09-30.endive` from `lib/stripe/api-version.mjs`. The local runner uses `listen --latest` and refuses startup if Stripe announces another version. Configure future deployed webhook endpoints to the same explicit version; changing the SDK does not update remote endpoint versions.

```powershell
node scripts/verify-stripe-test-payments.mjs --allow-test-payments
```

The script checks authenticated intent creation/reuse, manual authorization with Stripe's `pm_card_visa`, participant confirmations under actual RLS, capture, real CLI-delivered webhook processing, duplicate signed replay of an actual Stripe event, application complaints, admin refunds including seller transfer/platform fee reversal, milestone funding, cancellation and safe retry. The replay happens only after successful CLI delivery was observed, so it cannot conceal a broken forwarder.

Temporary fixtures are removed in `finally`, after canceling or refunding exact test intents created by that run. Settlement failures preserve local fixtures and print the test-run marker for recovery. Existing connected seller accounts are never deleted. Do not stop the CLI forwarder before cleanup completes. There may be late Stripe retries after local fixture cleanup; these test-only event IDs remain in Stripe history.

The script asserts `receipt_email` matches the verified temporary buyer. Stripe does not automatically send test receipts; sending a test receipt manually from Stripe Dashboard is a separate explicit email-delivery check. No real inbox delivery is claimed by this script.

References: [Stripe Connect testing](https://docs.stripe.com/connect/testing), [manual capture](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method), [refund lifecycle](https://docs.stripe.com/refunds), [test receipts](https://docs.stripe.com/receipts#test-receipts).
