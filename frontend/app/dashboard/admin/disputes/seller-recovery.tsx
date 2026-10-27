'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { withCsrfHeaders } from '@/lib/utils/csrf'

type RecoveryPreview = {
  paymentId: string
  stripeDisputeId: string | null
  eligible: boolean
  blockedReasons: string[]
  previewVersion: string | null
  currency: string | null
  grossAmountMinor: number | null
  feeAmountMinor: number | null
  sellerNetAmountMinor: number | null
  originalAmountMinor: number
  originalCurrency: string
  originalFeeAmountMinor: number | null
  originalFeeCurrency: string | null
  recovery: {
    id: string
    status: 'pending' | 'completed' | 'review_required'
    approvedAt: string | null
    completedAt: string | null
    lastErrorCode: string | null
  } | null
}

type Props = { paymentId: string; stripeDisputeId: string; locale: string; onClose: () => void; onUpdated: () => void }

async function recoveryRequest(path: string, paymentId: string, stripeDisputeId: string, approval?: { previewVersion: string; reason: string }, signal?: AbortSignal) {
  const { data, error } = await supabase.auth.getSession()
  const expectedUserId = data.session?.user?.id
  const token = data.session?.access_token
  if (error || !expectedUserId || !token) throw new Error('Sign in again to review recovery.')
  const response = await fetch(path, { method: 'POST', body: JSON.stringify({ paymentId, expectedUserId, ...approval }), signal,
    headers: await withCsrfHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }) })
  const result = await response.json().catch(() => ({}))
  // A verified manual-review outcome is a conflict, but contains financial state
  // which must replace the stale approval form. Ordinary HTTP errors still fail.
  const reviewRequired = response.status === 409 && result.recovery?.status === 'review_required' && result.eligible === false
  if (!response.ok && !reviewRequired) {
    const message = typeof result.error === 'string' ? result.error : result.error?.message
    throw new Error(message || 'The recovery request could not be completed.')
  }
  const unboundBlockedPreview = !approval && !result.eligible && result.stripeDisputeId === null
  if (result.paymentId !== paymentId || (result.stripeDisputeId !== stripeDisputeId && !unboundBlockedPreview)) throw new Error('The recovery preview does not match this dispute.')
  if (!Array.isArray(result.blockedReasons)) throw new Error('The recovery preview could not be verified.')
  return result as RecoveryPreview
}

export default function SellerRecovery({ paymentId, stripeDisputeId, locale, onClose, onUpdated }: Props) {
  const el = locale === 'el'
  const [preview, setPreview] = useState<RecoveryPreview | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const load = async () => {
      setBusy(true)
      setError('')
      setPreview(null)
      setConfirmed(false)
      try {
        const result = await recoveryRequest('/api/admin/payments/recovery/preview', paymentId, stripeDisputeId, undefined, controller.signal)
        if (active) setPreview(result)
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load recovery preview.')
      } finally { if (active) setBusy(false) }
    }
    void load()
    return () => { active = false; controller.abort() }
  }, [paymentId, stripeDisputeId, refresh])

  const state = preview?.recovery?.status
  const settlementReady = Boolean(preview?.currency && ['eur', 'usd', 'gbp'].includes(preview.currency)
    && [preview.grossAmountMinor, preview.feeAmountMinor, preview.sellerNetAmountMinor].every(value => value !== null && Number.isSafeInteger(value) && value >= 0))
  const canApprove = Boolean(preview?.eligible && preview.previewVersion && settlementReady && (!state || state === 'pending'))
  const validReason = reason.trim().length >= 5 && reason.trim().length <= 1000
  const approve = async () => {
    if (busy || !preview?.previewVersion || !canApprove || !confirmed || !validReason) return
    setBusy(true)
    setError('')
    setConfirmed(false)
    try {
      const result = await recoveryRequest('/api/admin/payments/recovery/execute', paymentId, stripeDisputeId, { previewVersion: preview.previewVersion, reason: reason.trim() })
      if (!result.recovery) throw new Error(el ? 'Δεν έχει επιβεβαιωθεί η ανάκτηση. Ανανέωσε τον έλεγχο.' : 'Recovery has not been confirmed. Refresh the review.')
      setPreview(result)
      onUpdated()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (el ? 'Η ανάκτηση δεν έχει επιβεβαιωθεί.' : 'Recovery has not been confirmed.'))
    } finally { setBusy(false) }
  }
  const differentCurrencies = Boolean(preview?.currency && preview.currency !== preview.originalCurrency)
  const money = (value: number | null, currency = preview?.currency) => {
    if (value === null || !Number.isSafeInteger(value) || !currency || !['eur', 'usd', 'gbp'].includes(currency)) return el ? 'Μη διαθέσιμο' : 'Unavailable'
    // Executable settlement currencies are explicitly bounded to two decimals.
    return new Intl.NumberFormat(el ? 'el-GR' : 'en-IE', { style: 'currency', currency, currencyDisplay: differentCurrencies ? 'code' : 'symbol' }).format(value / 100)
  }

  return <section aria-label={el ? 'Έλεγχος ανάκτησης από πωλητή' : 'Seller recovery review'} className="mt-4 min-w-0 max-w-full rounded-md border p-4 [overflow-wrap:anywhere]" aria-busy={busy}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold">{el ? 'Ανάκτηση ποσού από πωλητή' : 'Seller funds recovery'}</h2>
        <p className="break-all text-sm text-muted-foreground">{stripeDisputeId}</p>
      </div>
      <button disabled={busy} onClick={onClose} className="shrink-0 rounded-md border px-3 py-1 disabled:opacity-50">{el ? 'Κλείσιμο' : 'Close'}</button>
    </div>
    <p className="mt-2 text-sm">{el ? 'Χειροκίνητη έγκριση μετά από επιβεβαιωμένη απώλεια τραπεζικής αμφισβήτησης. Δεν δημιουργεί νέα επιστροφή προς τον αγοραστή.' : 'Manual approval after a verified bank dispute loss. This does not create another customer refund.'}</p>
    {busy && <p aria-live="polite" className="mt-3">{el ? 'Έλεγχος…' : 'Checking…'}</p>}
    {error && <p role="alert" className="mt-3 text-destructive">{error}</p>}
    {preview && <>
      {(differentCurrencies || !preview.currency) && <dl className="mt-3 text-sm">
        <div><dt>{el ? 'Αρχική πληρωμή αγοραστή' : 'Original customer payment'}</dt><dd className="font-semibold">{money(preview.originalAmountMinor, preview.originalCurrency)}</dd></div>
        {preview.originalFeeAmountMinor !== null && preview.originalFeeCurrency && <div className="mt-1"><dt>{el ? 'Αρχική προμήθεια πληρωμής' : 'Original payment fee'}</dt><dd>{money(preview.originalFeeAmountMinor, preview.originalFeeCurrency)}</dd></div>}
      </dl>}
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <div><dt>{el ? 'Συνολική αντιστροφή μεταφοράς' : 'Gross transfer reversal'}</dt><dd className="font-semibold">{money(preview.grossAmountMinor)}</dd></div>
        <div><dt>{el ? 'Προμήθεια NEEDS που επιστρέφεται' : 'NEEDS fee returned'}</dt><dd className="font-semibold">{money(preview.feeAmountMinor)}</dd></div>
        <div><dt>{el ? 'Καθαρό ποσό από τον πωλητή' : 'Net seller recovery'}</dt><dd className="font-semibold">{money(preview.sellerNetAmountMinor)}</dd></div>
      </dl>
      {differentCurrencies && <p className="mt-2 text-sm">{el
        ? `Η αρχική μεταφορά προς τον πωλητή αντιστρέφεται σε ${preview.currency!.toUpperCase()}. Τα ποσά προέρχονται από τη Stripe, χωρίς εκτίμηση ισοτιμίας.`
        : `The original seller transfer is reversed in ${preview.currency!.toUpperCase()}. These amounts come from Stripe; no exchange rate is estimated.`}</p>}
      <p className="mt-2 text-sm text-muted-foreground">{el ? 'Δεν περιλαμβάνονται έξοδα επεξεργασίας ή τραπεζικής αμφισβήτησης.' : 'Processing and dispute fees are not included.'}</p>
      {state && <p role="status" className="mt-3 font-medium">{state === 'completed'
        ? (el ? 'Η ανάκτηση επιβεβαιώθηκε από τη Stripe.' : 'Recovery verified by Stripe.')
        : state === 'pending'
          ? (el ? 'Η ανάκτηση εκκρεμεί. Η ολοκλήρωση δεν έχει επιβεβαιωθεί.' : 'Recovery pending. Completion has not been confirmed.')
          : (el ? 'Απαιτείται χειροκίνητος έλεγχος. Η ανάκτηση δεν έχει επιβεβαιωθεί.' : 'Manual review required. Recovery is not confirmed.')}</p>}
      {preview.recovery?.lastErrorCode === 'late_win_after_recovery' && <p role="alert" className="mt-3 text-destructive">{el
        ? 'Το ποσό ανακτήθηκε, αλλά η τράπεζα άλλαξε την έκβαση της αμφισβήτησης. Απαιτείται χειροκίνητος έλεγχος πριν από οποιαδήποτε νέα μεταφορά.'
        : 'Funds were recovered, but the bank outcome changed. Manual review is required before any further transfer.'}</p>}
      {state === 'pending' && preview.recovery?.lastErrorCode === 'insufficient_seller_balance' && <p role="alert" className="mt-3">{el
        ? 'Το διαθέσιμο υπόλοιπο του πωλητή δεν επαρκεί. Η έγκριση παραμένει σε εκκρεμότητα και η ίδια ανάκτηση μπορεί να επαναληφθεί όταν υπάρχει επαρκές υπόλοιπο.'
        : 'The seller has insufficient available funds. Approval remains pending; the same recovery can retry when enough funds are available.'}</p>}
      {preview.blockedReasons.length > 0 && <ul className="mt-3 list-disc pl-5 text-sm">{preview.blockedReasons.map((message, index) => <li key={`${index}:${message}`}>{message}</li>)}</ul>}
      {canApprove && <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); void approve() }}>
        <div>
          <label htmlFor="recovery-reason" className="block text-sm font-medium">{el ? 'Αιτιολογία ανάκτησης' : 'Reason for recovery'}</label>
          <textarea id="recovery-reason" value={reason} onChange={event => { setReason(event.target.value); setConfirmed(false) }} minLength={5} maxLength={1000} required disabled={busy} className="mt-1 w-full rounded-md border border-input bg-background p-2" />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy} className="mt-1" />
          <span>{el ? `Επιβεβαιώνω την ανάκτηση ${money(preview.sellerNetAmountMinor)} από τον πωλητή για αυτή την αμφισβήτηση.` : `I confirm recovery of ${money(preview.sellerNetAmountMinor)} from the seller for this dispute.`}</span>
        </label>
        <button type="submit" disabled={busy || !confirmed || !validReason} className="rounded-md bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50">{state === 'pending' ? (el ? 'Επανάληψη εγκεκριμένης ανάκτησης' : 'Retry approved recovery') : (el ? 'Έγκριση ανάκτησης' : 'Approve recovery')}</button>
      </form>}
    </>}
    <button disabled={busy} onClick={() => setRefresh(value => value + 1)} className="mt-3 rounded-md border px-3 py-1 disabled:opacity-50">{el ? 'Ανανέωση ελέγχου' : 'Refresh review'}</button>
  </section>
}
