"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { withCsrfHeaders } from '@/lib/utils/csrf';
import { useI18n } from '@/contexts/i18n-context';
import { Button } from '@/components/ui/button';
import { orderMoney } from '@/components/features/orders/order-copy';
import { paymentLabel } from '@/components/features/payments/payment-labels';
import { paymentFlowCopy, paymentFlowError } from '@/components/features/payments/payment-flow-copy';

type Pay = { id: string; status: string; amount: number; currency?: string; buyer_id: string; seller_id: string; stripe_payment_intent: string | null; buyer_confirmed?: boolean; seller_confirmed?: boolean };
type FlowError = { message: string; kind: 'loadError' | 'captureError' | 'captureRefreshError' };
const columns = 'id,status,amount,currency,buyer_id,seller_id,stripe_payment_intent,buyer_confirmed,seller_confirmed';

export default function PaymentReturnPage() {
  const { locale } = useI18n();
  const language = locale === 'el' ? 'el' : 'en';
  const copy = paymentFlowCopy[language];
  const [pays, setPays] = useState<Pay[]>([]);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [error, setError] = useState<FlowError | null>(null);
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pendingVerification, setPendingVerification] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const generation = useRef(0);
  const locked = useRef(false);

  useEffect(() => {
    const current = ++generation.current;
    async function load() {
      setLoading(true); setError(null); setRefreshRequired(false);
      try {
        const user = await supabase.auth.getUser();
        const userId = user.data.user?.id;
        if (user.error || !userId) throw new Error('Sign in to view your payments.');
        const profile = await supabase.from('profiles').select('id').eq('user_id', userId).limit(1).single();
        if (profile.error || !profile.data?.id) throw new Error('Your payment profile could not be loaded.');
        const payments = await supabase.from('payments').select(columns)
          .or(`buyer_id.eq.${profile.data.id},seller_id.eq.${profile.data.id}`).order('created_at', { ascending: false }).limit(10);
        if (payments.error) throw new Error(paymentFlowCopy.en.loadError);
        if (current === generation.current) {
          setMyProfileId(profile.data.id); setPays((payments.data || []) as Pay[]);
          setPendingVerification(false);
        }
      } catch (cause) {
        if (current === generation.current) { setRefreshRequired(true); setError({ message: cause instanceof Error ? cause.message : paymentFlowCopy.en.loadError, kind: 'loadError' }); }
      } finally { if (current === generation.current) setLoading(false); }
    }
    void load();
    return () => { generation.current = current + 1; };
  }, [attempt]);

  async function capture(payment: Pay) {
    if (locked.current || loading || refreshRequired || myProfileId !== payment.buyer_id || !payment.stripe_payment_intent || payment.status !== 'requires_capture' || !payment.buyer_confirmed || !payment.seller_confirmed) return;
    locked.current = true;
    const current = generation.current;
    let accepted = false;
    setCapturing(payment.id); setError(null); setPendingVerification(false);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (session.error || !token) throw new Error('Sign in again before capturing this payment.');
      const headers = await withCsrfHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });
      if (!headers['X-CSRF-Token']) throw new Error('Could not prepare a secure request. Refresh and try again.');
      if (current !== generation.current) return;
      const response = await fetch('/api/payments/capture', { method: 'POST', headers, body: JSON.stringify({ intentId: payment.stripe_payment_intent }) });
      const result = await response.json();
      if (!response.ok || (!result.captured && !result.pending && response.status !== 202)) {
        throw new Error(result?.error?.message || (typeof result?.error === 'string' ? result.error : paymentFlowCopy.en.captureError));
      }
      accepted = true;
      const refreshed = await supabase.from('payments').select(columns).eq('id', payment.id).single();
      if (refreshed.error || !refreshed.data) throw new Error(paymentFlowCopy.en.captureRefreshError);
      if (current === generation.current) {
        setPays(previous => previous.map(row => row.id === payment.id ? refreshed.data as Pay : row));
        const pending = !['completed', 'refunded', 'disputed'].includes(refreshed.data.status);
        setPendingVerification(pending);
        setRefreshRequired(pending);
      }
    } catch (cause) {
      if (current === generation.current) {
        setRefreshRequired(accepted);
        setError({ message: cause instanceof Error ? cause.message : paymentFlowCopy.en.captureError, kind: accepted ? 'captureRefreshError' : 'captureError' });
      }
    } finally { locked.current = false; if (current === generation.current) setCapturing(null); }
  }

  return <div className="needs-shell needs-page space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">{copy.paymentStatus}</h1><Button variant="outline" disabled={loading || capturing !== null} onClick={() => setAttempt(value => value + 1)}>{copy.refresh}</Button></header>
    <p className="text-muted-foreground">{copy.nextSteps}</p>
    {error && <p role="alert" className="text-sm text-destructive">{paymentFlowError(error.message, language, error.kind)}</p>}
    {pendingVerification && <p role="status" className="rounded-xl bg-muted p-3 text-sm">{copy.pending}</p>}
    {loading ? <p role="status" className="text-sm text-muted-foreground">{copy.loading}</p> : <div className="overflow-x-auto rounded-xl border p-3"><table className="w-full text-sm"><caption className="sr-only">{copy.paymentStatus}</caption><thead><tr className="text-left"><th scope="col" className="p-2">{copy.status}</th><th scope="col" className="p-2">{copy.amount}</th><th scope="col" className="p-2">{copy.actions}</th></tr></thead><tbody>
      {pays.map(payment => <tr key={payment.id} className="border-t"><td className="p-2">{paymentLabel(payment.status, language)}</td><td className="whitespace-nowrap p-2">{orderMoney(Number(payment.amount), payment.currency || 'eur', language)}</td><td className="p-2"><div className="flex flex-wrap gap-2">
        <Button asChild variant="outline"><Link href="/dashboard/payments">{copy.goPayments}</Link></Button>
        {myProfileId === payment.buyer_id && payment.stripe_payment_intent && payment.status === 'requires_capture' && <Button disabled={!payment.buyer_confirmed || !payment.seller_confirmed || capturing !== null || refreshRequired} onClick={() => { void capture(payment); }}>{capturing === payment.id ? copy.capturing : copy.capture}</Button>}
      </div></td></tr>)}
      {!pays.length && !error && <tr><td className="p-2" colSpan={3}>{copy.noRecent}</td></tr>}
    </tbody></table></div>}
  </div>;
}
