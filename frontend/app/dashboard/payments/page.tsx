"use client";

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { withCsrfHeaders } from '@/lib/utils/csrf';
import { useI18n } from '@/contexts/i18n-context';
import { Button } from '@/components/ui/button';
import { orderMoney } from '@/components/features/orders/order-copy';
import { paymentLabel, transactionLabel } from '@/components/features/payments/payment-labels';

type Tx = { id: string; amount: number; status: string; type: string; currency?: string };
type Dp = { id: string; status: string; reason: string | null };
type Pay = { id: string; status: string; amount: number; currency?: string; buyer_id: string; seller_id: string; stripe_payment_intent: string | null; buyer_confirmed?: boolean; seller_confirmed?: boolean; role_review_required?: boolean };
const columns = 'id,status,amount,currency,buyer_id,seller_id,stripe_payment_intent,buyer_confirmed,seller_confirmed,role_review_required';
const copies = {
  en: { title: 'Payments', mine: 'My payments', status: 'Status', amount: 'Amount', actions: 'Actions', buyer: 'I received my purchase', seller: 'I completed my service', capture: 'Finalize payment', saving: 'Saving…', noPayments: 'No payments yet.', transactions: 'Transactions', type: 'Type', noTransactions: 'No transactions yet.', disputes: 'Disputes', reason: 'Reason', noDisputes: 'No disputes.', disabled: 'Payments are currently unavailable. You can still view your history.', loading: 'Loading payments…', retry: 'Try again', refresh: 'Refresh', submitted: 'The payment request was received. Its final status is being verified; refresh to check it.', loadError: 'Payments could not be loaded.', confirmError: 'Confirmation could not be saved.', refreshError: 'The request was saved, but its updated status could not be loaded. Refresh before trying again.', captureError: 'Payment could not be captured.', legacyReview: 'This older request payment needs administrator review.', legacyCapture: 'This older request payment needs administrator review before it can be captured.' },
  el: { title: 'Πληρωμές', mine: 'Οι πληρωμές μου', status: 'Κατάσταση', amount: 'Ποσό', actions: 'Ενέργειες', buyer: 'Παρέλαβα την αγορά', seller: 'Ολοκλήρωσα την παροχή', capture: 'Οριστικοποίηση πληρωμής', saving: 'Αποθήκευση…', noPayments: 'Δεν υπάρχουν πληρωμές ακόμη.', transactions: 'Συναλλαγές', type: 'Τύπος', noTransactions: 'Δεν υπάρχουν συναλλαγές ακόμη.', disputes: 'Αμφισβητήσεις', reason: 'Αιτία', noDisputes: 'Δεν υπάρχουν αμφισβητήσεις.', disabled: 'Οι πληρωμές δεν είναι διαθέσιμες αυτή τη στιγμή. Μπορείς να δεις το ιστορικό σου.', loading: 'Φόρτωση πληρωμών…', retry: 'Δοκίμασε ξανά', refresh: 'Ανανέωση', submitted: 'Το αίτημα πληρωμής παραλήφθηκε. Το τελικό αποτέλεσμα επαληθεύεται· ανανέωσε για να το ελέγξεις.', loadError: 'Δεν ήταν δυνατή η φόρτωση των πληρωμών.', confirmError: 'Δεν ήταν δυνατή η αποθήκευση της επιβεβαίωσης.', refreshError: 'Το αίτημα αποθηκεύτηκε, αλλά δεν φορτώθηκε η ενημερωμένη κατάστασή του. Ανανέωσε πριν δοκιμάσεις ξανά.', captureError: 'Η πληρωμή δεν μπόρεσε να ολοκληρωθεί.', legacyReview: 'Αυτή η παλαιότερη πληρωμή αιτήματος χρειάζεται έλεγχο από διαχειριστή.', legacyCapture: 'Αυτή η παλαιότερη πληρωμή αιτήματος χρειάζεται έλεγχο από διαχειριστή πριν ολοκληρωθεί.' },
};

export default function PaymentsPage() {
  const { locale } = useI18n();
  const language = locale === 'el' ? 'el' : 'en';
  const copy = copies[language];
  const paymentsEnabled = (process.env.NEXT_PUBLIC_PAYMENTS_ENABLED || '').toLowerCase() === 'true';
  const [txs, setTxs] = useState<Tx[]>([]);
  const [dps, setDps] = useState<Dp[]>([]);
  const [pays, setPays] = useState<Pay[]>([]);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [notice, setNotice] = useState('');
  const locked = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const current = ++generation.current;
    async function load() {
      setLoading(true); setLoadFailed(false); setError(''); setNotice(''); setNeedsRefresh(false);
      const user = await supabase.auth.getUser();
      if (user.error || !user.data.user) throw new Error('Session unavailable');
      const profile = await supabase.from('profiles').select('id').eq('user_id', user.data.user.id).limit(1).single();
      if (profile.error || !profile.data?.id) throw new Error('Profile unavailable');
      const payments = await supabase.from('payments').select(columns).or(`buyer_id.eq.${profile.data.id},seller_id.eq.${profile.data.id}`);
      if (payments.error) throw payments.error;
      const ids = (payments.data || []).map(payment => payment.id);
      let transactions: Tx[] = []; let disputes: Dp[] = [];
      if (ids.length) {
        const [tx, dp] = await Promise.all([
          supabase.from('transactions').select('id,amount,status,type,payment_id').in('payment_id', ids),
          supabase.from('disputes').select('id,status,reason').in('payment_id', ids),
        ]);
        if (tx.error || dp.error) throw new Error('History unavailable');
        transactions = (tx.data || []).map(row => ({ ...row, currency: payments.data?.find(payment => payment.id === row.payment_id)?.currency || 'eur' }));
        disputes = (dp.data || []) as Dp[];
      }
      if (!cancelled) { setMyProfileId(profile.data.id); setPays((payments.data || []) as Pay[]); setTxs(transactions); setDps(disputes); }
    }
    void load().catch(() => { if (!cancelled) setLoadFailed(true); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; generation.current = current + 1; };
  }, [attempt]);

  async function update(payment: Pay, side: 'buyer' | 'seller' | 'capture') {
    if (!paymentsEnabled || loading || needsRefresh || locked.current || !myProfileId || payment.role_review_required || payment.status !== 'requires_capture') return;
    if (side !== 'capture' && (myProfileId !== payment[`${side}_id`] || payment[`${side}_confirmed`])) return;
    if (side === 'capture' && (myProfileId !== payment.buyer_id || !payment.stripe_payment_intent || !payment.buyer_confirmed || !payment.seller_confirmed)) return;
    locked.current = true;
    const current = generation.current;
    let saved = false;
    setError(''); setNotice(''); setBusy(payment.id);
    try {
      if (side === 'capture') {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        if (session.error || !token) throw new Error(copy.captureError);
        const headers = await withCsrfHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });
        if (!headers['X-CSRF-Token']) throw new Error(copy.captureError);
        const response = await fetch('/api/payments/capture', { method: 'POST', headers, body: JSON.stringify({ intentId: payment.stripe_payment_intent }) });
        if (!response.ok) {
          const result = await response.json().catch(() => null);
          const message = result?.error?.message || (typeof result?.error === 'string' ? result.error : null);
          throw new Error(message === copies.en.legacyCapture ? copy.legacyCapture : language === 'el' ? copy.captureError : message || copy.captureError);
        }
      } else {
        const result = await supabase.from('payments').update({ [`${side}_confirmed`]: true }).eq('id', payment.id);
        if (result.error) throw new Error(language === 'el' ? copy.confirmError : result.error.message);
      }
      saved = true;
      const refreshed = await supabase.from('payments').select(columns).eq('id', payment.id).single();
      if (refreshed.error || !refreshed.data) throw new Error(copy.refreshError);
      if (current === generation.current) {
        setPays(previous => previous.map(row => row.id === payment.id ? refreshed.data as Pay : row));
        if (side === 'capture') setNotice(copy.submitted);
      }
    } catch (failure) {
      if (current === generation.current) { setNeedsRefresh(saved); setError(failure instanceof Error ? failure.message : copy.captureError); }
    } finally { locked.current = false; if (current === generation.current) setBusy(null); }
  }

  return <div className="needs-shell needs-page space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">{copy.title}</h1><Button variant="outline" disabled={loading || !!busy} onClick={() => setAttempt(value => value + 1)}>{copy.refresh}</Button></header>
    {loading ? <p role="status">{copy.loading}</p> : loadFailed ? <div role="alert" className="space-y-3 rounded-2xl border p-5"><p>{copy.loadError}</p><Button onClick={() => setAttempt(value => value + 1)} variant="outline">{copy.retry}</Button></div> : <>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="rounded-xl bg-muted p-3 text-sm">{notice}</p>}
      {!paymentsEnabled && <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">{copy.disabled}</p>}
      <section className="space-y-3"><h2 className="text-xl font-semibold">{copy.mine}</h2><div className="overflow-x-auto rounded-2xl border"><table className="w-full text-sm"><caption className="sr-only">{copy.mine}</caption><thead><tr className="bg-muted/40 text-left"><th scope="col" className="p-3">{copy.status}</th><th scope="col" className="p-3">{copy.amount}</th><th scope="col" className="p-3">{copy.actions}</th></tr></thead><tbody>
        {pays.map(payment => <tr key={payment.id} className="border-t"><td className="p-3">{paymentLabel(payment.status, language)}{payment.role_review_required && <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">{copy.legacyReview}</p>}</td><td className="whitespace-nowrap p-3">{orderMoney(Number(payment.amount), payment.currency || 'eur', language)}</td><td className="p-3"><div className="flex flex-wrap gap-2">
          {paymentsEnabled && payment.status === 'requires_capture' && <>
            {myProfileId === payment.buyer_id && <Button variant="outline" disabled={payment.role_review_required || !!busy || needsRefresh || payment.buyer_confirmed} onClick={() => { void update(payment, 'buyer'); }}>{busy === payment.id ? copy.saving : copy.buyer}</Button>}
            {myProfileId === payment.seller_id && <Button variant="outline" disabled={payment.role_review_required || !!busy || needsRefresh || payment.seller_confirmed} onClick={() => { void update(payment, 'seller'); }}>{busy === payment.id ? copy.saving : copy.seller}</Button>}
            {payment.stripe_payment_intent && myProfileId === payment.buyer_id && <Button disabled={payment.role_review_required || !!busy || needsRefresh || !payment.buyer_confirmed || !payment.seller_confirmed} onClick={() => { void update(payment, 'capture'); }}>{busy === payment.id ? copy.saving : copy.capture}</Button>}
          </>}
        </div></td></tr>)}
        {!pays.length && <tr><td className="p-5 text-muted-foreground" colSpan={3}>{copy.noPayments}</td></tr>}
      </tbody></table></div></section>
      <div className="grid gap-6 md:grid-cols-2"><section className="space-y-3"><h2 className="text-xl font-semibold">{copy.transactions}</h2><div className="overflow-x-auto rounded-2xl border"><table className="w-full text-sm"><caption className="sr-only">{copy.transactions}</caption><thead><tr className="bg-muted/40 text-left"><th scope="col" className="p-3">{copy.type}</th><th scope="col" className="p-3">{copy.status}</th><th scope="col" className="p-3">{copy.amount}</th></tr></thead><tbody>
        {txs.map(tx => <tr key={tx.id} className="border-t"><td className="p-3">{transactionLabel(tx.type, language)}</td><td className="p-3">{paymentLabel(tx.status, language)}</td><td className="whitespace-nowrap p-3">{orderMoney(Number(tx.amount), tx.currency || 'eur', language)}</td></tr>)}
        {!txs.length && <tr><td className="p-5 text-muted-foreground" colSpan={3}>{copy.noTransactions}</td></tr>}
      </tbody></table></div></section><section className="space-y-3"><h2 className="text-xl font-semibold">{copy.disputes}</h2><div className="overflow-x-auto rounded-2xl border"><table className="w-full text-sm"><caption className="sr-only">{copy.disputes}</caption><thead><tr className="bg-muted/40 text-left"><th scope="col" className="p-3">{copy.status}</th><th scope="col" className="p-3">{copy.reason}</th></tr></thead><tbody>
        {dps.map(dispute => <tr key={dispute.id} className="border-t"><td className="p-3">{paymentLabel(dispute.status, language)}</td><td className="p-3">{dispute.reason || '—'}</td></tr>)}
        {!dps.length && <tr><td className="p-5 text-muted-foreground" colSpan={2}>{copy.noDisputes}</td></tr>}
      </tbody></table></div></section></div>
    </>}
  </div>;
}
