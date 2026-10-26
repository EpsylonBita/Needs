import { stripe } from '@/lib/stripe/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { ErrorFactory, createValidationError } from '@/lib/utils/error-handler'

// This application uses the existing Accounts v1 destination-charge integration.
// A destination needs the transfers capability; a platform account ID alone is
// not evidence that a seller has finished Connect onboarding.
export async function requireTransferCapability(accountId: string) {
  const account = await stripe.accounts.retrieve(accountId)
  if ('deleted' in account || account.capabilities?.transfers !== 'active') {
    throw createValidationError('listingId', 'Seller must complete Stripe payout setup before accepting payments')
  }
  return account
}

export async function syncConnectedAccount(accountId: string) {
  const account = await stripe.accounts.retrieve(accountId)
  if ('deleted' in account) throw ErrorFactory.businessLogic('Payout account is no longer available')
  const transfersEnabled = account.capabilities?.transfers === 'active'
  const ready = account.details_submitted && transfersEnabled && account.payouts_enabled
  const { error } = await supabaseAdmin.from('profiles').update({
    stripe_onboarding_complete: ready,
    stripe_charges_enabled: account.charges_enabled,
    stripe_payouts_enabled: account.payouts_enabled,
    stripe_details_submitted: account.details_submitted,
    stripe_account_type: account.type,
  }).eq('stripe_account_id', account.id)
  if (error) throw ErrorFactory.database('Could not update payout account status')
  return {
    ready, transfersEnabled, chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled, detailsSubmitted: account.details_submitted,
  }
}
