"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/contexts/i18n-context';
import { paymentLabel } from '@/components/features/payments/payment-labels';
import { orderMoney } from '@/components/features/orders/order-copy';
import { supabase } from '@/lib/supabase/client';
import { withCsrfHeaders } from '@/lib/utils/csrf';

type MilestoneRow = { id: string; listing_id: string; title: string; amount: number; buyer_id: string; seller_id: string; buyer_confirmed?: boolean; seller_confirmed?: boolean; status: string; stripe_payment_intent: string | null };
const columns = 'id,listing_id,title,amount,status,stripe_payment_intent,buyer_id,seller_id,buyer_confirmed,seller_confirmed';
const copies = {
  en: { title: 'Payment milestones', intro: 'Follow the agreed stages of your purchases and services.', back: 'Profile', loading: 'Loading milestones…', loadError: 'Milestones could not be loaded. Try again.', retry: 'Try again', refresh: 'Refresh', disabled: 'Milestone payments are currently unavailable. You can still view their history.', empty: 'No milestones yet', emptyHint: 'Agreed payment stages will appear here.', heading: 'Title', amount: 'Amount', status: 'Status', actions: 'Actions', pay: 'Pay', buyer: 'I received this stage', seller: 'I completed this stage', confirmed: 'Your completion is confirmed', capture: 'Finalize payment', busy: 'Saving…', confirmationError: 'Confirmation could not be saved. Please try again.', refreshError: 'The request was saved, but its updated status could not be loaded. Refresh before trying again.', captureError: 'Payment could not be finalized. Refresh its status and try again.', captureQueued: 'The payment request was received. Its final status is being verified; refresh to check it.', confirmationSaved: 'Your completion confirmation was saved.' },
  el: { title: 'Στάδια πληρωμής', intro: 'Παρακολούθησε τα συμφωνημένα στάδια των αγορών και των υπηρεσιών σου.', back: 'Προφίλ', loading: 'Φόρτωση σταδίων…', loadError: 'Τα στάδια πληρωμής δεν φορτώθηκαν. Δοκίμασε ξανά.', retry: 'Δοκίμασε ξανά', refresh: 'Ανανέωση', disabled: 'Οι πληρωμές ανά στάδιο δεν είναι διαθέσιμες αυτή τη στιγμή. Μπορείς να δεις το ιστορικό.', empty: 'Δεν υπάρχουν στάδια πληρωμής ακόμη', emptyHint: 'Τα συμφωνημένα στάδια πληρωμής θα εμφανιστούν εδώ.', heading: 'Τίτλος', amount: 'Ποσό', status: 'Κατάσταση', actions: 'Ενέργειες', pay: 'Πληρωμή', buyer: 'Παρέλαβα αυτό το στάδιο', seller: 'Ολοκλήρωσα αυτό το στάδιο', confirmed: 'Η ολοκλήρωσή σου επιβεβαιώθηκε', capture: 'Οριστικοποίηση πληρωμής', busy: 'Αποθήκευση…', confirmationError: 'Η επιβεβαίωση δεν αποθηκεύτηκε. Δοκίμασε ξανά.', refreshError: 'Το αίτημα αποθηκεύτηκε, αλλά δεν φορτώθηκε η ενημερωμένη κατάστασή του. Ανανέωσε πριν δοκιμάσεις ξανά.', captureError: 'Η πληρωμή δεν οριστικοποιήθηκε. Ανανέωσε την κατάστασή της και δοκίμασε ξανά.', captureQueued: 'Το αίτημα πληρωμής παραλήφθηκε. Το τελικό αποτέλεσμα επαληθεύεται· ανανέωσε για να το ελέγξεις.', confirmationSaved: 'Η επιβεβαίωση ολοκλήρωσης αποθηκεύτηκε.' },
};

export default function MilestonesPage() {
  const { locale } = useI18n();
  const language = locale === 'el' ? 'el' : 'en';
  const copy = copies[language];
  const [rows, setRows] = useState<MilestoneRow[]>([]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const locked = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const current = ++generation.current;
    async function load() {
      setLoading(true); setLoadFailed(false); setError(''); setNotice(''); setNeedsRefresh(false);
      try {
        const user = await supabase.auth.getUser();
        if (user.error || !user.data.user) throw new Error('Session unavailable');
        const me = await supabase.from('profiles').select('id').eq('user_id', user.data.user.id).limit(1).single();
        if (me.error || !me.data?.id) throw new Error('Profile unavailable');
        const [milestones, flag] = await Promise.all([
          supabase.from('milestones').select(columns).or(`buyer_id.eq.${me.data.id},seller_id.eq.${me.data.id}`).order('created_at', { ascending: false }),
          supabase.from('feature_flags').select('enabled').eq('key', 'milestones_enabled').maybeSingle(),
        ]);
        if (milestones.error || flag.error) throw new Error('Milestones unavailable');
        if (!cancelled && current === generation.current) {
          setRows((milestones.data || []) as MilestoneRow[]); setProfileId(me.data.id); setEnabled(flag.data?.enabled === true);
        }
      } catch { if (!cancelled) { setRows([]); setProfileId(null); setEnabled(false); setLoadFailed(true); } }
      finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; generation.current = current + 1; };
  }, [attempt]);

  async function update(row: MilestoneRow, action: 'buyer' | 'seller' | 'capture') {
    if (locked.current || loading || needsRefresh || !enabled || row.status !== 'requires_capture' || !profileId) return;
    if (action !== 'capture' && (profileId !== row[`${action}_id`] || row[`${action}_confirmed`])) return;
    if (action === 'capture' && (!row.stripe_payment_intent || !row.buyer_confirmed || !row.seller_confirmed || ![row.buyer_id, row.seller_id].includes(profileId))) return;
    const current = generation.current;
    locked.current = true; setBusy(row.id); setError(''); setNotice('');
    let saved = false;
    try {
      if (action === 'capture') {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        if (session.error || !token) throw new Error(copy.captureError);
        const headers = await withCsrfHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });
        if (!headers['X-CSRF-Token']) throw new Error(copy.captureError);
        const response = await fetch('/api/payments/capture', { method: 'POST', headers, body: JSON.stringify({ intentId: row.stripe_payment_intent }) });
        if (!response.ok) throw new Error(copy.captureError);
      } else {
        const result = await supabase.from('milestones').update({ [`${action}_confirmed`]: true }).eq('id', row.id);
        if (result.error) throw new Error(copy.confirmationError);
      }
      saved = true;
      const refreshed = await supabase.from('milestones').select(columns).eq('id', row.id).single();
      if (refreshed.error || !refreshed.data) throw new Error(copy.refreshError);
      if (current === generation.current) {
        setRows(previous => previous.map(item => item.id === row.id ? refreshed.data as MilestoneRow : item));
        setNotice(action === 'capture' ? copy.captureQueued : copy.confirmationSaved);
      }
    } catch (failure) {
      if (current === generation.current) { setError(failure instanceof Error ? failure.message : copy.captureError); setNeedsRefresh(saved); }
    } finally { locked.current = false; if (current === generation.current) setBusy(null); }
  }

  return <div className="needs-shell needs-page space-y-6">
    <Link href="/profile" className="inline-flex min-h-11 items-center text-sm text-muted-foreground">← {copy.back}</Link>
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1><p className="mt-2 text-sm text-muted-foreground">{copy.intro}</p></div><Button variant="outline" disabled={loading || !!busy} onClick={() => setAttempt(value => value + 1)}>{copy.refresh}</Button></header>
    {loading ? <p role="status">{copy.loading}</p> : loadFailed ? <div role="alert" className="space-y-3 rounded-2xl border border-border bg-card p-5"><p>{copy.loadError}</p><Button variant="outline" onClick={() => setAttempt(value => value + 1)}>{copy.retry}</Button></div> : <>
      {!enabled && <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">{copy.disabled}</p>}
      {error && <p role="alert" className="rounded-xl border border-destructive/25 p-3 text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="rounded-xl bg-muted p-3 text-sm">{notice}</p>}
      {!rows.length ? <section className="rounded-2xl border border-dashed border-border p-8 text-center"><h2 className="font-medium">{copy.empty}</h2><p className="mt-2 text-sm text-muted-foreground">{copy.emptyHint}</p></section>
        : <div className="overflow-x-auto rounded-2xl border border-border"><table className="w-full text-sm"><caption className="sr-only">{copy.title}</caption><thead><tr className="border-b bg-muted/40 text-left"><th scope="col" className="p-3">{copy.heading}</th><th scope="col" className="p-3">{copy.amount}</th><th scope="col" className="p-3">{copy.status}</th><th scope="col" className="p-3">{copy.actions}</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id} className="border-b last:border-0"><th scope="row" className="min-w-40 p-3 text-left font-medium">{row.title}</th><td className="whitespace-nowrap p-3">{orderMoney(Number(row.amount), 'eur', language)}</td><td className="p-3">{paymentLabel(row.status, language)}</td><td className="p-3"><div className="flex min-w-44 flex-wrap gap-2">
            {enabled && ['pending', 'failed'].includes(row.status) && profileId === row.buyer_id && <Button asChild variant="outline"><Link href={`/payments/checkout/${encodeURIComponent(row.listing_id)}?milestoneId=${encodeURIComponent(row.id)}`}>{copy.pay}</Link></Button>}
            {enabled && row.status === 'requires_capture' && <>
              {profileId === row.buyer_id && <Button variant="outline" disabled={!!busy || needsRefresh || row.buyer_confirmed} onClick={() => { void update(row, 'buyer'); }}>{busy === row.id ? copy.busy : row.buyer_confirmed ? copy.confirmed : copy.buyer}</Button>}
              {profileId === row.seller_id && <Button variant="outline" disabled={!!busy || needsRefresh || row.seller_confirmed} onClick={() => { void update(row, 'seller'); }}>{busy === row.id ? copy.busy : row.seller_confirmed ? copy.confirmed : copy.seller}</Button>}
              {row.stripe_payment_intent && <Button disabled={!!busy || needsRefresh || !row.buyer_confirmed || !row.seller_confirmed} onClick={() => { void update(row, 'capture'); }}>{busy === row.id ? copy.busy : copy.capture}</Button>}
            </>}
          </div></td></tr>)}</tbody></table></div>}
    </>}
  </div>;
}
