"use client"

import { useEffect, useState } from 'react'
import { useI18n } from '@/contexts/i18n-context'
import { supabase } from '@/lib/supabase/client'

type CurrencyTotal = { currency: string; volume: number; fee: number }
type Overview = { totals: CurrencyTotal[]; activeListings: number; newUsers: number; openDisputes: number; recordedTransfers: number }
type OverviewState = { loading: boolean; data: Overview | null; error: string | null }
const validTotal = (value: unknown): value is CurrencyTotal => {
  if (!value || typeof value !== 'object') return false
  const total = value as Record<string, unknown>
  return typeof total.currency === 'string' && /^[A-Z]{3}$/.test(total.currency)
    && typeof total.volume === 'number' && Number.isFinite(total.volume) && total.volume >= 0
    && typeof total.fee === 'number' && Number.isFinite(total.fee) && total.fee >= 0
}

export default function AdminOverviewPage() {
  const { locale } = useI18n()
  const el = locale === 'el'
  const [state, setState] = useState<OverviewState>({ loading: true, data: null, error: null })
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let disposed = false
    let current: AbortController | null = null
    const run = async () => {
      if (disposed) return
      current?.abort()
      const controller = new AbortController()
      current = controller
      setState({ loading: true, data: null, error: null })
      const loadError = el ? 'Δεν ήταν δυνατή η φόρτωση της επισκόπησης. Δοκίμασε ξανά.' : 'The overview could not be loaded. Please try again.'
      try {
        const session = await supabase.auth.getSession()
        const token = session.data.session?.access_token
        if (session.error || !token) throw new Error(el ? 'Συνδέσου για να δεις την επισκόπηση.' : 'Sign in to view the overview.')
        const response = await fetch('/api/payments/admin/summary?year=all', { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
        if (response.status === 401 || response.status === 403) throw new Error(el ? 'Απαιτείται πρόσβαση διαχειριστή.' : 'Administrator access is required.')
        if (!response.ok) throw new Error(loadError)
        const summary = await response.json()
        if (!Array.isArray(summary.totals) || !summary.totals.every(validTotal)
          || new Set(summary.totals.map((row: CurrencyTotal) => row.currency)).size !== summary.totals.length) throw new Error(loadError)
        if (!['activeListings', 'newUsers', 'openDisputes', 'recordedTransfers'].every(key => Number.isSafeInteger(summary.overview?.[key]) && summary.overview[key] >= 0)) throw new Error(loadError)
        if (!controller.signal.aborted) setState({ loading: false, error: null, data: {
          totals: summary.totals, activeListings: summary.overview.activeListings, newUsers: summary.overview.newUsers,
          openDisputes: summary.overview.openDisputes, recordedTransfers: summary.overview.recordedTransfers,
        } })
      } catch (failure) {
        if (!controller.signal.aborted) setState({ loading: false, data: null, error: failure instanceof Error ? failure.message : loadError })
      }
    }
    void run()
    const channel = supabase.channel('admin-overview')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => void run())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'disputes' }, () => void run())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'listings' }, () => void run())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => void run())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => void run())
      .subscribe()
    return () => { disposed = true; current?.abort(); void supabase.removeChannel(channel) }
  }, [el, refresh])

  const money = (amount: number, currency: string) => new Intl.NumberFormat(el ? 'el-GR' : 'en', { style: 'currency', currency, currencyDisplay: 'code' }).format(amount)
  const data = state.data
  const counts = data ? [
    [el ? 'Ενεργές αγγελίες' : 'Active listings', data.activeListings],
    [el ? 'Νέοι χρήστες (30 ημέρες)' : 'New users (30 days)', data.newUsers],
    [el ? 'Ανοιχτές αμφισβητήσεις' : 'Open disputes', data.openDisputes],
    [el ? 'Καταγεγραμμένες μεταφορές' : 'Recorded transfers', data.recordedTransfers],
  ] as const : []

  return <div className="space-y-4">
    <h1 className="text-2xl font-bold">{el ? 'Επισκόπηση' : 'Overview'}</h1>
    {state.loading && <p role="status" className="text-muted-foreground">{el ? 'Φόρτωση επισκόπησης…' : 'Loading overview…'}</p>}
    {state.error && <div className="space-y-3"><p role="alert" className="text-destructive">{state.error}</p>
      <button type="button" className="min-h-11 rounded-md border px-4" onClick={() => setRefresh(value => value + 1)}>{el ? 'Δοκίμασε ξανά' : 'Try again'}</button></div>}
    {data && <>
      <p className="text-sm text-muted-foreground">{el
        ? 'Όλες οι καταστάσεις πληρωμών, μαζί με ακυρώσεις και επιστροφές. Τα ποσά είναι αιτούμενα, δεν είναι εισπραγμένα έσοδα. Κάθε νόμισμα εμφανίζεται χωριστά.'
        : 'All payment statuses, including cancellations and refunds. These are requested amounts, not collected revenue. Each currency is shown separately.'}</p>
      <div className="grid gap-4 md:grid-cols-3">
        {(['volume', 'fee'] as const).map(key => {
          const title = key === 'volume' ? (el ? 'Αιτούμενα ποσά πληρωμών' : 'Requested payment amounts') : (el ? 'Προμήθειες στα αιτούμενα ποσά' : 'Fees on requested amounts')
          return <section key={key} aria-label={title} className="rounded-md border p-4"><h2 className="text-sm">{title}</h2>
            {data.totals.length ? <ul className="mt-2 space-y-1">{data.totals.map(total => <li key={total.currency} className="text-2xl font-bold">{money(total[key], total.currency)}</li>)}</ul>
              : <p className="mt-2 text-muted-foreground">{el ? 'Δεν υπάρχουν εγγραφές πληρωμών.' : 'No payment records.'}</p>}</section>
        })}
        {counts.map(([title, count]) => <section key={title} aria-label={title} className="rounded-md border p-4"><h2 className="text-sm">{title}</h2><p className="mt-2 text-2xl font-bold">{count}</p></section>)}
      </div>
      <p className="text-xs text-muted-foreground">{el ? 'Οι καταγεγραμμένες μεταφορές περιλαμβάνουν και όσες αντιστράφηκαν αργότερα· δεν αποτελούν υπόλοιπο προς πληρωμή.' : 'Recorded transfers include transfers later reversed; this count is not a pending payout balance.'}</p>
    </>}
  </div>
}
