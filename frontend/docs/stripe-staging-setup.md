# Stripe setup and SDK23 compatibility

The application uses Stripe SDK23, React Stripe.js7 and Stripe.js10. The explicit server API version is **2026-09-30.endive**, shared by `lib/stripe/server.ts`, the opt-in payment harness and the local webhook runner through `lib/stripe/api-version.mjs`. Node20 or newer is required by the SDK.

The existing workflow remains Payment Element → EUR PaymentIntent → manual authorization → confirmation by both participants → capture. The platform uses destination charges with a 5% application fee. Existing Express Connect accounts continue through the supported Accounts V1 endpoints. This dependency upgrade does not change account liability, fund flow or migrate connected accounts to Accounts V2.

## Configuration

Use the existing environment names in `.env.local`: `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, and `NEXT_PUBLIC_APP_URL`. Store secrets locally or in the deployment secret store, never in tracked source. Local verification accepts test-mode keys only and targets `http://127.0.0.1:3002`.

Connect must be enabled on the platform, and a connected seller must have an active transfers capability. The platform's own payment capability does not enable Connect. Business verification, domain configuration, Connect activation and email-provider configuration remain separate setup steps; this guide does not bypass them.

## Local webhook forwarding

After provider setup is authorized and complete, `npm run dev:payments` starts the installed Stripe CLI and the app together. The CLI signing secret is passed privately to the app. `npm run start:payments` uses an existing production build. The actual webhook route is `/api/payments/webhook`.

The CLI cannot select an arbitrary webhook API version. The runner requests `listen --latest` and requires its announced version to match **2026-09-30.endive** before starting the application. A future Stripe release or account-version mismatch stops startup with an actionable error, rather than silently changing webhook schemas. Platform and Connect events are forwarded explicitly to the same handler. Any future deployed webhook endpoint must also be configured with the explicit reviewed version; upgrading this package does not change existing Stripe account or endpoint settings.

The webhook always verifies the raw payload and signature. Retried events created on the previous `2024-06-20` API are still accepted when their signature and supported payload fields are valid. Unknown event types are acknowledged without financial effects. Refund changes retrieve canonical current refund records rather than trusting stale event snapshots.

## Verification

Run the payment route/component suites and SDK compatibility tests using the current package scripts. Offline SDK tests exercise the actual installed request serializer and HMAC verifier, including manual capture, Connect V1 parameters, destination refund reversal, idempotency headers, old/new event snapshots, body tampering and expired signatures. They do not create provider objects or prove remote Connect enrollment.

For the separately authorized real test-mode smoke, follow [the guarded harness instructions](../scripts/verify-stripe-test-payments.md). It requires a ready disposable connected seller and functioning CLI delivery. It creates only test payments and temporary Supabase fixtures, with cleanup. Do not replace Stripe signature verification or use fake payment success responses to work around missing provider setup.

Stripe receipts use the verified buyer's email. Test-mode receipts are sent manually through Stripe Dashboard; passing a test charge does not prove inbox delivery.

References: [current API version](https://docs.stripe.com/api/versioning), [SDK23 migration](https://github.com/stripe/stripe-node/wiki/Migration-guide-for-v23), [SDK22 argument changes](https://github.com/stripe/stripe-node/wiki/Migration-guide-for-v22), [Stripe receipts](https://docs.stripe.com/receipts).
