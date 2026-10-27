import { rateLimitEnhanced } from '@/lib/utils/rate-limit-enhanced'
import { getProductIdentity, type ProductIdentity } from './matching'
import { scrapeGreekRetail } from './greek-retail'
import type { PricingSubject, RetailComparison } from './types'

const cache = new Map<string, { until: number; value: RetailComparison }>()
const pending = new Map<string, Promise<RetailComparison>>()
const unavailable = (): RetailComparison => ({ status: 'unavailable', offers: [], reason: 'provider_unavailable' })
const empty = (): RetailComparison => ({ status: 'insufficient_data', offers: [], reason: 'not_enough_comparables' })

async function lookup(identity: ProductIdentity): Promise<RetailComparison> {
  try {
    // Shared limits bound catalogue traffic across server processes; no paid provider is called.
    const configured = Number(process.env.PRICING_SEARCH_DAILY_LIMIT || 100)
    const limit = Number.isInteger(configured) && configured > 0 && configured <= 1000 ? configured : 100
    const burst = await rateLimitEnhanced('pricing:discovery:minute', 3, 60000, { failClosed: true })
    if (!burst.allowed) return unavailable()
    const daily = await rateLimitEnhanced('pricing:discovery:daily', limit, 86400000, { failClosed: true })
    if (!daily.allowed) return unavailable()
    const { offers, checked } = await scrapeGreekRetail(identity)
    return offers.length ? { status: 'ready', offers } : checked ? empty() : unavailable()
  } catch { return unavailable() }
}

export async function getRetailComparison(subject: PricingSubject): Promise<RetailComparison> {
  if (subject.mainCategory !== 'Items' || subject.subCategory !== 'Sell') return { status: 'insufficient_data', offers: [], reason: 'unsupported' }
  const identity = getProductIdentity(subject)
  if (!identity) return { status: 'insufficient_data', offers: [], reason: 'missing_details' }
  if (process.env.PRICING_RETAIL_ENABLED === 'false' || process.env.NEEDS_E2E === '1') return unavailable()
  const key = identity.query
  const hit = cache.get(key)
  if (hit && hit.until > Date.now()) return hit.value
  const running = pending.get(key)
  if (running) return running
  if (pending.size >= 2) return unavailable()
  const task = lookup(identity).then(value => {
    if (cache.size >= 300) cache.delete(cache.keys().next().value!)
    cache.set(key, { value, until: Date.now() + (value.status === 'ready' ? 6 * 3600000 : 10 * 60000) })
    return value
  }).finally(() => { pending.delete(key) })
  pending.set(key, task)
  return task
}
