# NEEDS Auth email delivery — 19 October 2026

## Current status

Sign-in to the user-confirmed existing Resend account succeeded. The account is on **Resend Free**, with **3,000 emails per month / 100 per day** shown in the account and pay-as-you-go **off**. `getneeds.app` is verified for sending. Supabase custom SMTP and the Greek confirmation/recovery templates are **configured and verified**. The real confirmation message and two recovery messages reached the approved test recipient's **Gmail Inbox**, with successful sender-authentication checks. Confirmation and recovery-form entry passed in the browser. Password update through an actual received recovery link, old-password rejection and new-password sign-in passed through HTTP/SDK checks. The disposable test account was deleted and its sessions revoked. The approved private test alias is not recorded here.

After explicit user approval, the `NEEDS Supabase Auth` key was created with sending-only access restricted to `getneeds.app` and stored in Supabase SMTP. Its management identifier is `0c9eaa96-58af-43ea-92b4-85267ce7700c`; no key value is present in these documents. The temporary local key copy was removed after the successful configuration push and delivery checks. The key remains only in the approved Supabase configuration and at the provider.

The live application uses `https://getneeds.app`. Supabase Auth already allows the production confirmation and recovery callbacks, while retaining local development redirects. See [the domain deployment record](DOMAIN_DEPLOYMENT_2026-10-19.md). Correct callback configuration and a working public page do not establish email delivery.

## Verified sending domain and DNS

Resend domain `e555f5c9-4767-41c3-ab3a-a11b9f1f65fd` is configured in EU region `eu-west1`. The browser confirmed **Verified**, with a verification event at **15:05 UTC on 19 October 2026**. Sending is on, receiving is off, and tracking has not been configured.

Four records were added in Vercel DNS; the five existing records were preserved:

| Name under `getneeds.app` | Type | Value |
| --- | --- | --- |
| `resend._domainkey` | TXT | Resend-provided DKIM public key; omitted here |
| `rsend` | CNAME | `rsend-euw1.forge.rmta.net` |
| `send` | CNAME | `send.forge.rmta.net` |
| `_dmarc` | TXT | `v=DMARC1; p=none;` |

The site still returned HTTP **200** with successful TLS verification (`curl` result **0**) after these DNS changes. Domain verification does not prove that Auth emails are being sent.

## Configured templates

| Supabase Auth template | Local HTML | Subject |
| --- | --- | --- |
| Confirm signup | [confirmation.html](../supabase/templates/confirmation.html) | `NEEDS — Επιβεβαίωση λογαριασμού` |
| Reset password | [recovery.html](../supabase/templates/recovery.html) | `NEEDS — Επαναφορά κωδικού` |

Both templates are Greek, branded as NEEDS, contain only the requested account action, and include an ignore-if-not-requested note. They contain no private recipient information, marketing or assumed expiry period.

Both the button and the fallback link use Supabase's `{{ .ConfirmationURL }}` unchanged. Supabase generates the verification URL and carries the requested allowed redirect through it. Do not replace it with a direct application URL or append another `redirect_to` parameter. The application requests these destinations:

- Signup and resend confirmation: `https://getneeds.app/auth/confirm`.
- Password recovery: `https://getneeds.app/auth/reset-password`.

The templates do not override those destinations. Local development can still use its separately allowed callbacks.

The templates were copied inside an ignored temporary Supabase CLI workdir and published after reviewing the configuration preview. The inspected CLI version **2.120** supports template bodies through `content_path`, but its config diff omits those bodies. The successful Auth push reported **11 updated properties**, including both template bodies and subjects. Its secret-delivery summary included `auth.email.smtp.pass`, with no unsupported, unencodable, gated or unset entries. The secret was supplied privately without recording its value here.

The post-push diff reported **0 declared updates**, **0 local-only entries** and **12 preserved remote-only settings**, including redirects, confirmation settings, MFA and site URL. The push result confirms template publication; the diff alone is not evidence of template-body content.

## Send limit and SMTP settings

The send-rate-limit blocker was resolved. A second recovery-email request initially returned `over_email_send_rate_limit` while the remote `auth.rate_limit.email_sent` value was **2**. After explicit user approval, the official Supabase dashboard applied **30 emails per hour**, displayed the saved value and confirmed “Rate limits successfully updated”. The minimum interval remains **60 seconds**. The next recovery request succeeded, reached the Inbox and supplied the link used for the final password-update test.

The attempted minimal CLI configuration did not apply this change: CLI **2.120** classified the rate-only setting as unmanaged without local SMTP configuration, and enabling that configuration required a nonempty password. The dashboard update used the existing authenticated session without reading or re-entering the SMTP key. The saved dashboard setting is the evidence of the applied rate change.

| SMTP setting | Value |
| --- | --- |
| Host | `smtp.resend.com` |
| Port | `465` with SSL/TLS |
| Username | `resend` |
| Password | Privately stored Resend sending key |
| Sender name | `NEEDS` |
| Sender address | `noreply@getneeds.app` |

This task covers confirmation and password-recovery email. Contact-form notifications, their retry scheduler and marketing email are separate.

## Evidence

Local template checks passed for Greek language, unchanged Supabase action links and absence of remote assets or private recipient data. The existing Auth checks passed **28 tests**, and the verification script passed **8 tests**, including a fresh rerun of those eight script tests by the coordinating task.

A disposable live Auth fixture using `https://getneeds.app` passed generated-token confirmation and recovery, replay rejection, password update, old-password rejection, new-password sign-in and cleanup. This was an API-level check with generated tokens: it called no email-send API and did not test SMTP delivery or browser callback completion from a received message.

The script's password mutation and subsequent sign-in checks are now separately opt-in with `--verify-password-update`. Without that flag, it verifies links and cleans up the fixture without changing its password. With the flag, Supabase may generate a password-change notification depending on its configuration; the absence of an explicit send call is not a blanket guarantee that no provider notification can occur.

### Received confirmation and recovery emails

Both the signup-confirmation message and first password-recovery message showed **Delivered** in Resend and were independently found in the actual Gmail **Inbox**, not Spam. Their headers passed **SPF**, **DKIM with `getneeds.app`**, and **DMARC**. Greek subjects and content matched the configured templates. Their untracked Supabase verification URLs contained the correct allowed production redirects; no full action URLs or mailbox identifiers are recorded here.

The actual confirmation-email link opened `https://getneeds.app/auth/confirm` and rendered **“Your email has been confirmed”**. The administrator check also confirmed the temporary user's email-confirmed state. Returning to sign-in opened the correct temporary-user profile, and that browser session was then logged out.

Password recovery was requested through the public forgot-password interface, which displayed its success message. The first received recovery-email link opened `https://getneeds.app/auth/reset-password` and displayed the new-password and confirmation fields. **No password was entered in that browser form.** The subsequent request for the received-email password-update test encountered the rate limit described above.

After the approved rate change, the second recovery message—the third real message in this test—also showed **Delivered** in Resend and arrived in the Gmail **Inbox**, not Spam. All three messages—one confirmation and two recovery emails—therefore have provider-delivery and actual Inbox evidence. Its sender, Greek subject and content matched the configured template; **SPF**, **DKIM with `getneeds.app`**, and **DMARC** passed. Its untracked Supabase verification URL carried the exact production password-reset redirect.

The HTTP/SDK completion check consumed that actual received link, confirmed the production reset redirect and bound the recovery session to the exact disposable fixture. It verified **password changed**, **old password rejected**, **new password accepted**, and **sessions revoked**, with exit status **0**. This password update and subsequent sign-in were API checks, not password entry through the browser form. They are separate from the earlier generated-token test.

Final cleanup exited **0** and confirmed **account deleted**, **deletion verified**, **refresh sessions revoked**, and **private links removed**, with no warnings. The fixture password was removed. Browser test sessions had already been logged out, and no active browser fixture remains. No unrelated account was changed.

These results complete the requested Auth SMTP setup and verification. They establish real Inbox delivery, sender authentication, browser confirmation and recovery-form entry, and password update/sign-in through a received recovery link. No application deployment was needed for this SMTP configuration and template publication.
