# NEEDS domain and production deployment — 19 October 2026

## Domain and project

`getneeds.app` was registered through Vercel Pro's free first-year domain offer. Checkout showed a total of **USD 0** before registration was completed. Registration expires on **19 October 2027**; automatic renewal is **disabled**, so renewal must be arranged before expiration to retain the domain.

| Setting | Recorded value |
| --- | --- |
| Production domain | `getneeds.app`, verified and assigned to the project |
| Additional hostname | `www.getneeds.app`, HTTP 308 redirect to the apex |
| Stable Vercel alias | `needs-three.vercel.app`, confirmed by the project's domain list |
| Vercel project | `needs` / `prj_Tn4tkkXi0hbhqxaqH5NUD5VbkU7p` |
| Team | `epsylonbitas-projects-f09bdea6` / `team_SuZTr0A3p3KrAMxdZc6e1u9o` |
| Promoted deployment | `dpl_AUBA8ZVpuvtcztEykk3a1cd2xAA3` |
| Deployment hostname | `needs-mlyvelv9r-epsylonbitas-projects-f09bdea6.vercel.app` |

## Deployment configuration

The deployment was uploaded through the CLI from the current local `frontend` working tree and promoted to production. It has **no Git linkage**. Future changes require another deliberate deployment of the intended working-tree snapshot; a local edit or Git push alone does not publish it.

Settings: Next.js, Node 24.x satisfying the repository's `>=24.21.0 <25` requirement, install command `npm ci`, build command `npm run build -- --webpack`, default Next.js output and region `fra1`. For a future Git import, use `frontend` as the Root Directory. Webpack is the verified build path; the local Turbopack worker failure remains documented in [the audit report](AUDIT_REPAIRS_2026-10-19.md).

Nine approved environment keys were configured for Production. The canonical application URL is `https://getneeds.app`; `NEXT_PUBLIC_PAYMENTS_ENABLED=false`. No environment secret values are recorded here.

## Supabase Auth

The configuration push for existing project `qczrqxmewjsydrrvjdil` succeeded with exactly two declared URL-setting changes:

```toml
[auth]
site_url = "https://getneeds.app"
additional_redirect_urls = [
  "https://getneeds.app/auth/confirm",
  "https://getneeds.app/auth/reset-password",
  "http://127.0.0.1:3002",
  "http://127.0.0.1:3002/**"
]
```

The local development redirects and ten undeclared remote settings were preserved. A post-push `config diff --output-format json` reported **0 updates** and **10 unchanged remote-only settings**, covering the existing security, pooler and storage settings. Callback configuration is complete; this does not verify email-provider acceptance, inbox arrival or a full public-domain authentication journey.

## Local environment recovery

An older Vercel CLI's `link --yes` unexpectedly replaced the ignored `frontend/.env.local`. The local environment was recovered to **20 keys** from the task's prior backup, with the exact contact recipient recovered from the user's earlier NEEDS instruction and its recorded environment assignment. The recovered Supabase anonymous request returned HTTP 200; a Stripe balance check returned HTTP 200 with `livemode=false`.

`CRON_SECRET` was newly generated locally because the email worker is inactive. It was **not uploaded to Vercel**. The recovered recipient, secret values and private founder address are omitted from this record. Back up the local environment before future CLI linking or environment downloads; keep local and deployed environment configuration separate.

## Verification boundaries and remaining work

Domain registration, Vercel domain verification, production deployment promotion and the Supabase Auth config push completed. Final public verification passed:

- `https://getneeds.app/`, `/login`, `/auth/confirm` and `/auth/reset-password` returned HTTP **200**, with successful TLS certificate verification (`curl` verification result `0`).
- `https://www.getneeds.app/` returned HTTP **308** with destination `https://getneeds.app/`.
- `/api/health` returned HTTP **200** with `status: ok` and `database: connected`.
- `/api/payments/context` returned HTTP **401** without authentication, as expected.
- A browser visit loaded the eight pre-existing demo listings and the Mapbox map. Browser console errors and warnings were empty; a screenshot was saved as `getneeds-live.jpg`.
- A Vercel runtime-log query for error/fatal events in the final 10-minute window, grouped by `requestPath`, returned no results.

These checks verify public routing, TLS, database connectivity, page rendering and the unauthenticated payment boundary. They do not establish a completed signup/email-delivery or payment journey.

- Payments remain disabled. The existing Stripe account still needs Connect enrollment and a verified connected-account checkout/webhook/refund test before payment activation.
- Resend sending configuration, Supabase custom SMTP and actual email delivery remain incomplete. Production contact-email retries also require an authenticated scheduler and its deployed secret.
- The [Greek legal documents](legal/README.md) remain local drafts. Final operator/contact details and the required operational controls must be completed before publishing binding Terms and Privacy text; the public pages still state that final text is unpublished.

The domain and deployment work does not resolve these earlier limitations. See [SETUP.md](SETUP.md) for service setup and [the audit report](AUDIT_REPAIRS_2026-10-19.md) for application checks.
