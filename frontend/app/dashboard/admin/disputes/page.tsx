'use client'

import { useEffect, useState } from 'react'
import { useI18n } from '@/contexts/i18n-context'
import { supabase } from '@/lib/supabase/client'
import { adminRequest } from '../admin-request'
import SellerRecovery from './seller-recovery'

type Status = 'all' | 'open' | 'resolved' | 'refunded' | 'rejected' | 'won' | 'lost'
type Dispute = {
  id: string; status: Exclude<Status, 'all'>; reason: string | null; payment_id: string
  stripe_dispute_id: string | null; amount: number | string | null; currency: string | null
}

export default function AdminDisputesPage() {
  const { locale } = useI18n()
  const el = locale === 'el'
  const [rows, setRows] = useState<Dispute[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [statusFilter, setStatusFilter] = useState<Status>('all')
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [refresh, setRefresh] = useState(0)
  const [recoveryDispute, setRecoveryDispute] = useState<Dispute | null>(null)
  const labels: Record<Status, string> = el
    ? { all: 'Όλες', open: 'Ανοιχτές', resolved: 'Επιλύθηκαν', refunded: 'Επιστροφή χρημάτων', rejected: 'Απορρίφθηκαν', won: 'Κερδισμένες', lost: 'Χαμένες' }
    : { all: 'All', open: 'Open', resolved: 'Resolved', refunded: 'Refunded', rejected: 'Rejected', won: 'Won', lost: 'Lost' }

  useEffect(() => {
    let active = true
    let sequence = 0
    const controller = new AbortController()
    const run = async () => {
      const request = ++sequence
      setLoading(true)
      setError('')
      try {
        const result = await adminRequest<{ rows: Dispute[]; total: number }>(
          `/api/admin/disputes/list?status=${statusFilter}&limit=20&offset=${page * 20}`,
          { signal: controller.signal },
        )
        if (active && request === sequence) {
          setRows(result.rows)
          setTotal(result.total)
        }
      } catch (cause) {
        if (active && request === sequence) {
          setRows([])
          setTotal(0)
          setError(cause instanceof Error ? cause.message : 'Unable to load disputes')
        }
      } finally {
        if (active && request === sequence) setLoading(false)
      }
    }
    void run()
    const channel = supabase.channel('admin-disputes').on('postgres_changes', { event: '*', schema: 'public', table: 'disputes' }, run).subscribe()
    return () => { active = false; controller.abort(); void supabase.removeChannel(channel) }
  }, [statusFilter, page, refresh])

  const act = async (dispute: Dispute, action: 'resolve' | 'refund') => {
    if (dispute.stripe_dispute_id || dispute.status !== 'open' || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await adminRequest<{ status?: string }>(`/api/payments/disputes/${dispute.id}/${action}`, { method: 'POST' })
      if (action === 'resolve') {
        setNotice(el ? 'Η καταγγελία επιλύθηκε.' : 'Complaint resolved.')
      } else if (result.status === 'pending' || result.status === 'requires_action') {
        setNotice(el ? 'Η επιστροφή εκκρεμεί. Η κατάσταση θα ενημερωθεί όταν επιβεβαιωθεί από τη Stripe.' : 'Refund pending. The status will update after Stripe confirms it.')
      } else {
        setNotice(el ? 'Υποβλήθηκε αίτημα επιστροφής. Ανανεώνεται η επιβεβαιωμένη κατάσταση.' : 'Refund requested. Refreshing verified status.')
      }
      setRefresh(value => value + 1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (el ? 'Η ενέργεια απέτυχε.' : 'The action failed.'))
    } finally {
      setBusy(false)
    }
  }

  const exportCsv = async () => {
    setBusy(true)
    setError('')
    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (sessionError || !token) throw new Error(el ? 'Συνδέσου ξανά για την εξαγωγή.' : 'Sign in again to export disputes.')
      const response = await fetch(`/api/admin/disputes/export?status=${statusFilter}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error((typeof body.error === 'string' ? body.error : body.error?.message) || (el ? 'Η εξαγωγή απέτυχε.' : 'Export failed.'))
      }
      const url = URL.createObjectURL(await response.blob())
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'disputes.csv'
        document.body.appendChild(link)
        link.click()
        link.remove()
      } finally { URL.revokeObjectURL(url) }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (el ? 'Η εξαγωγή απέτυχε.' : 'Export failed.'))
    } finally { setBusy(false) }
  }

  const amount = (dispute: Dispute) => {
    if (dispute.amount === null || !dispute.currency || !Number.isFinite(Number(dispute.amount))) return '—'
    try { return new Intl.NumberFormat(el ? 'el-GR' : 'en-IE', { style: 'currency', currency: dispute.currency }).format(Number(dispute.amount)) }
    catch { return `${dispute.amount} ${dispute.currency.toUpperCase()}` }
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-full sm:p-4">
      <h1 className="break-words text-2xl font-bold">{el ? 'Αμφισβητήσεις και καταγγελίες' : 'Disputes'}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label htmlFor="dispute-status">{el ? 'Κατάσταση' : 'Status'}</label>
        <select id="dispute-status" value={statusFilter} disabled={busy} onChange={event => { setStatusFilter(event.target.value as Status); setPage(0); setNotice('') }} className="border border-input bg-background text-foreground rounded-md p-2">
          {(Object.keys(labels) as Status[]).map(status => <option key={status} value={status}>{labels[status]}</option>)}
        </select>
        <button disabled={busy || loading} onClick={() => void exportCsv()} className="px-3 py-1 rounded-md bg-secondary text-secondary-foreground disabled:opacity-50">{el ? 'Εξαγωγή CSV' : 'Export CSV'}</button>
        <button disabled={busy || loading} onClick={() => setRefresh(value => value + 1)} className="px-3 py-1 rounded-md bg-secondary text-secondary-foreground disabled:opacity-50">{error ? (el ? 'Δοκίμασε ξανά' : 'Retry') : (el ? 'Ανανέωση' : 'Refresh')}</button>
      </div>
      {error && <p role="alert" className="mt-3 text-destructive">{error}</p>}
      {notice && <p role="status" className="mt-3">{notice}</p>}
      {loading && <p aria-live="polite" className="mt-3">{el ? 'Φόρτωση…' : 'Loading…'}</p>}
      <div className="mt-4 min-w-0 max-w-full overflow-x-auto border rounded-md">
        <table className="w-full min-w-[640px] text-sm" aria-busy={loading}>
          <thead>
            <tr className="text-left"><th className="p-2">ID</th><th className="p-2">{el ? 'Τύπος' : 'Type'}</th><th className="p-2">{el ? 'Κατάσταση' : 'Status'}</th><th className="p-2">{el ? 'Ποσό' : 'Amount'}</th><th className="p-2">{el ? 'Αιτία' : 'Reason'}</th><th className="p-2">{el ? 'Ενέργειες' : 'Actions'}</th></tr>
          </thead>
          <tbody>
            {rows.map(dispute => (
              <tr key={dispute.id} className="border-t">
                <td className="p-2">{dispute.id}{dispute.stripe_dispute_id && <span className="block text-xs text-muted-foreground">{dispute.stripe_dispute_id}</span>}</td>
                <td className="p-2">{dispute.stripe_dispute_id ? (el ? 'Τραπεζική αμφισβήτηση' : 'Bank dispute') : (el ? 'Καταγγελία NEEDS' : 'Marketplace complaint')}</td>
                <td className="p-2">{labels[dispute.status] || dispute.status}</td>
                <td className="p-2 whitespace-nowrap">{amount(dispute)}</td>
                <td className="p-2">{dispute.reason || '—'}</td>
                <td className="p-2">
                  {dispute.stripe_dispute_id ? <div className="space-y-2">
                    <span className="block text-muted-foreground">{el ? 'Η διαχείριση αυτής της αμφισβήτησης γίνεται στη Stripe.' : 'Manage this bank dispute in Stripe.'}</span>
                    <button disabled={busy || loading} onClick={() => setRecoveryDispute(dispute)} className="rounded-md border px-3 py-1 disabled:opacity-50">{el ? 'Έλεγχος ανάκτησης από πωλητή' : 'Review seller recovery'}</button>
                  </div> : dispute.status === 'open' ? <div className="flex gap-2">
                    <button disabled={busy || loading} onClick={() => void act(dispute, 'resolve')} className="px-3 py-1 rounded-md bg-green-600 text-white disabled:opacity-50">{el ? 'Επίλυση' : 'Resolve'}</button>
                    <button disabled={busy || loading} onClick={() => void act(dispute, 'refund')} className="px-3 py-1 rounded-md bg-red-600 text-white disabled:opacity-50">{el ? 'Επιστροφή' : 'Refund'}</button>
                  </div> : '—'}
                </td>
              </tr>
            ))}
            {!loading && !error && rows.length === 0 && <tr><td className="p-2" colSpan={6}>{el ? 'Δεν υπάρχουν αμφισβητήσεις.' : 'No disputes'}</td></tr>}
          </tbody>
        </table>
        <div className="p-2 flex items-center gap-2">
          <button disabled={busy || loading || page === 0} onClick={() => setPage(value => Math.max(0, value - 1))} className="px-3 py-1 rounded-md bg-secondary text-secondary-foreground disabled:opacity-50">{el ? 'Προηγούμενη' : 'Prev'}</button>
          <span className="text-sm">{el ? 'Σελίδα' : 'Page'} {page + 1} / {Math.max(1, Math.ceil(total / 20))}</span>
          <button disabled={busy || loading || page + 1 >= Math.ceil(total / 20)} onClick={() => setPage(value => value + 1)} className="px-3 py-1 rounded-md bg-secondary text-secondary-foreground disabled:opacity-50">{el ? 'Επόμενη' : 'Next'}</button>
        </div>
      </div>
      {recoveryDispute?.stripe_dispute_id && <SellerRecovery key={recoveryDispute.id} paymentId={recoveryDispute.payment_id} stripeDisputeId={recoveryDispute.stripe_dispute_id} locale={locale} onClose={() => setRecoveryDispute(null)} onUpdated={() => setRefresh(value => value + 1)} />}
    </div>
  )
}
