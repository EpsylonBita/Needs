import { createHash } from 'node:crypto'
import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { ErrorFactory } from '@/lib/utils/error-handler'
import { getProviderPayment, lifecycleRpc, LifecycleConflict } from './lifecycle'
import type { ProviderPayment } from './provider-state'

const providerOptions = { timeout: 8_000, maxNetworkRetries: 0 }
const reference = (value: string | { id: string } | null | undefined) => typeof value === 'string' ? value : value?.id || null
const cents = (value: unknown) => {
  const result = Number(value) * 100
  if (!Number.isSafeInteger(Math.round(result)) || Math.abs(result - Math.round(result)) > 0.000001) throw new RecoveryBlocked('amount_mismatch')
  return Math.round(result)
}

export type RecoveryRow = {
  id: string; payment_id: string; approved_by: string; reason: string; preview_version: string
  stripe_platform_id: string; livemode: boolean; stripe_intent_id: string; stripe_charge_id: string
  stripe_dispute_id: string; stripe_transfer_id: string; stripe_account_id: string; stripe_fee_id: string | null
  gross_amount_minor: number; fee_amount_minor: number; currency: string
  stripe_destination_payment_id: string | null; original_amount_minor: number; original_currency: string
  original_requested_fee_minor: number; original_fee_amount_minor: number | null; original_fee_currency: string | null
  status: 'pending' | 'completed' | 'review_required'; approved_at: string; completed_at: string | null
  stripe_reversal_id: string | null; last_error_code: string | null
}
type Snapshot = {
  platformId: string; livemode: boolean; intentId: string; chargeId: string; disputeId: string
  transferId: string; accountId: string; feeId: string | null; grossAmountMinor: number; feeAmountMinor: number
  currency: string; disputeStatus: string; checkedAt: string; version: string
  destinationPaymentId: string; originalAmountMinor: number; originalCurrency: string; originalRequestedFeeMinor: number
  originalFeeAmountMinor: number | null; originalFeeCurrency: string | null
}
type Facts = {
  snapshot: Snapshot; intent: Stripe.PaymentIntent; charge: Stripe.Charge; dispute: Stripe.Dispute
  transfer: Stripe.Transfer; fee: Stripe.ApplicationFee | null; reversals: Stripe.TransferReversal[]
  refunds: Stripe.Refund[]; feeRefunds: Stripe.FeeRefund[]; destinationPayment: Stripe.Charge
}
const messages: Record<string, string> = {
  provider_unavailable: 'Δεν ολοκληρώθηκε ο έλεγχος στη Stripe. Δοκίμασε ξανά.',
  payment_mismatch: 'Τα στοιχεία της αρχικής πληρωμής χρειάζονται έλεγχο.',
  amount_mismatch: 'Το ποσό ή το νόμισμα δεν συμφωνεί με την αρχική πληρωμή.',
  dispute_history: 'Υπάρχουν πολλαπλές ή μη επαληθευμένες αμφισβητήσεις.',
  dispute_not_lost: 'Η τράπεζα δεν επιβεβαιώνει πλέον οριστική απώλεια. Απαιτείται έλεγχος.',
  refund_overlap: 'Υπάρχει επιστροφή ή αίτημα επιστροφής χρημάτων.',
  reversal_overlap: 'Υπάρχει άλλη αντιστροφή μεταφοράς ή επιστροφή προμήθειας.',
  account_changed: 'Ο λογαριασμός ή η λειτουργία Stripe άλλαξε από την έγκριση.',
  transfer_mismatch: 'Η αρχική μεταφορά στον πωλητή δεν μπορεί να επαληθευτεί.',
  fee_mismatch: 'Η αρχική προμήθεια δεν μπορεί να επαληθευτεί.',
  review_required: 'Η ανάκτηση χρειάζεται έλεγχο πριν από οποιαδήποτε νέα ενέργεια.',
  already_completed: 'Η ανάκτηση έχει ήδη επαληθευτεί ως ολοκληρωμένη.',
  settlement_currency: 'Το νόμισμα της μεταφοράς χρειάζεται χειροκίνητο έλεγχο. Υποστηρίζονται EUR, USD και GBP.',
}
class RecoveryBlocked extends Error { constructor(readonly code: string) { super(code) } }
class RecoveryPending extends Error {}
function requireFact(condition: unknown, code: string): asserts condition { if (!condition) throw new RecoveryBlocked(code) }

export async function recoveryForPayment(paymentId: string): Promise<RecoveryRow | null> {
  const { data, error } = await supabaseAdmin.from('payment_recoveries').select('*').eq('payment_id', paymentId).maybeSingle()
  if (error) throw ErrorFactory.database('Recovery authorization could not be read')
  return data as RecoveryRow | null
}

async function localFacts(payment: ProviderPayment, recovery: RecoveryRow | null) {
  const [{ data: row, error }, { data: disputes, error: disputeError }, { data: refunds, error: refundError }] = await Promise.all([
    supabaseAdmin.from('payments').select('refund_claim_id,capture_claim_id,cancel_claim_id,stripe_canceled_at,status').eq('id', payment.id).single(),
    supabaseAdmin.from('disputes').select('stripe_dispute_id,status,amount,currency').eq('payment_id', payment.id).limit(2),
    supabaseAdmin.from('transactions').select('id').eq('payment_id', payment.id).eq('type', 'refund').limit(1),
  ])
  if (error || disputeError || refundError) throw ErrorFactory.database('Recovery history could not be verified')
  requireFact(row && !row.refund_claim_id && refunds?.length === 0, 'refund_overlap')
  requireFact(!row.capture_claim_id && !row.cancel_claim_id && !row.stripe_canceled_at, 'payment_mismatch')
  requireFact(disputes?.length === 1 && disputes[0].stripe_dispute_id, 'dispute_history')
  requireFact(disputes[0].status === 'lost' && row.status === 'refunded', 'dispute_not_lost')
  requireFact(cents(disputes[0].amount) === cents(payment.amount) && disputes[0].currency === payment.currency, 'amount_mismatch')
  if (recovery) requireFact(disputes[0].stripe_dispute_id === recovery.stripe_dispute_id, 'dispute_history')
  return disputes[0].stripe_dispute_id as string
}

/** Current provider facts, bound to the original charge, never a mutable profile. */
async function providerFacts(payment: ProviderPayment): Promise<Facts> {
  const checkedAt = new Date().toISOString()
  const [platform, intent] = await Promise.all([
    stripe.accounts.retrieve(null, {}, providerOptions),
    stripe.paymentIntents.retrieve(payment.stripe_payment_intent!, { expand: ['latest_charge'] }, providerOptions),
  ])
  const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null
  const amount = cents(payment.amount), feeAmount = cents(payment.platform_fee || 0)
  requireFact(intent.id === payment.stripe_payment_intent && intent.status === 'succeeded' && intent.capture_method === 'manual'
    && intent.amount === amount && intent.amount_received === amount && intent.currency === 'eur' && intent.currency === payment.currency
    && (intent.application_fee_amount || 0) === feeAmount && intent.metadata.listing_id === payment.listing_id
    && intent.metadata.buyer_profile_id === payment.buyer_id && intent.metadata.seller_profile_id === payment.seller_id, 'payment_mismatch')
  requireFact(charge && reference(charge.payment_intent) === intent.id && charge.amount === amount && charge.amount_captured === amount
    && charge.captured && charge.paid && charge.currency === intent.currency && charge.livemode === intent.livemode, 'payment_mismatch')
  const transferId = reference(charge.transfer), feeId = reference(charge.application_fee), accountId = reference(intent.transfer_data?.destination)
  requireFact(transferId && accountId && accountId !== platform.id, 'transfer_mismatch')
  requireFact(feeAmount ? !!feeId : !feeId, 'fee_mismatch')
  const [transfer, fee, disputes, refunds] = await Promise.all([
    stripe.transfers.retrieve(transferId, {}, providerOptions),
    feeId ? stripe.applicationFees.retrieve(feeId, {}, providerOptions) : Promise.resolve(null),
    stripe.disputes.list({ payment_intent: intent.id, limit: 2 }, providerOptions),
    stripe.refunds.list({ payment_intent: intent.id, limit: 1 }, providerOptions),
  ])
  requireFact(reference(transfer.source_transaction) === charge.id && reference(transfer.destination) === accountId
    && Number.isSafeInteger(transfer.amount) && transfer.amount > 0 && transfer.livemode === intent.livemode, 'transfer_mismatch')
  requireFact(['eur', 'usd', 'gbp'].includes(transfer.currency), 'settlement_currency')
  if (fee) requireFact(fee.id === feeId && reference(fee.account) === accountId && reference(fee.originating_transaction) === charge.id
    && Number.isSafeInteger(fee.amount) && fee.amount > 0 && ['eur', 'usd', 'gbp'].includes(fee.currency) && fee.livemode === intent.livemode, 'fee_mismatch')
  requireFact(!disputes.has_more && disputes.data.length === 1, 'dispute_history')
  const dispute = disputes.data[0]
  requireFact(reference(dispute.payment_intent) === intent.id && reference(dispute.charge) === charge.id && dispute.livemode === intent.livemode, 'dispute_history')
  requireFact(dispute.amount === amount && dispute.currency === intent.currency, 'amount_mismatch')
  const destinationPaymentId = reference(transfer.destination_payment)
  requireFact(destinationPaymentId, 'transfer_mismatch')
  const [reversals, feeRefunds, destinationPayment] = await Promise.all([
    stripe.transfers.listReversals(transfer.id, { limit: 2 }, providerOptions),
    fee ? stripe.applicationFees.listRefunds(fee.id, { limit: 2 }, providerOptions) : Promise.resolve({ data: [] as Stripe.FeeRefund[], has_more: false }),
    stripe.charges.retrieve(destinationPaymentId, {}, { ...providerOptions, stripeAccount: accountId }),
  ])
  const settlementFee = destinationPayment.application_fee_amount || 0
  requireFact(destinationPayment.id === destinationPaymentId && reference(destinationPayment.source_transfer) === transfer.id
    && destinationPayment.amount === transfer.amount && destinationPayment.amount_captured === transfer.amount
    && destinationPayment.captured && destinationPayment.paid && destinationPayment.currency === transfer.currency
    && destinationPayment.livemode === intent.livemode && reference(destinationPayment.application_fee) === feeId, 'transfer_mismatch')
  requireFact(Number.isSafeInteger(settlementFee) && settlementFee >= 0 && settlementFee <= transfer.amount
    && (fee ? settlementFee > 0 && reference(fee.charge) === destinationPaymentId : settlementFee === 0), 'fee_mismatch')
  requireFact(!refunds.has_more && refunds.data.length === 0 && charge.amount_refunded === 0, 'refund_overlap')
  requireFact(!reversals.has_more && !feeRefunds.has_more, 'reversal_overlap')
  const base = { platformId: platform.id, livemode: intent.livemode, intentId: intent.id, chargeId: charge.id, disputeId: dispute.id,
    transferId: transfer.id, accountId, feeId, destinationPaymentId, grossAmountMinor: transfer.amount, feeAmountMinor: settlementFee,
    currency: transfer.currency, originalAmountMinor: amount, originalCurrency: intent.currency, originalRequestedFeeMinor: feeAmount,
    originalFeeAmountMinor: fee?.amount ?? null, originalFeeCurrency: fee?.currency ?? null, disputeStatus: dispute.status }
  const version = createHash('sha256').update(JSON.stringify({ ...base, transferReversed: transfer.amount_reversed,
    feeRefunded: fee?.amount_refunded || 0, reversalIds: reversals.data.map(value => value.id), feeRefundIds: feeRefunds.data.map(value => value.id) })).digest('hex')
  return { snapshot: { ...base, checkedAt, version }, intent, charge, dispute, transfer, fee, destinationPayment, reversals: reversals.data, refunds: refunds.data, feeRefunds: feeRefunds.data }
}

function bindApproval(facts: Facts, recovery: RecoveryRow) {
  const value = facts.snapshot
  requireFact(value.platformId === recovery.stripe_platform_id && value.livemode === recovery.livemode, 'account_changed')
  requireFact(value.intentId === recovery.stripe_intent_id && value.chargeId === recovery.stripe_charge_id
    && value.disputeId === recovery.stripe_dispute_id && value.transferId === recovery.stripe_transfer_id
    && value.accountId === recovery.stripe_account_id && value.feeId === recovery.stripe_fee_id
    && value.destinationPaymentId === recovery.stripe_destination_payment_id, 'transfer_mismatch')
  requireFact(value.grossAmountMinor === Number(recovery.gross_amount_minor) && value.feeAmountMinor === Number(recovery.fee_amount_minor)
    && value.currency === recovery.currency && value.originalAmountMinor === Number(recovery.original_amount_minor)
    && value.originalCurrency === recovery.original_currency && value.originalRequestedFeeMinor === Number(recovery.original_requested_fee_minor)
    && value.originalFeeAmountMinor === (recovery.original_fee_amount_minor === null ? null : Number(recovery.original_fee_amount_minor))
    && value.originalFeeCurrency === recovery.original_fee_currency, 'amount_mismatch')
}

function verifiedReversal(facts: Facts, recovery: RecoveryRow): string | null {
  if (!facts.transfer.amount_reversed && !facts.reversals.length && !facts.destinationPayment.amount_refunded && !(facts.fee?.amount_refunded || 0) && !facts.feeRefunds.length) return null
  requireFact(facts.reversals.length === 1, 'reversal_overlap')
  const reversal = facts.reversals[0]
  requireFact(reference(reversal.transfer) === recovery.stripe_transfer_id && reversal.amount === Number(recovery.gross_amount_minor)
    && reversal.currency === recovery.currency && !reversal.source_refund && reversal.metadata?.needs_recovery_id === recovery.id
    && reversal.metadata?.needs_payment_id === recovery.payment_id, 'reversal_overlap')
  if (facts.transfer.amount_reversed !== facts.transfer.amount || facts.destinationPayment.amount_refunded !== facts.destinationPayment.amount) throw new RecoveryPending('provider_settlement_pending')
  if (facts.fee) {
    if (!facts.fee.refunded || facts.fee.amount_refunded !== facts.fee.amount || facts.feeRefunds.length === 0) throw new RecoveryPending('provider_settlement_pending')
    requireFact(facts.feeRefunds.length === 1 && reference(facts.feeRefunds[0].fee) === facts.fee.id
      && facts.feeRefunds[0].amount === facts.snapshot.feeAmountMinor && facts.feeRefunds[0].currency === facts.snapshot.currency, 'fee_mismatch')
  }
  return reversal.id
}

function dto(payment: ProviderPayment, recovery: RecoveryRow | null, facts: Facts | null, codes: string[]) {
  const settledRecovery = recovery?.stripe_destination_payment_id ? recovery : null
  const gross = facts?.snapshot.grossAmountMinor ?? (settledRecovery ? Number(settledRecovery.gross_amount_minor) : null)
  const fee = facts?.snapshot.feeAmountMinor ?? (settledRecovery ? Number(settledRecovery.fee_amount_minor) : null)
  return { paymentId: payment.id, stripeDisputeId: facts?.snapshot.disputeId || recovery?.stripe_dispute_id || null,
    eligible: codes.length === 0 && (!recovery || recovery.status === 'pending'), blockedReasons: codes.map(code => messages[code] || messages.review_required),
    previewVersion: recovery?.preview_version || facts?.snapshot.version || null, currency: facts?.snapshot.currency || settledRecovery?.currency || null,
    grossAmountMinor: gross, feeAmountMinor: fee, sellerNetAmountMinor: gross !== null && fee !== null ? gross - fee : null,
    originalAmountMinor: cents(payment.amount), originalCurrency: payment.currency,
    originalFeeAmountMinor: facts?.snapshot.originalFeeAmountMinor ?? recovery?.original_fee_amount_minor ?? null,
    originalFeeCurrency: facts?.snapshot.originalFeeCurrency ?? recovery?.original_fee_currency ?? null,
    recovery: recovery ? { id: recovery.id, status: recovery.status, approvedAt: recovery.approved_at, completedAt: recovery.completed_at, lastErrorCode: recovery.last_error_code } : null }
}

export async function previewPaymentRecovery(paymentId: string) {
  const payment = await getProviderPayment(paymentId), recovery = await recoveryForPayment(paymentId)
  let facts: Facts | null = null
  const codes: string[] = []
  try {
    const bankId = await localFacts(payment, recovery)
    facts = await providerFacts(payment)
    requireFact(facts.dispute.id === bankId, 'dispute_history')
    if (recovery) bindApproval(facts, recovery)
    requireFact(facts.dispute.status === 'lost', 'dispute_not_lost')
    if (recovery) {
      verifiedReversal(facts, recovery)
      if (recovery.status !== 'pending') codes.push(recovery.status === 'completed' ? 'already_completed' : 'review_required')
    } else requireFact(facts.transfer.amount_reversed === 0 && facts.destinationPayment.amount_refunded === 0 && !facts.reversals.length && !(facts.fee?.amount_refunded || 0) && !facts.feeRefunds.length, 'reversal_overlap')
  } catch (error) { codes.push(error instanceof RecoveryBlocked ? error.code : 'provider_unavailable') }
  return dto(payment, recovery, facts, codes)
}

async function record(recovery: RecoveryRow, status: RecoveryRow['status'], code: string | null, reversalId: string | null = null, checkedAt = new Date().toISOString(), feeRefund: Stripe.FeeRefund | null = null) {
  return lifecycleRpc('record_payment_recovery', { p_recovery_id: recovery.id, p_status: status, p_reversal_id: reversalId, p_error_code: code, p_checked_at: checkedAt,
    p_fee_refund_id: feeRefund?.id ?? null, p_fee_refund_amount_minor: feeRefund?.amount ?? null, p_fee_refund_currency: feeRefund?.currency ?? null }) as Promise<RecoveryRow>
}

/** Never creates approval. Worker/admin retries can only resume a stored claim. */
export async function resumeApprovedRecovery(paymentId: string, leaseId: string | null = null) {
  let recovery = await recoveryForPayment(paymentId)
  if (!recovery || recovery.status !== 'pending') return { pending: false, recovery }
  const payment = await getProviderPayment(paymentId)
  let facts: Facts
  try {
    // Inspect provider settlement even if a late win changed local dispute state:
    // an already-performed reversal must remain in the financial ledger.
    facts = await providerFacts(payment); bindApproval(facts, recovery)
    const existing = verifiedReversal(facts, recovery)
    if (existing) {
      recovery = await record(recovery, 'completed', facts.dispute.status === 'lost' ? null : 'late_win_after_recovery', existing, facts.snapshot.checkedAt, facts.feeRefunds[0] || null)
      return { pending: false, recovery }
    }
    await localFacts(payment, recovery)
    requireFact(facts.dispute.status === 'lost', 'dispute_not_lost')
  } catch (error) {
    const blocked = error instanceof RecoveryBlocked
    recovery = await record(recovery, blocked ? 'review_required' : 'pending', blocked ? error.code : error instanceof RecoveryPending ? 'provider_settlement_pending' : 'provider_unavailable')
    return { pending: recovery.status === 'pending', recovery }
  }
  const permission = await lifecycleRpc('authorize_payment_recovery_attempt', { p_recovery_id: recovery.id,
    p_platform_id: facts.snapshot.platformId, p_livemode: facts.snapshot.livemode, p_lease_id: leaseId })
  if (permission?.allowed !== true) {
    if (permission?.reason === 'lease_lost') throw new LifecycleConflict('Recovery worker lease expired')
    if (permission?.reason === 'completed') return { pending: false, recovery: await recoveryForPayment(paymentId) }
    recovery = await record(recovery, 'review_required', 'dispute_not_lost')
    return { pending: false, recovery }
  }
  let reversalErrorCode = 'provider_reversal_pending'
  try {
    await stripe.transfers.createReversal(recovery.stripe_transfer_id, { amount: Number(recovery.gross_amount_minor),
      ...(Number(recovery.fee_amount_minor) ? { refund_application_fee: true } : {}),
      metadata: { needs_recovery_id: recovery.id, needs_payment_id: paymentId } },
    { ...providerOptions, idempotencyKey: `needs-recovery:${recovery.id}` })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'balance_insufficient') reversalErrorCode = 'insufficient_seller_balance'
    // Timeout, insufficient funds and an idempotency request still in progress
    // all retain the original authorization/key until current provider truth is read.
  }
  try {
    facts = await providerFacts(payment); bindApproval(facts, recovery)
    const reversal = verifiedReversal(facts, recovery)
    if (reversal) recovery = await record(recovery, 'completed', facts.dispute.status === 'lost' ? null : 'late_win_after_recovery', reversal, facts.snapshot.checkedAt, facts.feeRefunds[0] || null)
    else if (facts.dispute.status !== 'lost') recovery = await record(recovery, 'review_required', 'dispute_not_lost', null, facts.snapshot.checkedAt)
    else recovery = await record(recovery, 'pending', reversalErrorCode, null, facts.snapshot.checkedAt)
  } catch (error) {
    recovery = await record(recovery, error instanceof RecoveryBlocked ? 'review_required' : 'pending', error instanceof RecoveryBlocked ? error.code : error instanceof RecoveryPending ? 'provider_settlement_pending' : 'provider_unavailable')
  }
  return { pending: recovery.status === 'pending', recovery }
}

export async function executePaymentRecovery(paymentId: string, adminUserId: string, version: string, reason: string) {
  const payment = await getProviderPayment(paymentId)
  let recovery = await recoveryForPayment(paymentId)
  if (!recovery) {
    try {
      const bankId = await localFacts(payment, null), facts = await providerFacts(payment)
      requireFact(facts.dispute.id === bankId && facts.dispute.status === 'lost', 'dispute_not_lost')
      requireFact(facts.transfer.amount_reversed === 0 && facts.destinationPayment.amount_refunded === 0 && !facts.reversals.length && !(facts.fee?.amount_refunded || 0) && !facts.feeRefunds.length, 'reversal_overlap')
      if (facts.snapshot.version !== version) throw new LifecycleConflict('Η προεπισκόπηση άλλαξε. Έλεγξε ξανά τα ποσά πριν από την έγκριση.')
      recovery = await lifecycleRpc('claim_payment_recovery', { p_payment_id: paymentId, p_admin_user_id: adminUserId, p_preview_version: version, p_reason: reason, p_snapshot: facts.snapshot })
    } catch (error) { if (error instanceof RecoveryBlocked) throw new LifecycleConflict(messages[error.code] || messages.review_required); throw error }
  }
  if (!recovery || recovery.preview_version !== version) throw new LifecycleConflict('Η έγκριση ανάκτησης άλλαξε. Ανανέωσε την προεπισκόπηση.')
  if (recovery.status === 'review_required') throw new LifecycleConflict(messages.review_required)
  const result = await resumeApprovedRecovery(paymentId)
  return { ...dto(payment, result.recovery, null, result.recovery?.status === 'review_required' ? ['review_required'] : result.recovery?.status === 'completed' ? ['already_completed'] : []), pending: result.pending }
}
