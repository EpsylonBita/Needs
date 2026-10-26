# NEEDS audit repairs — 2026-10-19

These changes were made with Codex. On 19 October 2026, after explicit user authorization, all three new migrations were applied to the connected **Needs** database (`qczrqxmewjsydrrvjdil`). No Stripe charge, capture, refund, application deployment or commit was performed as part of this repair.

## Transaction roles

The `seller_id` on a listing identifies its publisher. The `seller_id` on a payment or milestone identifies the actual seller/provider receiving payment. They are different for a request.

| Listing | Payer | Recipient |
| --- | --- | --- |
| Items / Buy | Publisher requesting the item | Other member of the selected listing conversation |
| Services / I want | Publisher requesting the service | Other member of the selected listing conversation |
| Items / Sell | Buyer | Listing publisher |
| Services / I will or I can | Customer | Listing publisher |
| Items / Free, or a zero-price listing | No checkout | Arrange through chat |

Request payments require a direct conversation tied to the listing, with exactly the publisher and one other participant. API validation and service-only database functions both check these rules. Payment and milestone records retain the chosen chat; saved proposals retain their provider. Request idempotency includes the provider, so two responders cannot share a payment intent accidentally. Legacy offer checkout without a chat remains supported.

The authenticated payment-context endpoint supplies the UI's role decisions. Only the payer sees the payment action. A provider sees the corresponding waiting/onboarding state. Free listings do not offer checkout or paid milestones.

Existing request authorizations with reversed financial roles receive `role_review_required=true`. Capture rejects them before contacting Stripe. Orders and payments explain the hold; the administrator list and CSV expose the flag and a matching filter. The repair preserves their original parties, amounts and Stripe destination. An administrator must inspect and reconcile each such authorization; the migration never silently reroutes or refunds it.

## Reviews

New reviews reference a completed payment. The payer reviews that payment's actual provider, including on a request listing. A database trigger validates the relationship and locks the payment while inserting. A unique index prevents duplicate reviews of the same payment by the same payer. Browser write grants are removed; the authenticated API invokes the service-only submission function.

Legacy reviews remain readable with no payment reference and are not retroactively verified. The public profile offers specific eligible payments, supports completed transactions whose listings are no longer publicly visible, reports duplicate/failure responses, and discards stale results when the profile or signed-in account changes.

## Listing moderation

`owner_status` records the owner's active/sold/paused choice; `moderation_suspended` is a protected administrative hold. `status` remains the effective public state, preserving existing search and payment filters.

Database permissions and a trigger prevent an owner from releasing a hold, forging protected columns, replacing identity, deleting a held listing, or bypassing the hold through an upsert. Normal pause/resume remains available. Administrative suspension/release and its moderation log are one transaction.

Historical suspended listings have no reliable actor information. They are migrated as both paused and held. Releasing their administrative hold leaves them paused until the owner deliberately resumes them. A sold listing returns to sold when a later hold is released.

## Database rollout

Applied in this order after the repository's existing migrations; do not replay them:

1. `20261019120100_request_offer_transactions.sql`
2. `20261019120200_review_eligibility.sql`
3. `20261019120300_listing_moderation.sql`

The remote versions are respectively `20261019141954`, `20261019142006` and `20261019142018`; [SETUP.md](SETUP.md) records their local-file mapping. The first connector call expired before execution; both migration history and schema were checked to confirm no application before retrying successfully.

Preflight confirmed the expected old function signatures, absence of the new columns, no explicit review column write grants, no active client transactions, and no local app listener on ports 3002/3102. There were eight active listings and no payments, milestones or reviews. The ignored `supabase/.temp/audit-rollout-20261019-before.json` retains affected schema definitions, policies, grants and aggregate counts, not a full database/data backup. The corresponding `audit-rollout-20261019-after.json` retains verification evidence.

Live postflight confirmed all six business RPCs are security invoker with an empty search path, executable by `service_role` and denied to browser roles. Review browser writes and protected listing-column writes are denied; permitted owner fields remain writable. Both new triggers, existing confirmation guards, foreign keys, unique indexes and the moderation visibility constraint are active. All eight listings remain active with no hold; visibility and legacy-role quarantine invariant violations are zero. No financial/review rows were created. Three service-role validation calls rejected nonexistent listings/payments as expected inside a rolled-back transaction.

Security-advisor findings are unchanged, including the existing PostGIS table/extension, legacy function and GraphQL exposure notices, and Auth leaked-password-protection warning. These migrations do not claim to resolve that separate backlog; see [LOCAL_REPAIR_STATUS.md](LOCAL_REPAIR_STATUS.md) and the [Supabase database advisor guidance](https://supabase.com/docs/guides/database/database-advisors).

The database now supports the repaired local application. For application deployment, coordinate the switch with transaction writes paused: the old app does not enforce the legacy authorization capture hold. Verify the authenticated request/offer, review and moderation flows before reopening transaction writes. This database rollout did not publish an application release or complete a live Stripe checkout.

Rollback is not a blind migration reversal: removing the review/moderation protections or running the old capture route would restore the original defects. Retain protected data and holds; prefer a forward fix. Never alter historical Stripe destinations to make old rows fit new role semantics.

## Further audit corrections

- The profile dashboard tab now renders inside the returned UI and follows URL changes. It uses actual recent listings/reviews and links to management pages. The four profile cards show exact counts for active listings, conversations, received reviews and unread notifications. Requests and cached results are scoped to the signed-in account; unavailable data is not displayed as fabricated totals. Mock finance widgets are no longer used on this path. Saved items are explicitly unavailable until that feature exists.
- The listing-description helper uses deterministic local extraction, recognizes Greek/English request and offer intent, and never invents TV model, size or price. Uncertain intent and amounts remain for manual completion. Both form consumers preserve review/editing before an explicit publish action. Tag buttons cannot accidentally submit the form. The UI describes local extraction accurately.
- New transaction/review/moderation/profile messages include Greek support. This does not claim that every unrelated legacy screen has been translated.
- About now explains the actual marketplace. Terms/Privacy no longer display the current day as a fictitious revision date. At the founder's request, separate [Greek legal drafts and launch notes](legal/README.md) were prepared from official sources and actual application behavior. The proposed company is not presented as already formed; final operator details, contact email, age policy and operational/legal controls remain to be finalized. The private provisional address is not in public app pages.

## Verification boundaries

The integration suite uses isolated PGlite PostgreSQL, actual repository schema/policies and the new migrations. The combined test exercises payment creation as `service_role`, request/offer party validation, proposal funding/retry, completed-payment review, and moderation blocking payment creation. Separate tests exercise browser permissions, forged writes, duplicate reviews and failed-audit rollback.

Automated Stripe calls use mocks. A live connected-account checkout/webhook/refund cycle and independent multi-session PostgreSQL concurrency have not been verified in this repair. Existing setup notes describe the separate Stripe Connect prerequisite.

Fresh combined checks after integration:

- Vitest: **97 files / 564 tests passed**. The first full run found three old fixtures using the former button label and non-UUID/non-RPC moderation mocks; the fixtures were updated to the new contract and the complete suite passed on rerun.
- Database integration: **13 cases passed**. The combined request/offer test was additionally rerun with the actual payment update policies, service-role execution and an authenticated attempt to clear the legacy-review flag; all assertions passed.
- TypeScript `--noEmit --pretty false --incremental false`: passed.
- Repository-wide ESLint `--quiet`: passed with no errors; existing warning-level findings are not claimed resolved. The three final fixture changes also passed scoped lint.
- Production `next build --webpack`: passed, including its final TypeScript check and page generation.
- Built-server smoke checks: `/about`, `/terms`, `/privacy` and `/profile?tab=dashboard` returned 200 with Greek server-rendered markup; the new payment-context endpoint returned 401 without authentication. The temporary localhost server was stopped afterward. These are rendering/auth-boundary checks, not a signed-in browser payment walkthrough.

Verification used the existing portable Node 24.21.0 runtime. The machine's default `node` is older than the project's engines requirement; use the portable runtime directory first in the process PATH for child tools as well.

Build limitation: the initial sandboxed Turbopack build could not fetch the existing Noto Sans font. With network access, Turbopack failed at its PostCSS worker startup with an internal child-process/socket error; explicitly fixing the child PATH did not resolve it. The supported Webpack build succeeded with the same source. The default `next build` Turbopack path is therefore not claimed fixed, and no package/configuration switch was made. Local HTTP smoke reads also required execution outside the sandbox because it blocked even localhost connections with `EACCES`.
