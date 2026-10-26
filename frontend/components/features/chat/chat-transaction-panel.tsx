'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useI18n } from '@/contexts/i18n-context'
import { supabase } from '@/lib/supabase/client'
import { withCsrfHeaders } from '@/lib/utils/csrf'
import { formatListingPriceUnit, RATE_PRICE_PAYMENT_ERROR, type ListingPriceUnit } from '@/lib/listings/price-display'
import { orderMoney } from '@/components/features/orders/order-copy'
import { paymentFlowError } from '@/components/features/payments/payment-flow-copy'

type ServiceAgreement = {
  id: string; status: 'proposed' | 'accepted' | 'rejected' | 'withdrawn' | 'superseded';
  amount: number; currency: 'eur'; proposedBy: string; acceptedBy: string | null;
  createdAt: string; checkoutStartedAt: string | null; stale: boolean;
}

type PaymentContext = {
  listingId: string; chatId: string; buyerId: string; sellerId: string; currentProfileId: string;
  isFree: boolean; canPay: boolean; sellerOnboarded: boolean; paymentsEnabled: boolean; milestonesEnabled: boolean;
  title: string; amount: number; subCategory: string;
  requiresAgreement?: boolean; priceUnit?: ListingPriceUnit | null;
  priceNeedsConfirmation?: boolean;
  serviceAgreementEligible?: boolean; agreement?: ServiceAgreement | null;
  canProposeAgreement?: boolean; canAcceptAgreement?: boolean; canRejectAgreement?: boolean; canWithdrawAgreement?: boolean;
}

export type ChatTransactionPanelProps = {
  chatId: string
  listingId: string | null
  profileId: string
  userId: string
  onSendMessage: (chatId: string, content: string) => Promise<void>
}

const messages = {
  en: {
    loading: 'Loading payment details…', contextSignIn: 'Sign in to view the payment details.',
    contextError: 'Payment details could not be loaded.', contextInvalid: 'Payment details could not be verified.',
    addMilestone: 'Add Milestone', title: 'Milestone title', amount: 'Amount', save: 'Save', saving: 'Saving…',
    invalidMilestone: 'Enter a milestone title and a positive amount', milestoneSignIn: 'Sign in to create a milestone',
    milestoneError: 'Milestone could not be saved', messageError: 'Milestone saved, but its chat message failed. Check Milestones before trying again.',
    sessionChanged: 'Your account changed. Open this conversation again before saving.',
    rate: 'Rate per unit', rateHint: 'Agree on the total cost in this conversation. This listing has a rate per unit, so it cannot yet be paid as a fixed total online.',
    priceNeedsConfirmation: 'Price needs confirmation',
    agreement: 'Total for this service', propose: 'Propose a total', newProposal: 'Propose another total', total: 'Total amount (€)',
    proposalHint: 'Include all agreed work in this amount. A new proposal replaces the previous one and needs the other person’s acceptance.',
    agreementHint: 'Propose the full cost below. Payment becomes available after the other person accepts.',
    sendProposal: 'Send proposal', cancel: 'Cancel', accept: 'Accept total', reject: 'Decline', withdraw: 'Withdraw',
    proposed: 'Awaiting acceptance', accepted: 'Total accepted', rejected: 'Proposal declined', withdrawn: 'Proposal withdrawn', superseded: 'Proposal replaced',
    waiting: 'Waiting for the other person to accept your proposal.', review: 'The other person proposed this total. Accept it only if it covers the agreed service.',
    stale: 'The listing changed after this proposal. Make a new proposal before paying.',
    checkoutLocked: 'Checkout has started. This total can no longer be changed here.',
    acceptedHint: 'The buyer can now pay this agreed total.',
    invalidAmount: 'Enter a total from €0.50 to €999,999.99 with up to two decimal places.',
    agreementError: 'The agreement could not be saved. Your draft is still here.',
    agreementSaved: 'Agreement saved.', savedRefreshError: 'Your change was saved, but its latest status could not be loaded. Refresh before trying again.',
    refresh: 'Refresh status', refreshing: 'Refreshing…', payTotal: 'Pay',
  },
  el: {
    loading: 'Φόρτωση στοιχείων πληρωμής…', contextSignIn: 'Συνδέσου για να δεις τα στοιχεία πληρωμής.',
    contextError: 'Δεν ήταν δυνατή η φόρτωση των στοιχείων πληρωμής.', contextInvalid: 'Δεν ήταν δυνατή η επαλήθευση των στοιχείων πληρωμής.',
    addMilestone: 'Προσθήκη σταδίου', title: 'Τίτλος σταδίου', amount: 'Ποσό', save: 'Αποθήκευση', saving: 'Αποθήκευση…',
    invalidMilestone: 'Συμπλήρωσε έναν τίτλο σταδίου και ένα θετικό ποσό', milestoneSignIn: 'Συνδέσου για να δημιουργήσεις ένα στάδιο',
    milestoneError: 'Το στάδιο δεν αποθηκεύτηκε', messageError: 'Το στάδιο αποθηκεύτηκε, αλλά το μήνυμα στη συνομιλία απέτυχε. Έλεγξε τα στάδια πριν δοκιμάσεις ξανά.',
    sessionChanged: 'Άλλαξε ο λογαριασμός σου. Άνοιξε ξανά τη συνομιλία πριν αποθηκεύσεις.',
    rate: 'Χρέωση ανά μονάδα', rateHint: 'Συμφωνήστε το συνολικό κόστος σε αυτή τη συνομιλία. Η αγγελία έχει χρέωση ανά μονάδα, οπότε δεν μπορεί ακόμη να πληρωθεί ως συνολικό ποσό online.',
    priceNeedsConfirmation: 'Η τιμή χρειάζεται επιβεβαίωση',
    agreement: 'Συνολικό ποσό υπηρεσίας', propose: 'Πρότεινε συνολικό ποσό', newProposal: 'Πρότεινε άλλο ποσό', total: 'Συνολικό ποσό (€)',
    proposalHint: 'Συμπερίλαβε όλη τη συμφωνημένη εργασία. Η νέα πρόταση αντικαθιστά την προηγούμενη και χρειάζεται αποδοχή από το άλλο άτομο.',
    agreementHint: 'Πρότεινε το συνολικό κόστος παρακάτω. Η πληρωμή ενεργοποιείται αφού το άλλο άτομο το αποδεχτεί.',
    sendProposal: 'Αποστολή πρότασης', cancel: 'Ακύρωση', accept: 'Αποδοχή ποσού', reject: 'Απόρριψη', withdraw: 'Ανάκληση',
    proposed: 'Αναμονή αποδοχής', accepted: 'Το ποσό έγινε αποδεκτό', rejected: 'Η πρόταση απορρίφθηκε', withdrawn: 'Η πρόταση ανακλήθηκε', superseded: 'Η πρόταση αντικαταστάθηκε',
    waiting: 'Περιμένεις την αποδοχή της πρότασής σου από το άλλο άτομο.', review: 'Το άλλο άτομο πρότεινε αυτό το ποσό. Αποδέξου το εφόσον καλύπτει τη συμφωνημένη υπηρεσία.',
    stale: 'Η αγγελία άλλαξε μετά την πρόταση. Κάντε νέα πρόταση πριν από την πληρωμή.',
    checkoutLocked: 'Η διαδικασία πληρωμής ξεκίνησε. Το ποσό δεν μπορεί πλέον να αλλάξει εδώ.',
    acceptedHint: 'Ο αγοραστής μπορεί τώρα να πληρώσει το συμφωνημένο ποσό.',
    invalidAmount: 'Συμπλήρωσε συνολικό ποσό από 0,50 € έως 999.999,99 € με έως δύο δεκαδικά ψηφία.',
    agreementError: 'Η συμφωνία δεν αποθηκεύτηκε. Το πρόχειρό σου παραμένει εδώ.',
    agreementSaved: 'Η συμφωνία αποθηκεύτηκε.', savedRefreshError: 'Η αλλαγή αποθηκεύτηκε, αλλά δεν φορτώθηκε η νεότερη κατάστασή της. Ανανέωσε πριν δοκιμάσεις ξανά.',
    refresh: 'Ανανέωση κατάστασης', refreshing: 'Ανανέωση…', payTotal: 'Πληρωμή',
  },
}

function responseError(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback
  const value = data as { error?: string | { message?: string }; message?: string }
  return (typeof value.error === 'string' ? value.error : value.error?.message) || value.message || fallback
}

function validAgreement(value: unknown, buyerId: string, sellerId: string): value is ServiceAgreement {
  if (!value || typeof value !== 'object') return false
  const agreement = value as ServiceAgreement
  const parties = [buyerId, sellerId]
  return typeof agreement.id === 'string' && !!agreement.id
    && ['proposed', 'accepted', 'rejected', 'withdrawn', 'superseded'].includes(agreement.status)
    && typeof agreement.amount === 'number' && Number.isFinite(agreement.amount) && agreement.amount >= 0.5 && agreement.amount <= 999999.99
    && Math.abs(agreement.amount * 100 - Math.round(agreement.amount * 100)) < 0.000001
    && agreement.currency === 'eur' && parties.includes(agreement.proposedBy)
    && (agreement.acceptedBy === null || (parties.includes(agreement.acceptedBy) && agreement.acceptedBy !== agreement.proposedBy))
    && (agreement.status !== 'accepted' || agreement.acceptedBy !== null)
    && typeof agreement.createdAt === 'string' && typeof agreement.stale === 'boolean'
    && (agreement.checkoutStartedAt === null || typeof agreement.checkoutStartedAt === 'string')
}

export function ChatTransactionPanel(props: ChatTransactionPanelProps) {
  if (!props.listingId || !props.chatId || !props.profileId || !props.userId) return null
  // A different account or conversation cannot inherit a pending form or result.
  return <TransactionContent key={`${props.userId}:${props.profileId}:${props.chatId}:${props.listingId}`} {...props} listingId={props.listingId} />
}

function TransactionContent({ chatId, listingId, profileId, userId, onSendMessage }: ChatTransactionPanelProps & { listingId: string }) {
  const { t, locale } = useI18n()
  const copy = messages[locale === 'el' ? 'el' : 'en']
  const [transaction, setTransaction] = useState<PaymentContext | null>(null)
  const [contextError, setContextError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showMilestoneForm, setShowMilestoneForm] = useState(false)
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [showAgreementForm, setShowAgreementForm] = useState(false)
  const [agreementAmount, setAgreementAmount] = useState('')
  const [expectedAgreementId, setExpectedAgreementId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const current = useRef(false)
  const savingRef = useRef(false)
  const transactionRef = useRef<PaymentContext | null>(null)
  const contextRequest = useRef<AbortController | null>(null)
  const saveRequest = useRef<AbortController | null>(null)
  useLayoutEffect(() => {
    current.current = true
    return () => { current.current = false; saveRequest.current?.abort(); contextRequest.current?.abort() }
  }, [])

  const loadContext = useCallback(async () => {
    contextRequest.current?.abort()
    const controller = new AbortController()
    contextRequest.current = controller
    const isCurrent = () => current.current && !controller.signal.aborted
    try {
      const session = await supabase.auth.getSession()
      if (!isCurrent()) return false
      setRefreshing(true)
      const token = session.data.session?.access_token
      if (session.error || !token) throw new Error(copy.contextSignIn)
      if (session.data.session?.user?.id !== userId) throw new Error(copy.sessionChanged)
      const query = new URLSearchParams({ listingId, chatId })
      const response = await fetch(`/api/payments/context?${query}`, {
        headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
      })
      const data = await response.json()
      if (!response.ok) throw new Error(responseError(data, copy.contextError))
      if (!data || data.listingId !== listingId || data.chatId !== chatId || data.currentProfileId !== profileId
        || typeof data.buyerId !== 'string' || typeof data.sellerId !== 'string'
        || !['isFree', 'canPay', 'sellerOnboarded', 'paymentsEnabled', 'milestonesEnabled'].every(key => typeof data[key] === 'boolean')
        || (data.requiresAgreement !== undefined && typeof data.requiresAgreement !== 'boolean')
        || (data.priceNeedsConfirmation !== undefined && typeof data.priceNeedsConfirmation !== 'boolean')
        || (data.priceUnit != null && !['hour', 'day', 'month'].includes(data.priceUnit))
        || !['serviceAgreementEligible', 'canProposeAgreement', 'canAcceptAgreement', 'canRejectAgreement', 'canWithdrawAgreement'].every(key => data[key] === undefined || typeof data[key] === 'boolean')
        || (data.agreement != null && !validAgreement(data.agreement, data.buyerId, data.sellerId))) {
        throw new Error(copy.contextInvalid)
      }
      if (!isCurrent()) return false
      transactionRef.current = data
      setTransaction(data)
      setContextError(null)
      return true
    } catch (failure) {
      if (isCurrent()) { transactionRef.current = null; setTransaction(null); setContextError(locale === 'el' ? paymentFlowError(failure instanceof Error ? failure.message : null, locale, 'loadError') : failure instanceof Error ? failure.message : copy.contextError) }
      return false
    } finally {
      if (isCurrent()) setRefreshing(false)
    }
  }, [chatId, listingId, profileId, userId, copy, locale])

  useEffect(() => {
    void loadContext()
    const refreshVisibleRate = () => {
      if (document.visibilityState === 'visible' && transactionRef.current?.requiresAgreement && !savingRef.current) void loadContext()
    }
    window.addEventListener('focus', refreshVisibleRate)
    document.addEventListener('visibilitychange', refreshVisibleRate)
    const interval = window.setInterval(refreshVisibleRate, 15000)
    return () => {
      contextRequest.current?.abort()
      window.removeEventListener('focus', refreshVisibleRate)
      document.removeEventListener('visibilitychange', refreshVisibleRate)
      window.clearInterval(interval)
    }
  }, [loadContext])

  async function saveAgreement(action: 'propose' | 'accept' | 'reject' | 'withdraw' | 'reconcile') {
    if (savingRef.current || !transaction || refreshing || (action !== 'reconcile' && !transaction.serviceAgreementEligible)) return
    const agreement = transaction.agreement
    const permitted = action === 'reconcile' ? !!agreement?.checkoutStartedAt : action === 'propose' ? transaction.canProposeAgreement : action === 'accept' ? transaction.canAcceptAgreement : action === 'reject' ? transaction.canRejectAgreement : transaction.canWithdrawAgreement
    if (!permitted || (action !== 'reconcile' && agreement?.checkoutStartedAt) || (action !== 'propose' && !agreement)) return
    const normalized = agreementAmount.trim().replace(',', '.')
    const proposedAmount = Number(normalized)
    if (action === 'propose' && (!/^\d+(?:\.\d{1,2})?$/.test(normalized) || !Number.isFinite(proposedAmount) || proposedAmount < 0.5 || proposedAmount > 999999.99)) { setError(copy.invalidAmount); return }
    const controller = new AbortController()
    saveRequest.current = controller
    const isCurrent = () => current.current && !controller.signal.aborted
    savingRef.current = true
    setSaving(true); setError(null); setNotice(null)
    try {
      const session = await supabase.auth.getSession()
      if (!isCurrent()) return
      const token = session.data.session?.access_token
      if (session.error || !token) throw new Error(copy.contextSignIn)
      if (session.data.session?.user?.id !== userId) throw new Error(copy.sessionChanged)
      const headers = await withCsrfHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` })
      if (!isCurrent()) return
      if (!headers['X-CSRF-Token']) throw new Error('Could not prepare a secure request. Refresh and try again.')
      const body = action === 'propose'
        ? { listingId, chatId, action, amount: proposedAmount, expectedAgreementId }
        : { listingId, chatId, action, agreementId: agreement!.id }
      const response = await fetch('/api/payments/agreements', { method: 'POST', headers, signal: controller.signal, body: JSON.stringify(body) })
      const result = await response.json().catch(() => null)
      if (!isCurrent()) return
      if (!response.ok || result?.ok !== true) throw new Error(responseError(result, copy.agreementError))
      if (action !== 'reconcile') { setShowAgreementForm(false); setAgreementAmount('') }
      const refreshed = await loadContext()
      if (isCurrent()) { if (refreshed && action !== 'reconcile') setNotice(copy.agreementSaved); else if (!refreshed) setError(copy.savedRefreshError) }
    } catch (failure) {
      if (isCurrent()) setError(paymentFlowError(failure instanceof Error ? failure.message : null, locale, 'agreementError'))
    } finally {
      if (isCurrent()) { savingRef.current = false; setSaving(false) }
    }
  }

  async function saveMilestone() {
    if (savingRef.current || !transaction?.canPay || transaction.requiresAgreement || transaction.isFree || !transaction.milestonesEnabled || !transaction.paymentsEnabled) return
    const milestoneTitle = title.trim()
    const milestoneAmount = Number(amount)
    if (!milestoneTitle || !Number.isFinite(milestoneAmount) || milestoneAmount <= 0) { setError(copy.invalidMilestone); return }
    const controller = new AbortController()
    saveRequest.current = controller
    const isCurrent = () => current.current && !controller.signal.aborted
    setSaving(true)
    savingRef.current = true
    setError(null)
    let created = false
    try {
      const session = await supabase.auth.getSession()
      if (!isCurrent()) return
      const token = session.data.session?.access_token
      if (session.error || !token) throw new Error(copy.milestoneSignIn)
      if (session.data.session?.user?.id !== userId) throw new Error(copy.sessionChanged)
      const headers = await withCsrfHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` })
      if (!isCurrent()) return
      const response = await fetch('/api/milestones/create', {
        method: 'POST', headers, signal: controller.signal,
        body: JSON.stringify({ listingId, title: milestoneTitle, amount: milestoneAmount, chatId }),
      })
      const result = await response.json().catch(() => null)
      if (!isCurrent()) return
      if (!response.ok) throw new Error(responseError(result, copy.milestoneError))
      created = true
      setShowMilestoneForm(false)
      setTitle('')
      setAmount('')
      await onSendMessage(chatId, `[MILESTONE] ${milestoneTitle} - ${milestoneAmount}`)
    } catch (failure) {
      if (isCurrent()) setError(created ? copy.messageError : failure instanceof Error ? failure.message === RATE_PRICE_PAYMENT_ERROR ? copy.rateHint : failure.message : copy.milestoneError)
    } finally {
      if (isCurrent()) { savingRef.current = false; setSaving(false) }
    }
  }

  const isRequest = transaction?.subCategory === 'Buy' || transaction?.subCategory === 'I want'
  const canCreateMilestone = !!transaction?.canPay && !transaction.requiresAgreement && !transaction.isFree && transaction.milestonesEnabled && transaction.paymentsEnabled
  const agreement = transaction?.agreement
  const acceptedAgreement = transaction?.serviceAgreementEligible && agreement?.status === 'accepted' && !agreement.stale ? agreement : null
  const canCheckout = transaction?.canPay && !transaction.isFree && transaction.paymentsEnabled && transaction.sellerOnboarded
    && (!transaction.requiresAgreement || !!acceptedAgreement)
  const checkoutQuery = new URLSearchParams({ chatId, ...(acceptedAgreement ? { agreementId: acceptedAgreement.id } : {}) })
  const agreementLocked = !!agreement?.checkoutStartedAt
  const canPropose = transaction?.canProposeAgreement && !agreementLocked
  const canReview = agreement?.status === 'proposed' && agreement.proposedBy !== profileId && !agreement.stale && !agreementLocked
  return <div className="space-y-3 border-b border-border p-4">
    {contextError && <p role="alert" className="text-sm text-destructive">{contextError}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    {(contextError || transaction?.requiresAgreement || agreementLocked) && <button type="button" disabled={saving || refreshing} onClick={() => { if (agreementLocked) void saveAgreement('reconcile'); else void loadContext() }} className="min-h-11 rounded-lg border border-border px-3 text-sm disabled:opacity-50">{refreshing || saving ? copy.refreshing : copy.refresh}</button>}
    {!transaction && !contextError && <p role="status" className="text-sm text-muted-foreground">{copy.loading}</p>}
    {transaction && <div className="flex flex-wrap items-center gap-2">
      {transaction.requiresAgreement && <div className="w-full space-y-1 text-sm"><p className="font-medium">{copy.rate}: {transaction.priceNeedsConfirmation || transaction.amount <= 0 ? copy.priceNeedsConfirmation : formatListingPriceUnit(transaction.amount, transaction.priceUnit || undefined, locale)}</p><p className="text-muted-foreground">{transaction.serviceAgreementEligible ? copy.agreementHint : copy.rateHint}</p></div>}
      {transaction.serviceAgreementEligible && <section aria-label={copy.agreement} className="w-full min-w-0 space-y-3 rounded-xl border border-border bg-muted/30 p-4" aria-busy={saving}>
        <h3 className="text-sm font-semibold">{copy.agreement}</h3>
        {agreement && <div className="space-y-2 text-sm">
          <p className="text-xl font-semibold">{orderMoney(agreement.amount, agreement.currency, locale)}</p>
          <p>{copy[agreement.status]}</p>
          {agreement.stale ? <p className="text-amber-800 dark:text-amber-200">{copy.stale}</p>
            : agreement.status === 'proposed' ? <p className="text-muted-foreground">{agreement.proposedBy === profileId ? copy.waiting : copy.review}</p>
              : agreement.status === 'accepted' && <p className="text-muted-foreground">{copy.acceptedHint}</p>}
          {agreementLocked && <p className="text-muted-foreground">{copy.checkoutLocked}</p>}
          <div className="flex flex-wrap gap-2">
            {canReview && transaction.canAcceptAgreement && <button type="button" disabled={saving || refreshing} onClick={() => { void saveAgreement('accept') }} className="min-h-11 rounded-lg bg-primary px-3 font-medium text-primary-foreground disabled:opacity-50">{copy.accept}</button>}
            {canReview && transaction.canRejectAgreement && <button type="button" disabled={saving || refreshing} onClick={() => { void saveAgreement('reject') }} className="min-h-11 rounded-lg border border-border px-3 disabled:opacity-50">{copy.reject}</button>}
            {!agreementLocked && transaction.canWithdrawAgreement && <button type="button" disabled={saving || refreshing} onClick={() => { void saveAgreement('withdraw') }} className="min-h-11 rounded-lg border border-border px-3 disabled:opacity-50">{copy.withdraw}</button>}
          </div>
        </div>}
        {canPropose && !showAgreementForm && <button type="button" disabled={saving || refreshing} onClick={() => { setExpectedAgreementId(agreement?.id || null); setShowAgreementForm(true); setError(null); setNotice(null) }} className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm font-medium disabled:opacity-50">{agreement ? copy.newProposal : copy.propose}</button>}
        {canPropose && showAgreementForm && <form onSubmit={event => { event.preventDefault(); void saveAgreement('propose') }} className="space-y-3">
          <label htmlFor="service-agreement-total" className="block text-sm font-medium">{copy.total}</label>
          <input id="service-agreement-total" inputMode="decimal" autoComplete="off" maxLength={12} value={agreementAmount} onChange={event => setAgreementAmount(event.target.value)} disabled={saving} aria-describedby="service-agreement-hint" className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base" />
          <p id="service-agreement-hint" className="text-sm text-muted-foreground">{copy.proposalHint}</p>
          <div className="flex flex-wrap gap-2"><button type="submit" disabled={saving || refreshing} className="min-h-11 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">{saving ? copy.saving : copy.sendProposal}</button><button type="button" disabled={saving} onClick={() => setShowAgreementForm(false)} className="min-h-11 rounded-lg border border-border px-3 text-sm disabled:opacity-50">{copy.cancel}</button></div>
        </form>}
      </section>}
      {transaction.isFree && <p className="w-full text-sm text-muted-foreground">{t('chat.freeExchange', locale === 'el' ? 'Συμφωνήστε τη δωρεάν παραχώρηση σε αυτή τη συνομιλία.' : 'Arrange the free exchange in this conversation.')}</p>}
      {canCheckout && <Link href={`/payments/checkout/${encodeURIComponent(listingId)}?${checkoutQuery}`} aria-disabled={saving || refreshing} onClick={event => { if (saving || refreshing) event.preventDefault() }} className="inline-flex min-h-11 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">
        {acceptedAgreement ? `${copy.payTotal} ${orderMoney(acceptedAgreement.amount, acceptedAgreement.currency, locale)}` : isRequest ? t('chat.payProvider', locale === 'el' ? 'Πληρωμή παρόχου' : 'Pay provider') : t('chat.get', locale === 'el' ? 'Αγορά' : 'Get')}
      </Link>}
      {!transaction.isFree && !transaction.requiresAgreement && !transaction.canPay && <p className="w-full text-sm text-muted-foreground">{isRequest
        ? t('chat.requesterPays', locale === 'el' ? 'Ο ενδιαφερόμενος σε πληρώνει αφού συμφωνήσετε για την εργασία ή το αντικείμενο.' : 'The requester pays you after you agree on the work or item.')
        : t('chat.buyerPays', locale === 'el' ? 'Ο αγοραστής μπορεί να προχωρήσει στην πληρωμή από τη συνομιλία του.' : 'The buyer can continue to payment from their conversation.')}</p>}
      <Link href={`/profile/${encodeURIComponent(transaction.currentProfileId === transaction.sellerId ? transaction.buyerId : transaction.sellerId)}`} className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm hover:bg-muted">{transaction.currentProfileId === transaction.sellerId
        ? t('chat.viewBuyer', locale === 'el' ? 'Προφίλ αγοραστή' : 'View Buyer')
        : t('chat.viewSeller', locale === 'el' ? 'Προφίλ παρόχου' : 'View Seller')}</Link>
      {!transaction.isFree && !transaction.paymentsEnabled && <p className="text-sm text-muted-foreground">{t('chat.paymentsDisabled', locale === 'el' ? 'Οι πληρωμές δεν είναι διαθέσιμες αυτή τη στιγμή.' : 'Payments are currently unavailable.')}</p>}
      {!transaction.isFree && transaction.paymentsEnabled && !transaction.sellerOnboarded && (transaction.currentProfileId === transaction.sellerId
        ? <Link href="/payments/onboarding" className="inline-flex min-h-11 items-center text-sm text-primary underline">{t('chat.setupPayments', locale === 'el' ? 'Ενεργοποίησε τη λήψη πληρωμών' : 'Set up receiving payments')}</Link>
        : <span className="rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-800 dark:text-amber-200">{t('chat.providerNotReady', locale === 'el' ? 'Ο πάροχος δεν έχει ενεργοποιήσει τις πληρωμές.' : 'The provider has not set up payments yet.')}</span>)}
      {canCreateMilestone && <button type="button" disabled={saving} onClick={() => setShowMilestoneForm(value => !value)} className="min-h-11 rounded-lg border border-border px-3 text-sm hover:bg-muted disabled:opacity-50">{copy.addMilestone}</button>}
    </div>}
    {showMilestoneForm && canCreateMilestone && <form onSubmit={event => { event.preventDefault(); void saveMilestone() }} className="grid min-w-0 gap-2 sm:grid-cols-[1fr_8rem_auto]">
      <input value={title} onChange={event => setTitle(event.target.value)} disabled={saving} aria-label={copy.title} className="min-h-11 min-w-0 rounded-lg border border-input bg-background p-2 text-sm text-foreground" placeholder={copy.title} />
      <input value={amount} onChange={event => setAmount(event.target.value)} disabled={saving} inputMode="decimal" aria-label={copy.amount} className="min-h-11 min-w-0 rounded-lg border border-input bg-background p-2 text-sm text-foreground" placeholder={copy.amount} />
      <button type="submit" disabled={saving} className="min-h-11 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">{saving ? copy.saving : copy.save}</button>
    </form>}
  </div>
}
