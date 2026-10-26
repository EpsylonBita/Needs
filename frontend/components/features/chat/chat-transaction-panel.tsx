'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useI18n } from '@/contexts/i18n-context'
import { supabase } from '@/lib/supabase/client'
import { withCsrfHeaders } from '@/lib/utils/csrf'

type PaymentContext = {
  listingId: string; chatId: string; buyerId: string; sellerId: string; currentProfileId: string;
  isFree: boolean; canPay: boolean; sellerOnboarded: boolean; paymentsEnabled: boolean; milestonesEnabled: boolean;
  title: string; amount: number; subCategory: string;
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
  },
  el: {
    loading: 'Φόρτωση στοιχείων πληρωμής…', contextSignIn: 'Συνδέσου για να δεις τα στοιχεία πληρωμής.',
    contextError: 'Δεν ήταν δυνατή η φόρτωση των στοιχείων πληρωμής.', contextInvalid: 'Δεν ήταν δυνατή η επαλήθευση των στοιχείων πληρωμής.',
    addMilestone: 'Προσθήκη σταδίου', title: 'Τίτλος σταδίου', amount: 'Ποσό', save: 'Αποθήκευση', saving: 'Αποθήκευση…',
    invalidMilestone: 'Συμπλήρωσε έναν τίτλο σταδίου και ένα θετικό ποσό', milestoneSignIn: 'Συνδέσου για να δημιουργήσεις ένα στάδιο',
    milestoneError: 'Το στάδιο δεν αποθηκεύτηκε', messageError: 'Το στάδιο αποθηκεύτηκε, αλλά το μήνυμα στη συνομιλία απέτυχε. Έλεγξε τα στάδια πριν δοκιμάσεις ξανά.',
    sessionChanged: 'Άλλαξε ο λογαριασμός σου. Άνοιξε ξανά τη συνομιλία πριν αποθηκεύσεις.',
  },
}

function responseError(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback
  const value = data as { error?: string | { message?: string }; message?: string }
  return (typeof value.error === 'string' ? value.error : value.error?.message) || value.message || fallback
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
  const current = useRef(false)
  const saveRequest = useRef<AbortController | null>(null)
  useLayoutEffect(() => {
    current.current = true
    return () => { current.current = false; saveRequest.current?.abort() }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      const session = await supabase.auth.getSession()
      if (controller.signal.aborted) return
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
        || !['isFree', 'canPay', 'sellerOnboarded', 'paymentsEnabled', 'milestonesEnabled'].every(key => typeof data[key] === 'boolean')) {
        throw new Error(copy.contextInvalid)
      }
      if (!controller.signal.aborted) { setTransaction(data); setContextError(null) }
    }
    void load().catch(failure => {
      if (!controller.signal.aborted) { setTransaction(null); setContextError(failure instanceof Error ? failure.message : copy.contextError) }
    })
    return () => controller.abort()
  }, [chatId, listingId, profileId, userId, copy])

  async function saveMilestone() {
    if (saving || !transaction?.canPay || transaction.isFree || !transaction.milestonesEnabled || !transaction.paymentsEnabled) return
    const milestoneTitle = title.trim()
    const milestoneAmount = Number(amount)
    if (!milestoneTitle || !Number.isFinite(milestoneAmount) || milestoneAmount <= 0) { setError(copy.invalidMilestone); return }
    const controller = new AbortController()
    saveRequest.current = controller
    const isCurrent = () => current.current && !controller.signal.aborted
    setSaving(true)
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
      if (isCurrent()) setError(created ? copy.messageError : failure instanceof Error ? failure.message : copy.milestoneError)
    } finally {
      if (isCurrent()) setSaving(false)
    }
  }

  const isRequest = transaction?.subCategory === 'Buy' || transaction?.subCategory === 'I want'
  const canCreateMilestone = !!transaction?.canPay && !transaction.isFree && transaction.milestonesEnabled && transaction.paymentsEnabled
  return <div className="space-y-3 border-b border-border p-4">
    {contextError && <p role="alert" className="text-sm text-destructive">{contextError}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!transaction && !contextError && <p role="status" className="text-sm text-muted-foreground">{copy.loading}</p>}
    {transaction && <div className="flex flex-wrap items-center gap-2">
      {transaction.isFree && <p className="w-full text-sm text-muted-foreground">{t('chat.freeExchange', locale === 'el' ? 'Συμφωνήστε τη δωρεάν παραχώρηση σε αυτή τη συνομιλία.' : 'Arrange the free exchange in this conversation.')}</p>}
      {transaction.canPay && !transaction.isFree && transaction.paymentsEnabled && transaction.sellerOnboarded && <Link href={`/payments/checkout/${encodeURIComponent(listingId)}?chatId=${encodeURIComponent(chatId)}`} className="inline-flex min-h-11 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">
        {isRequest ? t('chat.payProvider', locale === 'el' ? 'Πληρωμή παρόχου' : 'Pay provider') : t('chat.get', locale === 'el' ? 'Αγορά' : 'Get')}
      </Link>}
      {!transaction.isFree && !transaction.canPay && <p className="w-full text-sm text-muted-foreground">{isRequest
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
