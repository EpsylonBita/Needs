'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Download, Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/contexts/auth-context'
import { useI18n } from '@/contexts/i18n-context'
import { hasAccountBlockers, type AccountPrivacyStatus } from '@/lib/account/types'
import { AccountPrivacyError, cancelAccountDeletion, confirmAccountPassword, exportAccountData, getAccountPrivacyStatus, requestAccountDeletion } from '@/lib/services/account-privacy-service'
import styles from './profile.module.css'

type Action = 'export' | 'request' | 'cancel'
export function AccountPrivacySettings() {
  const { user } = useAuth()
  const { locale } = useI18n()
  return user ? <AccountPrivacyControls key={user.id} userId={user.id} el={locale === 'el'} /> : null
}
function AccountPrivacyControls({ userId, el }: { userId: string; el: boolean }) {
  const [status, setStatus] = useState<AccountPrivacyStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [reauth, setReauth] = useState<Action | null>(null)
  const [password, setPassword] = useState('')
  const [reload, setReload] = useState(0)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    const controller = new AbortController()
    void getAccountPrivacyStatus(userId, controller.signal).then(value => { if (!controller.signal.aborted) setStatus(value) })
      .catch(() => { if (!controller.signal.aborted) setError(el ? 'Δεν φορτώθηκε η κατάσταση του αιτήματος.' : 'The request status could not be loaded.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); active.current = false }
  }, [userId, reload, el])

  async function run(action: Action, verify = false) {
    if (busy || (action === 'request' && confirmation !== 'DELETE')) return
    setBusy(true); setError(null); setNotice(null)
    try {
      if (verify) await confirmAccountPassword(userId, password)
      if (!active.current) return
      if (action === 'export') {
        const data = await exportAccountData(userId)
        if (!active.current) return
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'needs-account-data.json'; anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        setNotice(el ? 'Το αρχείο δεδομένων είναι έτοιμο για λήψη.' : 'Your data file is ready to download.')
      } else {
        const value = action === 'request' ? await requestAccountDeletion(userId) : await cancelAccountDeletion(userId, status!.request!.id)
        if (!active.current) return
        setStatus(value); setConfirmation('')
        setNotice(action === 'request' ? (el ? 'Το αίτημα καταχωρίστηκε. Ο λογαριασμός σου δεν έχει διαγραφεί.' : 'Your request was saved. Your account has not been deleted.') : (el ? 'Το αίτημα ακυρώθηκε.' : 'Your request was cancelled.'))
      }
      setReauth(null)
    } catch (failure) {
      if (!active.current) return
      if (failure instanceof AccountPrivacyError && failure.code === 'REAUTH_REQUIRED') setReauth(action)
      else setError(failure instanceof AccountPrivacyError && failure.code === 'REAUTH_FAILED'
        ? (el ? 'Δεν επιβεβαιώθηκε η ταυτότητά σου. Έλεγξε τον κωδικό ή συνδέσου ξανά.' : failure.message)
        : el ? 'Το αίτημα δεν ολοκληρώθηκε. Δοκίμασε ξανά ή επικοινώνησε με την υποστήριξη.' : failure instanceof Error ? failure.message : 'The request failed. Please try again.')
    } finally { if (active.current) { setBusy(false); setPassword('') } }
  }
  const pending = status?.request && status.request.status !== 'cancelled'
  const blocked = !!status && hasAccountBlockers(status.blockers)
  const stateLabels = el ? { pending: 'Σε αναμονή ελέγχου', reviewing: 'Υπό εξέταση', needs_information: 'Χρειάζονται πρόσθετες πληροφορίες', cancelled: 'Ακυρωμένο' }
    : { pending: 'Awaiting review', reviewing: 'Under review', needs_information: 'More information needed', cancelled: 'Cancelled' }
  return <section className={styles.panel} aria-labelledby="account-privacy-heading">
    <div className={styles.sectionHeading}><div><h2 id="account-privacy-heading">{el ? 'Τα δεδομένα και ο λογαριασμός σου' : 'Your data and account'}</h2><p>{el ? 'Λήψη δεδομένων και αίτημα διαγραφής με επιβεβαίωση ταυτότητας.' : 'Download your data or request deletion with identity verification.'}</p></div></div>
    <div className={styles.settingRow}><div><h3>{el ? 'Εξαγωγή δεδομένων' : 'Export your data'}</h3><p>{el ? 'Αρχείο JSON με προφίλ, αγγελίες, μηνύματα που έστειλες και συνδεδεμένες συναλλαγές. Για μη συνδεδεμένα αιτήματα επισκέπτη ή δεδομένα παρόχων, επικοινώνησε μαζί μας.' : 'A JSON file with your profile, listings, sent messages and linked transactions. Contact us for unlinked guest requests or data held by providers.'}</p></div><Button type="button" variant="outline" disabled={busy} onClick={() => void run('export')} className="min-h-11 shrink-0"><Download className="h-4 w-4" aria-hidden="true" />{el ? 'Λήψη JSON' : 'Download JSON'}</Button></div>
    <div className="space-y-4 border-t border-border pt-5">
      <h3 className="font-semibold">{el ? 'Αίτημα διαγραφής λογαριασμού' : 'Request account deletion'}</h3>
      <p className="text-sm text-muted-foreground">{el ? 'Το αίτημα εξετάζεται πριν από οποιαδήποτε διαγραφή. Εκκρεμείς συναλλαγές και διαφορές πρέπει να διευθετηθούν. Τα οικονομικά αρχεία εξετάζονται χωριστά για τυχόν υποχρέωση διατήρησης. Ο λογαριασμός παραμένει ενεργός όσο το αίτημα εξετάζεται.' : 'Your request is reviewed before any deletion. Pending transactions and disputes must be resolved. Financial records require a separate retention review. Your account stays active while the request is reviewed.'}</p>
      {loading ? <p role="status">{el ? 'Φόρτωση…' : 'Loading…'}</p> : status ? <>
        {status.request && <div className="space-y-2 rounded-xl border border-border p-3"><p className="font-medium">{stateLabels[status.request.status]}</p><p className="break-all text-xs text-muted-foreground">{el ? 'Αριθμός αιτήματος:' : 'Request ID:'} {status.request.id}</p>{status.request.response && <p className="whitespace-pre-wrap text-sm">{status.request.response}</p>}</div>}
        {blocked && <div className="rounded-xl bg-muted p-3 text-sm"><p className="font-medium">{el ? 'Εκκρεμότητες πριν από το κλείσιμο' : 'Pending matters before closure'}</p><p>{el ? 'Παραγγελίες' : 'Orders'}: {status.blockers.active_orders} · {el ? 'Διαφορές' : 'Disputes'}: {status.blockers.open_disputes} · {el ? 'Επιστροφές' : 'Refunds'}: {status.blockers.pending_refunds} · {el ? 'Ορόσημα' : 'Milestones'}: {status.blockers.active_milestones}</p><Link href="/dashboard/orders" className="inline-flex min-h-11 items-center underline">{el ? 'Δες τις παραγγελίες σου' : 'View your orders'}</Link></div>}
        {status.blockers.financial_history && <p className="text-sm text-muted-foreground">{el ? 'Υπάρχει οικονομικό ιστορικό που χρειάζεται έλεγχο διατήρησης. Η υποβολή αιτήματος δεν το διαγράφει.' : 'Financial history needs a retention review. Submitting a request does not delete it.'}</p>}
        {pending ? <Button type="button" variant="outline" disabled={busy} onClick={() => void run('cancel')}>{el ? 'Ακύρωση αιτήματος' : 'Cancel request'}</Button> : <div className="space-y-2"><Label htmlFor="account-delete-confirmation">{el ? 'Γράψε DELETE για να ζητήσεις διαγραφή' : 'Type DELETE to request deletion'}</Label><Input id="account-delete-confirmation" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" disabled={busy} className="max-w-xs" /><Button type="button" variant="destructive" disabled={busy || confirmation !== 'DELETE'} onClick={() => void run('request')}>{el ? 'Υποβολή αιτήματος διαγραφής' : 'Submit deletion request'}</Button></div>}
      </> : <Button type="button" variant="outline" onClick={() => { setLoading(true); setError(null); setReload(value => value + 1) }}>{el ? 'Δοκίμασε ξανά' : 'Try again'}</Button>}
    </div>
    {reauth && <form onSubmit={event => { event.preventDefault(); void run(reauth, true) }} className="mt-5 space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4"><h3 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4" aria-hidden="true" />{el ? 'Επιβεβαίωση ταυτότητας' : 'Confirm your identity'}</h3><p className="text-sm">{el ? 'Χρειάζεται πρόσφατη σύνδεση. Συμπλήρωσε τον τρέχοντα κωδικό σου ή συνδέσου ξανά με τη συνήθη μέθοδο και επανάλαβε την ενέργεια.' : 'A recent sign-in is required. Enter your current password, or sign in again using your usual method and retry.'}</p><Label htmlFor="account-current-password">{el ? 'Τρέχων κωδικός' : 'Current password'}</Label><Input id="account-current-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} disabled={busy} required /><div className="flex gap-2"><Button type="submit" disabled={busy || !password}>{el ? 'Επιβεβαίωση και συνέχεια' : 'Confirm and continue'}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => { setReauth(null); setPassword('') }}>{el ? 'Ακύρωση' : 'Cancel'}</Button></div></form>}
    {busy && <p role="status" className="mt-3 flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{el ? 'Επεξεργασία…' : 'Working…'}</p>}
    {notice && <p role="status" className="mt-3 text-sm">{notice}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error} <Link href="/contact" className="underline">{el ? 'Επικοινωνία' : 'Contact support'}</Link></p>}
  </section>
}
