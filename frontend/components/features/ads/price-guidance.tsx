"use client";

import { useEffect, useId, useRef, useState } from 'react';
import { ChartNoAxesCombined, ChevronDown, Loader2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/contexts/i18n-context';
import { parseListingPrice } from '@/lib/services/listing-service';
import { supabase } from '@/lib/supabase/client';
import { withCsrfHeaders } from '@/lib/utils/csrf';
import type { PriceGuidance as Guidance, PriceRange, PricingSubject } from '@/lib/pricing/types';

type Props = { subject: PricingSubject; price: string };
const units = {
  item: { el: 'ανά τεμάχιο', en: 'per item' },
  hour: { el: 'ανά ώρα', en: 'per hour' },
  day: { el: 'ανά ημέρα', en: 'per day' },
  month: { el: 'ανά μήνα', en: 'per month' },
  job: { el: 'ανά εργασία', en: 'per job' },
};
const unavailable: Guidance = { status: 'unavailable', range: null, sampleSize: 0, basis: null, unit: 'item', retailRange: null, reason: 'temporary_error' };

function validRange(value: unknown): value is PriceRange {
  if (!value || typeof value !== 'object') return false;
  const range = value as PriceRange;
  return [range.low, range.high, range.median].every(amount => typeof amount === 'number' && Number.isFinite(amount) && amount >= 0)
    && range.low <= range.median && range.median <= range.high;
}

function validGuidance(value: unknown): value is Guidance {
  if (!value || typeof value !== 'object') return false;
  const result = value as Guidance;
  return ['ready', 'insufficient_data', 'unavailable'].includes(result.status)
    && Object.hasOwn(units, result.unit) && Number.isInteger(result.sampleSize) && result.sampleSize >= 0
    && (result.retailRange === null || validRange(result.retailRange))
    && (result.status !== 'ready' || (validRange(result.range) && result.sampleSize > 0 && (result.basis === 'needs_asking' || result.basis === 'new_retail')));
}

export function PriceGuidance({ subject, price }: Props) {
  if (!['Sell', 'I will', 'I can'].includes(subject.subCategory)) return null;
  // Draft identity changes remount the reference and abort its request. Price edits retain it.
  const identity = JSON.stringify([subject.title, subject.description, subject.mainCategory, subject.subCategory, subject.coordinates]);
  return <PriceGuidanceReference key={identity} subject={subject} price={price} />;
}

function PriceGuidanceReference({ subject, price }: Props) {
  const { locale } = useI18n();
  const el = locale === 'el';
  const panelId = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(() => () => activeRequest.current?.abort(), []);

  const lookup = async () => {
    if (activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setDetailsOpen(false);
    setLoading(true);
    setGuidance(null);
    try {
      const session = await supabase.auth.getSession();
      if (controller.signal.aborted) return;
      const token = session.data.session?.access_token;
      if (session.error || !token) throw new Error('Session unavailable');
      const headers = await withCsrfHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });
      if (controller.signal.aborted) return;
      if (!headers['X-CSRF-Token']) throw new Error('Secure request unavailable');
      const response = await fetch('/api/pricing/guidance', { method: 'POST', credentials: 'include', headers, body: JSON.stringify(subject), signal: controller.signal });
      if (!response.ok) throw new Error('Reference unavailable');
      const result: unknown = await response.json();
      if (!validGuidance(result)) throw new Error('Invalid reference');
      if (!controller.signal.aborted) setGuidance(result);
    } catch {
      if (!controller.signal.aborted) setGuidance(unavailable);
    } finally {
      if (!controller.signal.aborted) { activeRequest.current = null; setLoading(false); }
    }
  };

  let amount: number | null = null;
  if (price.trim()) {
    try { amount = parseListingPrice(price); } catch { /* Invalid price input stays neutral. */ }
  }
  const range = guidance?.status === 'ready' ? guidance.range : null;
  const comparableAmount = amount !== null && amount > 0 ? amount : null;
  const tone = range && comparableAmount !== null ? (comparableAmount < range.low ? 'below' : comparableAmount > range.high ? 'above' : 'within') : 'neutral';
  const currency = (value: number) => new Intl.NumberFormat(el ? 'el-GR' : 'en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(value);
  const formatRange = (value: PriceRange) => `${currency(value.low)} – ${currency(value.high)}`;
  // Higher prices move left. A collapsed interval uses a modest span around its midpoint.
  const spread = range && comparableAmount !== null
    ? (comparableAmount <= range.median ? range.median - range.low : range.high - range.median) || Math.max(range.median * 0.2, 1)
    : 1;
  const position = range && comparableAmount !== null
    ? Math.round(Math.min(96, Math.max(4, 50 + (range.median - comparableAmount) / spread * 25)) * 100) / 100
    : null;
  const context = guidance?.basis === 'new_retail' ? {
    below: el ? 'κάτω από τις τιμές καινούριων' : 'below new retail prices',
    within: el ? 'μέσα στο εύρος τιμών καινούριων' : 'within new retail prices',
    above: el ? 'πάνω από τις τιμές καινούριων' : 'above new retail prices',
  } : {
    below: el ? 'κάτω από τις συγκρίσιμες ζητούμενες τιμές' : 'below comparable asking prices',
    within: el ? 'μέσα στο εύρος των ζητούμενων τιμών' : 'within comparable asking prices',
    above: el ? 'πάνω από τις συγκρίσιμες ζητούμενες τιμές' : 'above comparable asking prices',
  };
  const status = loading ? (el ? 'Έλεγχος…' : 'Checking…')
    : tone === 'below' ? (el ? 'Ανταγωνιστική' : 'Competitive')
      : tone === 'within' ? (el ? 'Στο εύρος' : 'In range')
        : tone === 'above' ? (el ? 'Υψηλή' : 'High')
          : range ? (el ? 'Βάλε θετική τιμή' : 'Enter a positive price')
            : guidance?.status === 'unavailable' ? (el ? 'Μη διαθέσιμη' : 'Unavailable')
              : (el ? 'Λίγα δεδομένα' : 'Not enough data');
  const toneClass = {
    below: 'text-emerald-700 dark:text-emerald-300',
    within: 'text-yellow-800 dark:text-yellow-300',
    above: 'text-red-700 dark:text-red-300',
    neutral: 'text-muted-foreground',
  }[tone];
  const meterText = range && comparableAmount !== null && guidance && tone !== 'neutral'
    ? `${currency(comparableAmount)} ${units[guidance.unit][el ? 'el' : 'en']} · ${context[tone]}. ${el ? 'Εύρος αναφοράς' : 'Reference range'}: ${formatRange(range)}.`
    : undefined;
  const neutralMessage = guidance?.status === 'unavailable'
    ? (el ? 'Η εκτίμηση δεν είναι διαθέσιμη τώρα. Μπορείς να ορίσεις τη δική σου τιμή.' : 'Price guidance is unavailable right now. You can still set your own price.')
    : guidance?.reason === 'missing_details'
      ? subject.mainCategory === 'Services'
        ? (el ? 'Πρόσθεσε υπηρεσία, εύρος εργασίας, μονάδα χρέωσης και τοποθεσία για σύγκριση.' : 'Add the service, scope, rate unit and location to compare.')
        : (el ? 'Πρόσθεσε το ακριβές μοντέλο και την κατάσταση για σύγκριση.' : 'Add the exact model and condition to compare.')
      : (el ? 'Δεν υπάρχουν ακόμη αρκετές συγκρίσιμες αγγελίες.' : 'Not enough comparable listings yet.');

  return <div className="mt-1 min-w-0" aria-busy={loading}>
    {(loading || guidance) && <div className="relative mx-1 h-7" role={position !== null ? 'meter' : undefined}
      aria-label={position !== null ? (el ? 'Σύγκριση τιμής' : 'Price comparison') : undefined}
      aria-valuemin={position !== null ? 0 : undefined} aria-valuemax={position !== null ? 100 : undefined}
      aria-valuenow={position ?? undefined} aria-valuetext={meterText}>
      <div aria-hidden="true" className={`absolute inset-x-0 bottom-0 h-3 rounded-full shadow-inner ring-2 ring-muted ${position !== null ? 'bg-[linear-gradient(90deg,#dc2626_0%,#f97316_25%,#facc15_50%,#a3d635_72%,#16a34a_100%)]' : 'bg-muted-foreground/20'}`} />
      {position !== null && <MapPin aria-hidden="true" className="absolute top-0 h-4 w-4 -translate-x-1/2 fill-background text-foreground motion-safe:transition-[left] motion-safe:duration-200 motion-safe:ease-out motion-reduce:transition-none" style={{ left: `${position}%` }} strokeWidth={1.75} />}
    </div>}
    <div className="flex min-w-0 items-center justify-between gap-2">
      {(loading || guidance) && <p role="status" aria-live="polite" aria-atomic="true" className={`text-xs font-medium ${toneClass}`}>{status}</p>}
      <Button type="button" variant="ghost" disabled={loading} aria-expanded={guidance ? detailsOpen : undefined} aria-controls={guidance ? panelId : undefined}
        className="h-11 gap-1.5 rounded-lg px-1 text-xs font-medium text-primary"
        onClick={() => { if (!guidance) void lookup(); else setDetailsOpen(value => !value); }}>
        {!guidance && (loading ? <Loader2 className="h-3.5 w-3.5 shrink-0 motion-safe:animate-spin" aria-hidden="true" /> : <ChartNoAxesCombined className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />)}
        {guidance ? (el ? 'Λεπτομέρειες' : 'Details') : (el ? 'Έλεγχος τιμής' : 'Check price')}
        {guidance && <ChevronDown className={`h-3 w-3 shrink-0 motion-safe:transition-transform ${detailsOpen ? 'rotate-180' : ''}`} aria-hidden="true" />}
      </Button>
    </div>
    {detailsOpen && guidance && <div id={panelId} className="space-y-2 border-t border-border py-2 text-xs leading-5 text-muted-foreground motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
      {range ? <>
        <p className="font-medium text-foreground">{el ? 'Ενδεικτικό εύρος' : 'Reference range'}: {formatRange(range)} <span className="font-normal">{units[guidance.unit][el ? 'el' : 'en']}</span></p>
        <p>{guidance.basis === 'needs_asking'
          ? (el ? `${guidance.sampleSize} δημόσιες αγγελίες NEEDS · ζητούμενες τιμές, όχι ολοκληρωμένες πωλήσεις.` : `${guidance.sampleSize} public NEEDS listings · asking prices, not completed sales.`)
          : (el ? `${guidance.sampleSize} προσφορές καταστημάτων για καινούριο προϊόν.` : `${guidance.sampleSize} new-item retail offers.`)}</p>
        <p>{el ? 'Η χαμηλότερη τιμή μπορεί να προσελκύει ενδιαφέρον· δεν είναι απαραίτητα η καλύτερη για εσένα.' : 'A lower price may attract interest; it is not necessarily better for you.'}</p>
      </> : <p>{neutralMessage}</p>}
      {guidance.retailRange && guidance.basis !== 'new_retail' && <p className="border-t border-border pt-2">{el ? 'Αναφορά καινούριου σε καταστήματα' : 'New retail reference'}: {formatRange(guidance.retailRange)}. {el ? 'Αφορά καινούριο προϊόν, όχι εκτίμηση της αξίας του μεταχειρισμένου.' : 'For a new item; not an estimate of this used item’s value.'}</p>}
      {guidance.status === 'unavailable' && <Button type="button" variant="ghost" size="sm" className="-ml-2 text-xs text-primary" onClick={() => { void lookup(); }}>{el ? 'Δοκίμασε ξανά' : 'Try again'}</Button>}
    </div>}
  </div>;
}
