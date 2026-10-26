'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/contexts/i18n-context'
import { hasAccountBlockers, type AccountQueuePage, type AccountQueueRow } from '@/lib/account/types'
import { adminRequest } from '../admin-request'

function RequestReview({ row, onSaved }: { row: AccountQueueRow; onSaved: () => void }) {
  const { locale } = useI18n(); const el = locale === 'el'
  const [state, setState] = useState<'reviewing' | 'needs_information'>('reviewing')
  const [response, setResponse] = useState(row.response ?? '')
  const [busy, setBusy] = useState(false); const [error, setError] = useState(false)
  async function save() {
    setBusy(true); setError(false)
    try { await adminRequest('/api/admin/account-requests', { method: 'PATCH', body: JSON.stringify({ requestId: row.id, status: state, response }) }); onSaved() }
    catch { setError(true) } finally { setBusy(false) }
  }
  return <article className="space-y-3 rounded-2xl border border-border bg-card p-5">
    <div><h2 className="break-all font-semibold">{row.email ?? row.user_id}</h2><p className="text-xs text-muted-foreground">{row.id} · {new Date(row.created_at).toLocaleString(el ? 'el-GR' : 'en-GB')}</p></div>
    <p className="text-sm">{el ? 'Κατάσταση' : 'Status'}: {row.status}</p>
    <p className="text-sm">{el ? 'Ενεργές παραγγελίες / διαφορές / επιστροφές / ορόσημα' : 'Active orders / disputes / refunds / milestones'}: {row.blockers.active_orders} / {row.blockers.open_disputes} / {row.blockers.pending_refunds} / {row.blockers.active_milestones}</p>
    {(hasAccountBlockers(row.blockers) || row.blockers.financial_history) && <p className="rounded-lg bg-muted p-3 text-sm">{el ? 'Απαιτείται έλεγχος εκκρεμοτήτων και διατήρησης. Η ενέργεια αυτή δεν διαγράφει λογαριασμό ή οικονομικά αρχεία.' : 'Pending matters and retention require review. This action does not delete an account or financial records.'}</p>}
    <form onSubmit={event => { event.preventDefault(); void save() }} className="space-y-3">
      <Label htmlFor={`review-state-${row.id}`}>{el ? 'Ενημέρωση αιτήματος' : 'Update request'}</Label>
      <select id={`review-state-${row.id}`} value={state} onChange={event => setState(event.target.value as typeof state)} disabled={busy} className="block min-h-11 w-full rounded-lg border border-input bg-background px-3"><option value="reviewing">{el ? 'Υπό εξέταση' : 'Under review'}</option><option value="needs_information">{el ? 'Χρειάζονται πληροφορίες' : 'More information needed'}</option></select>
      <Label htmlFor={`review-response-${row.id}`}>{el ? 'Απάντηση ορατή στον χρήστη' : 'Response visible to the user'}</Label>
      <Textarea id={`review-response-${row.id}`} value={response} onChange={event => setResponse(event.target.value)} minLength={10} maxLength={4000} required disabled={busy} />
      <Button type="submit" disabled={busy || response.trim().length < 10}>{el ? 'Αποθήκευση απάντησης' : 'Save response'}</Button>
      {error && <p role="alert" className="text-sm text-destructive">{el ? 'Δεν αποθηκεύτηκε. Το αίτημα μπορεί να ακυρώθηκε. Ανανέωσε και δοκίμασε ξανά.' : 'Not saved. The request may have been cancelled. Refresh and try again.'}</p>}
    </form>
  </article>
}
export default function AccountRequestsPage() {
  const { locale } = useI18n(); const el = locale === 'el'
  const [page, setPage] = useState<AccountQueuePage | null>(null)
  const [cursor, setCursor] = useState<AccountQueuePage['next_cursor']>(null)
  const [refresh, setRefresh] = useState(0); const [error, setError] = useState(false)
  function reload() { setPage(null); setError(false); setRefresh(value => value + 1) }
  useEffect(() => {
    let active = true
    const query = cursor ? `?before=${encodeURIComponent(cursor.created_at)}&id=${cursor.id}` : ''
    void adminRequest<AccountQueuePage>(`/api/admin/account-requests${query}`).then(data => { if (active) setPage(data) }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [cursor, refresh])
  return <div className="mx-auto max-w-3xl space-y-5"><h1 className="text-2xl font-semibold">{el ? 'Αιτήματα διαγραφής λογαριασμού' : 'Account deletion requests'}</h1><p className="text-sm text-muted-foreground">{el ? 'Έλεγχος και απάντηση σε αιτήματα. Δεν εκτελείται αυτόματη διαγραφή. Η ολοκλήρωση προϋποθέτει εγκεκριμένη διαδικασία διατήρησης.' : 'Review and respond to requests. No automatic deletion is performed. Completion requires an approved retention procedure.'}</p>
    <Button variant="outline" onClick={() => { setCursor(null); reload() }}>{el ? 'Ανανέωση' : 'Refresh'}</Button>
    {error ? <p role="alert">{el ? 'Δεν φορτώθηκαν τα αιτήματα. Δοκίμασε ξανά.' : 'Could not load requests. Please retry.'}</p> : !page ? <p role="status">{el ? 'Φόρτωση…' : 'Loading…'}</p> : <>{page.rows.length ? page.rows.map(row => <RequestReview key={`${row.id}-${row.updated_at}`} row={row} onSaved={reload} />) : <p>{el ? 'Δεν υπάρχουν ενεργά αιτήματα.' : 'No active requests.'}</p>}{page.next_cursor && <Button onClick={() => { setPage(null); setError(false); setCursor(page.next_cursor) }}>{el ? 'Επόμενα αιτήματα' : 'Next requests'}</Button>}</>}
  </div>
}
