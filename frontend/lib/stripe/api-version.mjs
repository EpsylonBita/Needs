// Stripe SDK 23 and Stripe.js 10 (Endive). Keep one reviewed version for server
// requests, integration scripts and the local webhook-forwarding contract.
// https://docs.stripe.com/api/versioning
export const STRIPE_API_VERSION = '2026-09-30.endive';

export function stripeListenerArguments(origin) {
  const endpoint = `${origin}/api/payments/webhook`;
  return ['listen', '--skip-update', '--color', 'off', '--latest', '--events', [
    'account.updated', 'payment_intent.succeeded', 'payment_intent.payment_failed',
    'payment_intent.canceled', 'payment_intent.amount_capturable_updated',
    'charge.refunded', 'charge.dispute.created', 'charge.dispute.closed',
    'refund.created', 'refund.updated', 'refund.failed', 'transfer.created',
  ].join(','), '--forward-to', endpoint, '--forward-connect-to', endpoint];
}

export function stripeListenerReady(line) {
  const signingSecret = line.match(/whsec_[A-Za-z0-9]+/)?.[0];
  if (!signingSecret) return null;
  // `listen` cannot select an arbitrary API version. --latest plus this check
  // prevents an account default or future release silently changing the schema.
  const apiVersion = line.match(/Stripe API Version\s*\[([^\]]+)\]/i)?.[1];
  if (apiVersion !== STRIPE_API_VERSION) {
    throw new Error(`Stripe CLI webhook API version ${apiVersion || 'unknown'} does not match ${STRIPE_API_VERSION}. Review the SDK/API upgrade before starting payments.`);
  }
  return { apiVersion, signingSecret };
}
