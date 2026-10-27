'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { useI18n } from '@/contexts/i18n-context'
import { supabase } from '@/lib/supabase/client'
import { withCsrfHeaders } from '@/lib/utils/csrf'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

type Props = { paymentId: string; onUpdated: () => void }
const messages = {
  en: { button: 'Release authorization', title: 'Release this authorization?', hint: 'This cancels the uncollected authorization. It does not pay the provider or refund a collected payment. Enter the reason for the audit record.', reason: 'Reason for release', invalid: 'Enter a reason between 5 and 1,000 characters.', cancel: 'Back', saving: 'Requesting release…', error: 'Release was not verified. Your reason is still here. Refresh and try again.', released: 'Stripe confirmed the authorization was released.', pending: 'Release is being verified. No successful release is assumed yet.', session: 'Your account changed. Open this payment again.' },
  el: { button: 'Αποδέσμευση ποσού', title: 'Να αποδεσμευτεί το ποσό;', hint: 'Ακυρώνεται η δέσμευση που δεν έχει εισπραχθεί. Δεν πληρώνεται ο πάροχος και δεν επιστρέφεται εισπραγμένη πληρωμή. Συμπλήρωσε τον λόγο για το ιστορικό ελέγχου.', reason: 'Λόγος αποδέσμευσης', invalid: 'Συμπλήρωσε έναν λόγο με 5 έως 1.000 χαρακτήρες.', cancel: 'Πίσω', saving: 'Αίτημα αποδέσμευσης…', error: 'Η αποδέσμευση δεν επαληθεύτηκε. Ο λόγος παραμένει εδώ. Ανανέωσε και δοκίμασε ξανά.', released: 'Το Stripe επιβεβαίωσε την αποδέσμευση του ποσού.', pending: 'Η αποδέσμευση επαληθεύεται. Δεν θεωρείται ακόμη επιτυχής.', session: 'Άλλαξε ο λογαριασμός σου. Άνοιξε ξανά την πληρωμή.' },
}

export function AdminAuthorizationRelease(props: Props) {
  const { user, isInitialized } = useAuth()
  if (!isInitialized || !user) return null
  return <ReleaseControl key={`${user.id}:${props.paymentId}`} {...props} userId={user.id} />
}

function ReleaseControl({ paymentId, onUpdated, userId }: Props & { userId: string }) {
  const { locale } = useI18n()
  const copy = messages[locale === 'el' ? 'el' : 'en']
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const current = useRef(false)
  const request = useRef<AbortController | null>(null)
  useLayoutEffect(() => { current.current = true; return () => { current.current = false; request.current?.abort() } }, [])
  async function release() {
    if (request.current) return
    const clean = reason.trim()
    if (clean.length < 5 || clean.length > 1000) { setError(copy.invalid); return }
    const controller = new AbortController(); request.current = controller
    setBusy(true); setError(''); setNotice('')
    try {
      const session = await supabase.auth.getSession()
      if (!current.current) return
      if (session.error || !session.data.session?.access_token || session.data.session.user.id !== userId) throw new Error(copy.session)
      const headers = await withCsrfHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${session.data.session.access_token}` })
      if (!current.current) return
      if (!headers['X-CSRF-Token']) throw new Error(copy.error)
      const fresh = await supabase.auth.getSession()
      if (!current.current) return
      if (fresh.error || fresh.data.session?.user.id !== userId) throw new Error(copy.session)
      const response = await fetch('/api/admin/payments/cancel', { method: 'POST', headers, signal: controller.signal, body: JSON.stringify({ paymentId, expectedUserId: userId, reason: clean }) })
      const result = await response.json().catch(() => null)
      const latest = await supabase.auth.getSession()
      if (!current.current) return
      if (latest.error || latest.data.session?.user.id !== userId) throw new Error(copy.session)
      if (!response.ok || typeof result?.released !== 'boolean' || typeof result?.pending !== 'boolean' || (!result.released && !result.pending)) throw new Error(copy.error)
      setOpen(false); setNotice(result.released ? copy.released : copy.pending)
      onUpdated()
    } catch (failure) { if (current.current) setError(failure instanceof Error && failure.message === copy.session ? copy.session : copy.error) }
    finally { request.current = null; if (current.current) setBusy(false) }
  }
  return <div className="space-y-2">
    <Button type="button" variant="outline" disabled={busy} onClick={() => { setError(''); setOpen(true) }}>{copy.button}</Button>
    {notice && <p role="status" className="max-w-sm text-xs text-muted-foreground">{notice}</p>}
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value) }}><DialogContent closeLabel={copy.cancel} closeDisabled={busy}>
      <DialogHeader><DialogTitle>{copy.title}</DialogTitle><DialogDescription>{copy.hint}</DialogDescription></DialogHeader>
      <p className="break-all text-xs text-muted-foreground">{paymentId}</p>
      <label htmlFor={`release-reason-${paymentId}`} className="text-sm font-medium">{copy.reason}</label>
      <Textarea id={`release-reason-${paymentId}`} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>{copy.cancel}</Button><Button disabled={busy} onClick={() => { void release() }}>{busy ? copy.saving : copy.button}</Button></div>
    </DialogContent></Dialog>
  </div>
}
