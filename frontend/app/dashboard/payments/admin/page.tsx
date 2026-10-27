"use client";

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'

import { supabase } from '@/lib/supabase/client'
import { withCsrfHeaders } from '@/lib/utils/csrf'
import { useI18n } from '@/contexts/i18n-context'
import { AdminAuthorizationRelease } from '@/components/features/orders/admin-authorization-release'

type Dispute = { id: string; status: string; reason: string | null; payment_id: string }
type Revenue = { currency: string; volume: number; fee: number }
type MonthlyRevenue = Revenue & { month: string }
type PaymentRow = { id: string; status: string; amount: number; platform_fee: number; currency: string; created_at: string; role_review_required?: boolean; authorization_expires_at?: string | null; provider_checked_at?: string | null; provider_status?: string | null; attention_required?: boolean; cancel_claim_id?: string | null; stripe_canceled_at?: string | null }
const money = (amount: number, currency = 'USD') => new Intl.NumberFormat('en', { style: 'currency', currency }).format(amount)

async function adminHeaders(signInMessage: string) {
  const session = await supabase.auth.getSession()
  const token = session.data.session?.access_token
  if (session.error || !token) throw new Error(signInMessage)
  return { Authorization: `Bearer ${token}` }
}

export default function PaymentsAdminPage() {
  const { t, locale } = useI18n()
  const signInMessage = t('payments.adminSignIn', locale === 'el' ? 'Συνδέσου για να δεις τη διαχείριση πληρωμών.' : 'Sign in to view payment administration.')
  const loadError = t('payments.adminLoadFailed', locale === 'el' ? 'Δεν ήταν δυνατή η φόρτωση της διαχείρισης πληρωμών. Δοκίμασε ξανά.' : 'Payment administration could not be loaded. Please try again.')
  const [disputes, setDisputes] = useState<Dispute[]>([])
  const [loading, setLoading] = useState(false)
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [revenue, setRevenue] = useState<Revenue[] | null>(null)
  const [monthly, setMonthly] = useState<MonthlyRevenue[]>([])
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const [yearFilter, setYearFilter] = useState<number | 'all'>('all')
  const [showVolume, setShowVolume] = useState(true)
  const [showFee, setShowFee] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'all'|'requires_capture'|'completed'|'refunded'|'failed'>('all')
  const [roleReviewOnly, setRoleReviewOnly] = useState(false)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [rows, setRows] = useState<PaymentRow[]>([])
  const [refreshVersion, setRefreshVersion] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const run = async () => {
      try {
        setError(null)
        const headers = await adminHeaders(signInMessage)
        const [summaryResponse, listResponse] = await Promise.all([
          fetch(`/api/payments/admin/summary?year=${yearFilter}`, { headers, signal: controller.signal }),
          fetch(`/api/admin/payments/list?status=${statusFilter}&year=${yearFilter}&limit=20&offset=${page*20}${roleReviewOnly ? '&roleReview=required' : ''}`, { headers, signal: controller.signal }),
        ])
        if ([summaryResponse.status, listResponse.status].some(status => status === 401 || status === 403)) {
          if (!controller.signal.aborted) { setAllowed(false); router.push('/dashboard') }
          return
        }
        if (!summaryResponse.ok || !listResponse.ok) throw new Error(loadError)
        const [summary, list] = await Promise.all([summaryResponse.json(), listResponse.json()])
        if (controller.signal.aborted) return
        setAllowed(true)
        setDisputes(summary.disputes || [])
        setRevenue(summary.totals || [])
        setMonthly(summary.monthly || [])
        setRows(list.rows || [])
        setTotal(list.total || 0)
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : loadError)
      }
    }
    void run()
    return () => controller.abort()
  }, [statusFilter, yearFilter, page, roleReviewOnly, router, signInMessage, loadError, refreshVersion])

  const actOnDispute = async (id: string, action: 'resolve' | 'refund') => {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const headers = await withCsrfHeaders(await adminHeaders(signInMessage))
      if (!headers['X-CSRF-Token']) throw new Error(t('payments.secureRequestFailed', locale === 'el' ? 'Δεν ήταν δυνατή η προετοιμασία ασφαλούς αιτήματος. Ανανέωσε τη σελίδα και δοκίμασε ξανά.' : 'Could not prepare a secure request. Refresh and try again.'))
      const response = await fetch(`/api/payments/disputes/${id}/${action}`, { method: 'POST', headers })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || t('payments.disputeUpdateFailed', locale === 'el' ? 'Δεν ήταν δυνατή η ενημέρωση της αμφισβήτησης.' : 'The dispute could not be updated.'))
      const refreshed = await fetch(`/api/payments/admin/summary?year=${yearFilter}`, { headers })
      if (!refreshed.ok) throw new Error(t('payments.disputeRefreshFailed', locale === 'el' ? 'Η αμφισβήτηση ενημερώθηκε, αλλά δεν ήταν δυνατή η φόρτωση της νέας σύνοψης.' : 'Dispute updated, but the refreshed summary could not be loaded.'))
      const summary = await refreshed.json()
      setDisputes(summary.disputes || [])
      setRevenue(summary.totals || [])
      setMonthly(summary.monthly || [])
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('payments.disputeUpdateFailed', locale === 'el' ? 'Δεν ήταν δυνατή η ενημέρωση της αμφισβήτησης.' : 'The dispute could not be updated.'))
    } finally { setLoading(false) }
  }

  const exportPayments = async () => {
    try {
      setError(null)
      const response = await fetch(`/api/admin/payments/export?status=${statusFilter}&year=${yearFilter}${roleReviewOnly ? '&roleReview=required' : ''}`, { headers: await adminHeaders(signInMessage) })
      if (!response.ok) throw new Error(t('payments.exportDownloadFailed', locale === 'el' ? 'Δεν ήταν δυνατή η λήψη του αρχείου πληρωμών.' : 'Payment export could not be downloaded.'))
      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = 'payments.csv'; anchor.click()
      URL.revokeObjectURL(url)
    } catch (failure) { setError(failure instanceof Error ? failure.message : t('payments.exportFailed', locale === 'el' ? 'Η εξαγωγή πληρωμών απέτυχε.' : 'Payment export failed.')) }
  }

  return (
    <div className="container mx-auto p-4 pt-[72px]">
      <h1 className="text-2xl font-bold">Payments Admin</h1>
      {error && <div role="alert" className="mt-4 text-sm text-red-500">{error}</div>}
      {allowed === false && (<div className="mt-4">Forbidden</div>)}
      {revenue && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="border rounded-md p-4">
            <div className="text-sm text-muted-foreground">Total Volume</div>
            <div className="text-2xl font-bold">{revenue.map(r => money(r.volume, r.currency)).join(' / ') || money(0, 'EUR')}</div>
          </div>
          <div className="border rounded-md p-4">
            <div className="text-sm text-muted-foreground">Platform Fees</div>
            <div className="text-2xl font-bold">{revenue.map(r => money(r.fee, r.currency)).join(' / ') || money(0, 'EUR')}</div>
          </div>
        </div>
      )}
      {revenue && (
        <div className="mt-6 border rounded-md p-4">
          <h2 className="text-xl font-semibold mb-2">Monthly Revenue</h2>
          <div className="flex items-center gap-3 mb-3">
            <select value={yearFilter} onChange={(e)=>setYearFilter(e.target.value==='all'?'all':Number(e.target.value))} className="border border-input bg-background text-foreground rounded-md p-2">
              <option value="all">All Years</option>
              {[2023,2024,2025,2026].map(y => (<option key={y} value={y}>{y}</option>))}
            </select>
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={showVolume} onChange={(e)=>setShowVolume(e.target.checked)} /> Volume</label>
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={showFee} onChange={(e)=>setShowFee(e.target.checked)} /> Platform Fee</label>
          </div>
          <MonthlyRevenueChart rows={monthly} showVolume={showVolume} showFee={showFee} />
        </div>
      )}
      <div className="mt-6 border rounded-md p-4">
        <h2 className="text-xl font-semibold mb-2">Payments</h2>
        <div className="flex flex-wrap gap-2 items-center mb-2">
          <select value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value as any)} className="border border-input bg-background text-foreground rounded-md p-2">
            <option value="all">All</option>
            <option value="requires_capture">Requires Capture</option>
            <option value="completed">Completed</option>
            <option value="refunded">Refunded</option>
            <option value="failed">Failed</option>
          </select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={roleReviewOnly} onChange={event => { setRoleReviewOnly(event.target.checked); setPage(0) }} />{t('payments.reviewFilter', locale === 'el' ? 'Μόνο πληρωμές που χρειάζονται έλεγχο από διαχειριστή' : 'Only payments needing administrator review')}</label>
          <button onClick={exportPayments} className="px-3 py-1 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80">Export CSV</button>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="text-left"><th className="p-2">ID</th><th className="p-2">Status</th><th className="p-2">Amount</th><th className="p-2">Fee</th><th className="p-2">When</th><th className="p-2">{locale === 'el' ? 'Δέσμευση' : 'Authorization'}</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t">
                <td className="p-2">{r.id}</td>
                <td className="p-2">{r.status}{r.role_review_required && <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">{t('payments.reviewBadge', locale === 'el' ? 'Χρειάζεται έλεγχο από διαχειριστή' : 'Needs administrator review')}</p>}</td>
                <td className="p-2">{money(Number(r.amount), r.currency || 'USD')}</td>
                <td className="p-2">{money(Number(r.platform_fee || 0), r.currency || 'USD')}</td>
                <td className="p-2">{new Date(r.created_at).toLocaleString()}</td>
                <td className="space-y-2 p-2">{r.authorization_expires_at && <p className="text-xs">{locale === 'el' ? 'Προθεσμία: ' : 'Deadline: '}<time dateTime={r.authorization_expires_at}>{new Date(r.authorization_expires_at).toLocaleString(locale === 'el' ? 'el-GR' : 'en-GB')}</time></p>}{r.stripe_canceled_at ? <p className="text-xs">{locale === 'el' ? 'Το Stripe επιβεβαίωσε την αποδέσμευση.' : 'Stripe confirmed release.'}</p> : ['requires_capture', 'failed'].includes(r.status) && allowed === true && <AdminAuthorizationRelease paymentId={r.id} onUpdated={() => setRefreshVersion(value => value + 1)} />}</td>
              </tr>
            ))}
            {rows.length===0 && (<tr><td className="p-2" colSpan={6}>No payments</td></tr>)}
          </tbody>
        </table>
        <div className="p-2 flex items-center gap-2">
          <button disabled={page===0} onClick={()=>setPage(p=>Math.max(0,p-1))} className="px-3 py-1 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80">Prev</button>
          <span className="text-sm">Page {page+1} / {Math.max(1, Math.ceil(total/20))}</span>
          <button disabled={(page+1)>=Math.ceil(total/20)} onClick={()=>setPage(p=>p+1)} className="px-3 py-1 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80">Next</button>
        </div>
      </div>
      <div className="mt-6 border rounded-md">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="p-2">ID</th>
              <th className="p-2">Status</th>
              <th className="p-2">Reason</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {disputes.map((d) => (
              <tr key={d.id} className="border-t">
                <td className="p-2">{d.id}</td>
                <td className="p-2">{d.status}</td>
                <td className="p-2">{d.reason || ''}</td>
                <td className="p-2 space-x-2">
                  <button disabled={loading} onClick={() => actOnDispute(d.id, 'resolve')} className="px-3 py-1 rounded-md bg-green-600 text-white">Resolve</button>
                  <button disabled={loading} onClick={() => actOnDispute(d.id, 'refund')} className="px-3 py-1 rounded-md bg-red-600 text-white">Refund</button>
                </td>
              </tr>
            ))}
            {disputes.length === 0 && (
              <tr><td className="p-2" colSpan={4}>No disputes</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
export const dynamic = 'force-dynamic'
function MonthlyRevenueChart({ rows, showVolume, showFee }: { rows: MonthlyRevenue[]; showVolume: boolean; showFee: boolean }) {
  const currencies = [...new Set(rows.map(row => row.currency))]
  const points = new Map<string, Record<string, string | number>>()
  for (const row of rows) {
    const point = points.get(row.month) || { month: row.month }
    point[`volume_${row.currency}`] = row.volume
    point[`fee_${row.currency}`] = row.fee
    points.set(row.month, point)
  }
  const data = [...points.values()]
  return (
    <div style={{ width: '100%', height: 300 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
          <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" />
          <YAxis stroke="hsl(var(--muted-foreground))" />
          <Tooltip contentStyle={{ backgroundColor: "hsl(var(--popover))", color: "hsl(var(--popover-foreground))", borderColor: "hsl(var(--border))", borderRadius: 8 }} labelStyle={{ color: "hsl(var(--popover-foreground))" }} />
          <Legend />
          {showVolume && currencies.map(currency => <Line key={`volume_${currency}`} type="monotone" dataKey={`volume_${currency}`} stroke="#3B82F6" name={`Volume (${currency})`} />)}
          {showFee && currencies.map(currency => <Line key={`fee_${currency}`} type="monotone" dataKey={`fee_${currency}`} stroke="#10B981" name={`Platform Fee (${currency})`} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
