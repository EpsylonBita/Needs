import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/server'
import { listingRequiresAgreedTotal } from '@/lib/listings/price-display'
import { ErrorFactory, createValidationError } from '@/lib/utils/error-handler'
import type { TradeListing } from './transaction-context'

export const AGREEMENT_REQUIRED = 'Agree on a total in this conversation before paying.'
export const AGREEMENT_CHANGED = 'The agreement changed. Refresh the conversation and try again.'
export const AGREEMENT_TERMS_CHANGED = 'The listing changed. Propose and accept a new total.'
export const AGREEMENT_LOCKED = 'This agreement is locked because checkout has started.'
export type ServiceListing = TradeListing & { title: string; description: string | null }
const agreementSchema = z.object({
  id: z.string().uuid(), listing_id: z.string().uuid(), chat_id: z.string().uuid(),
  buyer_id: z.string().uuid(), seller_id: z.string().uuid(), proposed_by: z.string().uuid(),
  accepted_by: z.string().uuid().nullable(), amount: z.coerce.number().min(0.5).max(999999.99),
  currency: z.literal('eur'), status: z.enum(['proposed', 'accepted', 'rejected', 'withdrawn', 'superseded']),
  created_at: z.string(), checkout_started_at: z.string().nullable(),
  listing_snapshot: z.object({ title: z.string(), description: z.string().nullable(), price: z.coerce.number().nullable(),
    main_category: z.string(), sub_category: z.string(), seller_id: z.string().uuid() }),
})
export type ServiceAgreement = z.infer<typeof agreementSchema>

export function serviceAgreementEligible(listing: ServiceListing) {
  return listing.main_category === 'Services' && listingRequiresAgreedTotal(listing.description)
}

export function agreementTermsChanged(agreement: ServiceAgreement, listing: ServiceListing) {
  const snapshot = agreement.listing_snapshot
  return snapshot.title !== listing.title || snapshot.description !== listing.description
    || Number(snapshot.price) !== Number(listing.price) || snapshot.main_category !== listing.main_category
    || snapshot.sub_category !== listing.sub_category || snapshot.seller_id !== listing.seller_id
}

/** Call only after validating the authenticated actor's active chat membership. */
export async function latestServiceAgreement(listingId: string, chatId: string) {
  const { data, error } = await supabaseAdmin.from('service_price_agreements')
    .select('id,listing_id,chat_id,buyer_id,seller_id,proposed_by,accepted_by,amount,currency,status,created_at,checkout_started_at,listing_snapshot')
    .eq('listing_id', listingId).eq('chat_id', chatId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle()
  if (error) throw ErrorFactory.database('Could not load service agreement')
  if (!data) return null
  const parsed = agreementSchema.safeParse(data)
  if (!parsed.success) throw ErrorFactory.database('Invalid service agreement data')
  return parsed.data
}

export function agreementContext(agreement: ServiceAgreement | null, listing: ServiceListing, actorId: string) {
  const eligible = serviceAgreementEligible(listing)
  const stale = !!agreement && agreementTermsChanged(agreement, listing)
  const unlocked = !agreement?.checkout_started_at
  return {
    serviceAgreementEligible: eligible,
    agreement: agreement ? { id: agreement.id, status: agreement.status, amount: agreement.amount, currency: agreement.currency,
      proposedBy: agreement.proposed_by, acceptedBy: agreement.accepted_by, createdAt: agreement.created_at,
      checkoutStartedAt: agreement.checkout_started_at, stale } : null,
    canProposeAgreement: eligible && unlocked,
    canAcceptAgreement: eligible && unlocked && !stale && agreement?.status === 'proposed' && agreement.proposed_by !== actorId,
    canRejectAgreement: eligible && unlocked && agreement?.status === 'proposed' && agreement.proposed_by !== actorId,
    canWithdrawAgreement: eligible && unlocked && !!agreement && ((agreement.status === 'proposed' && agreement.proposed_by === actorId) || agreement.status === 'accepted'),
  }
}

export function requireAcceptedAgreement(agreement: ServiceAgreement | null, listing: ServiceListing, agreementId: string, buyerId: string, sellerId: string) {
  if (!agreement || agreement.id !== agreementId || agreement.status !== 'accepted') throw createValidationError('agreementId', AGREEMENT_CHANGED)
  if (agreement.buyer_id !== buyerId || agreement.seller_id !== sellerId || !agreement.accepted_by || agreement.accepted_by === agreement.proposed_by) {
    throw ErrorFactory.authorization('You cannot pay for this agreement')
  }
  if (agreementTermsChanged(agreement, listing)) throw createValidationError('agreementId', AGREEMENT_TERMS_CHANGED)
  return agreement
}
