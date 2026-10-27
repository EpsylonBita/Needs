import { getProviderPayment, lifecycleRpc, reconcilePayment, releaseClaimedPayment } from './lifecycle'
import { resumeApprovedRecovery } from './recovery'

type ReconciliationLease = { payment_id: string; intent_id: string; lease_id: string }

/** The database leases bounded work; only an already-approved cancellation is retried. */
export async function reconcilePaymentBatch() {
  const leases = await lifecycleRpc('claim_order_reconciliation', { p_limit: 2, p_lease_seconds: 180 })
  if (!Array.isArray(leases) || leases.length > 2) throw new Error('Invalid reconciliation queue')
  let completed = 0
  let failed = 0
  // Two provider reads at a time, not an unbounded fan-out over financial rows.
  for (let offset = 0; offset < leases.length; offset += 2) {
    await Promise.all(leases.slice(offset, offset + 2).map(async (lease: ReconciliationLease) => {
      let errorCode: string | null = null
      try {
        if (!lease?.payment_id || !lease.lease_id || !lease.intent_id) throw new Error('Invalid lease')
        const payment = await getProviderPayment(lease.payment_id)
        if (payment.stripe_payment_intent !== lease.intent_id) throw new Error('Lease intent mismatch')
        if (payment.cancel_claim_id && !payment.stripe_canceled_at) {
          const outcome = await releaseClaimedPayment(payment, {
            payment_id: payment.id, intent_id: lease.intent_id,
            claim_id: payment.cancel_claim_id, status: 'claimed',
          }, lease.lease_id)
          if (outcome.pending) errorCode = 'cancellation_pending'
        } else {
          await reconcilePayment(payment, lease.lease_id)
          // No new authority is created here: only an existing administrator
          // approval can retry its original transfer and stable idempotency key.
          const recovery = await resumeApprovedRecovery(payment.id, lease.lease_id)
          if (recovery.pending || recovery.recovery?.status === 'review_required') errorCode = 'seller_recovery_pending'
        }
      } catch { errorCode = 'provider_reconciliation_failed' }
      try {
        const finished = await lifecycleRpc('finish_order_reconciliation', {
          p_payment_id: lease.payment_id, p_lease_id: lease.lease_id, p_error_code: errorCode,
        })
        if (finished !== true) throw new Error('Lease completion not persisted')
        if (errorCode) failed += 1
        else completed += 1
      } catch { failed += 1 }
    }))
  }
  return { claimed: leases.length, completed, failed }
}
