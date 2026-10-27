'use client'

import { useEffect, useState } from 'react'
import { ArrowUpRight, Store } from 'lucide-react'
import { useI18n } from '@/contexts/i18n-context'
import { MAX_RETAIL_OFFERS, type RetailComparison as RetailResult } from '@/lib/pricing/types'

function validResult(value: unknown): value is RetailResult {
  if (!value || typeof value !== 'object') return false
  const result = value as RetailResult
  return ['ready', 'insufficient_data', 'unavailable'].includes(result.status) && Array.isArray(result.offers)
    && result.offers.length <= MAX_RETAIL_OFFERS && result.offers.every(offer => {
      if (!offer || typeof offer.shop !== 'string' || typeof offer.price !== 'number' || !Number.isFinite(offer.price) || offer.price <= 0 || typeof offer.url !== 'string') return false
      try { const url = new URL(offer.url); return url.protocol === 'https:' && !url.username && !url.password } catch { return false }
    })
}

export function RetailComparison({ listingId }: { listingId: string }) {
  const { locale } = useI18n()
  const el = locale === 'el'
  const [state, setState] = useState<{ id: string; result: RetailResult | null }>({ id: listingId, result: null })
  const result = state.id === listingId ? state.result : null
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    fetch(`/api/pricing/retail?listingId=${encodeURIComponent(listingId)}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Comparison unavailable')
        const value: unknown = await response.json()
        if (!validResult(value)) throw new Error('Invalid comparison')
        return value
      }).then(value => { if (active) setState({ id: listingId, result: value }) })
      .catch(() => { if (active) setState({ id: listingId, result: { status: 'unavailable', offers: [] } }) })
    return () => { active = false; controller.abort() }
  }, [listingId])
  return <section aria-labelledby="retail-comparison-heading" className="mt-10 min-w-0 border-t border-border pt-7">
    <h2 id="retail-comparison-heading" className="flex items-center gap-2.5 text-xl font-semibold tracking-tight">
      <Store className="h-5 w-5 text-muted-foreground" aria-hidden="true" />{el ? 'Το ίδιο προϊόν καινούργιο' : 'The same product, new'}
    </h2>
    {!result ? <p role="status" className="mt-4 text-sm text-muted-foreground">{el ? 'Αναζήτηση τιμών καταστημάτων…' : 'Looking up store prices…'}</p>
      : result.status === 'ready' && result.offers.length > 0 ? <ul className="mt-4 max-w-2xl divide-y divide-border">
        {result.offers.map(offer => <li key={offer.url}>
          <a href={offer.url} target="_blank" rel="noopener noreferrer" className="group flex min-h-16 items-center justify-between gap-4 rounded-lg px-2 py-3 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
            <span className="min-w-0 break-words font-medium">{offer.shop}</span>
            <span className="flex shrink-0 items-center gap-3"><span className="font-semibold tabular-nums">{new Intl.NumberFormat(el ? 'el-GR' : 'en-IE', { style: 'currency', currency: 'EUR' }).format(offer.price)}</span><ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none" aria-hidden="true" /></span>
            <span className="sr-only">{el ? 'Ανοίγει το προϊόν στο κατάστημα σε νέα καρτέλα' : 'Opens the product at the store in a new tab'}</span>
          </a>
        </li>)}
      </ul> : <p role="status" className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">{result.status === 'unavailable'
        ? (el ? 'Οι τιμές καταστημάτων δεν είναι διαθέσιμες αυτή τη στιγμή.' : 'Store prices are currently unavailable.')
        : (el ? 'Δεν βρέθηκαν επιβεβαιωμένες τιμές για το ίδιο προϊόν καινούργιο.' : 'No verified new offers were found for this exact product.')}</p>}
  </section>
}
