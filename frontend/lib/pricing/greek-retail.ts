import type { ProductIdentity } from './matching'
import { readRetailPage, safeRetailUrl } from './merchant-verifier'
import { eShopAdapter } from './merchants/e-shop'
import { mrCheapAdapter } from './merchants/mrcheap'
import { sonyCentersAdapter } from './merchants/sony-centers'
import { mSystemsAdapter } from './merchants/msystems'
import { musiclandAdapter } from './merchants/musicland'
import { photoagoraAdapter } from './merchants/photoagora'
import { mpakasDiyAdapter } from './merchants/mpakas-diy'
import { babizosAdapter } from './merchants/babizos'
import { cosmodataAdapter } from './merchants/cosmodata'
import type { MerchantAdapter } from './merchants/types'
import { MAX_RETAIL_OFFERS, type RetailOffer } from './types'

export const GREEK_RETAILERS: readonly MerchantAdapter[] = [
  eShopAdapter, mrCheapAdapter, sonyCentersAdapter, mSystemsAdapter,
  musiclandAdapter, photoagoraAdapter, mpakasDiyAdapter, babizosAdapter, cosmodataAdapter,
]

function belongsToMerchant(value: string, adapter: MerchantAdapter): string | null {
  const safe = safeRetailUrl(value)
  if (!safe) return null
  const host = (url: string) => new URL(url).hostname.replace(/^www\./, '')
  return host(safe) === host(adapter.origin) ? safe : null
}

/** One search plus at most three product pages; a blocked shop never blocks the others. */
export async function scrapeMerchant(adapter: MerchantAdapter, identity: ProductIdentity, lookupDeadline = Date.now() + 15000): Promise<{ offer: RetailOffer | null; checked: boolean }> {
  const empty = { offer: null, checked: false }
  try {
    const search = adapter.searchUrl(identity)
    const searchUrl = search && belongsToMerchant(search, adapter)
    if (!searchUrl) return empty
    const deadline = Math.min(lookupDeadline, Date.now() + 15000)
    if (Date.now() >= deadline) return empty
    const page = await readRetailPage(searchUrl, Math.min(deadline, Date.now() + 7000))
    if (!page) return empty
    const candidates = [...new Set(adapter.productLinks(page.html, page.url, identity)
      .map(url => belongsToMerchant(url, adapter)).filter((url): url is string => !!url))].slice(0, 3)
    let checked = candidates.length === 0
    for (const url of candidates) {
      if (Date.now() >= deadline) break
      const product = await readRetailPage(url, Math.min(deadline, Date.now() + 7000))
      if (!product) continue
      checked = true
      const offer = adapter.parseOffer(product.html, product.url, identity)
      const destination = offer && belongsToMerchant(offer.url, adapter)
      if (offer && destination && Number.isFinite(offer.price) && offer.price > 0 && offer.price <= 10000000) {
        return { offer: { shop: adapter.name, price: offer.price, url: destination }, checked: true }
      }
    }
    return { offer: null, checked }
  } catch { return empty }
}

/** Uses merchants' own public search forms; no search-engine or paid API dependency. */
export async function scrapeGreekRetail(identity: ProductIdentity): Promise<{ offers: RetailOffer[]; checked: number }> {
  // A larger source list must not create a burst of simultaneous store requests.
  const deadline = Date.now() + 25000
  let next = 0
  const results: Awaited<ReturnType<typeof scrapeMerchant>>[] = []
  await Promise.all(Array.from({ length: Math.min(3, GREEK_RETAILERS.length) }, async () => {
    while (next < GREEK_RETAILERS.length && Date.now() < deadline) {
      const adapter = GREEK_RETAILERS[next++]
      results.push(await scrapeMerchant(adapter, identity, deadline))
    }
  }))
  const shops = new Map<string, RetailOffer>()
  for (const { offer } of results) {
    if (!offer) continue
    const host = new URL(offer.url).hostname.replace(/^www\./, '')
    const previous = shops.get(host)
    if (!previous || offer.price < previous.price) shops.set(host, offer)
  }
  return {
    offers: [...shops.values()].sort((a, b) => a.price - b.price).slice(0, MAX_RETAIL_OFFERS),
    checked: results.filter(result => result.checked).length,
  }
}
