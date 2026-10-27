import { matchesProduct } from '../matching'
import { parseMerchantOffer, safeRetailUrl } from '../merchant-verifier'
import type { MerchantAdapter } from './types'

const ORIGIN = 'https://www.msystems.gr'
const MAX_BYTES = 1024 * 1024
type JsonObject = Record<string, unknown>

function decode(value: string): string {
  const named: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', euro: '€' }
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp|euro);/gi, (entity, key: string) => {
    if (!key.startsWith('#')) return named[key.toLowerCase()] ?? entity
    const point = /^#x/i.test(key) ? Number.parseInt(key.slice(2), 16) : Number(key.slice(1))
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity
  })
}
function text(value: string): string { return decode(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim() }
function attrs(value: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const attribute of value.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) result[attribute[1].toLowerCase()] = decode(attribute[2] ?? attribute[3])
  return result
}
function productUrl(value: string, base = ORIGIN): string | null {
  try {
    const safe = safeRetailUrl(new URL(decode(value), base).href)
    if (!safe) return null
    const url = new URL(safe)
    if (url.origin !== ORIGIN || url.search || !/^\/[a-z0-9-]+\/[a-z0-9][a-z0-9-]+$/i.test(url.pathname)
      || /^\/(?:page|search|account|cart)\//i.test(url.pathname)) return null
    return url.href
  } catch { return null }
}

export const mSystemsAdapter: MerchantAdapter = {
  id: 'msystems', name: 'Msystems', origin: ORIGIN,
  searchUrl(identity) {
    if (!identity.model || identity.model.length > 100 || !/^[a-z0-9 /-]+$/.test(identity.model)) return null
    return `${ORIGIN}/search/?${new URLSearchParams({ keywords: identity.model })}`
  },
  productLinks(html, sourceUrl, identity) {
    if (Buffer.byteLength(html, 'utf8') > MAX_BYTES) return []
    try { if (new URL(sourceUrl).origin !== ORIGIN || new URL(sourceUrl).pathname !== '/search/') return [] } catch { return [] }
    const clean = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    const links = new Set<string>()
    let count = 0
    for (const heading of clean.matchAll(/<h3\b([^>]*)>([\s\S]*?)<\/h3\s*>/gi)) {
      if (++count > 200) break
      if (!attrs(heading[1]).class?.split(/\s+/).includes('product-title')) continue
      const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/i.exec(heading[2])
      if (!anchor || !matchesProduct(identity, text(anchor[2]))) continue
      const href = attrs(anchor[1]).href
      const url = href && productUrl(href, sourceUrl)
      if (url) links.add(url)
      if (links.size === 3) break
    }
    return [...links]
  },
  parseOffer(html, sourceUrl, identity) {
    const destination = productUrl(sourceUrl)
    if (!destination || Buffer.byteLength(html, 'utf8') > MAX_BYTES) return null
    const products: JsonObject[] = []
    let count = 0
    for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (++count > 80) break
      if (attrs(script[1]).type !== 'application/ld+json') continue
      try {
        const value: unknown = JSON.parse(script[2])
        if (value && typeof value === 'object' && !Array.isArray(value) && (value as JsonObject)['@type'] === 'Product') products.push(value as JsonObject)
      } catch { /* Never evaluate retailer scripts. */ }
    }
    if (products.length !== 1 || typeof products[0].name !== 'string') return null
    const product = products[0]
    const clean = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    const headings = [...clean.matchAll(/<h1\b([^>]*)>([\s\S]*?)<\/h1\s*>/gi)]
    if (headings.length !== 1 || !attrs(headings[0][1]).class?.split(/\s+/).includes('product-title-copy')
      || text(headings[0][2]) !== text(product.name as string)) return null
    const canonicals = [...clean.matchAll(/<link\b([^>]*)>/gi)].map(link => attrs(link[1])).filter(link => link.rel === 'canonical')
    if (canonicals.length !== 1 || productUrl(canonicals[0].href ?? '') !== destination) return null
    const prices = [...clean.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span\s*>/gi)].filter(span => {
      const classes = attrs(span[1]).class?.split(/\s+/) ?? []
      return classes.includes('h3') && classes.includes('fw-normal') && classes.includes('me-1')
    })
    if (prices.length !== 1) return null
    const priceAttributes = attrs(prices[0][1])
    if (/(?:^|\s)hidden(?:\s|=|$)/i.test(prices[0][1]) || priceAttributes['aria-hidden'] === 'true'
      || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(priceAttributes.style ?? '')
      || priceAttributes.class?.split(/\s+/).some(name => name === 'hidden' || name === 'd-none')) return null
    const visible = text(prices[0][2])
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{2}\s*€$/.test(visible)) return null
    const price = Number(visible.replace(/\./g, '').replace(',', '.').replace(/\s*€$/, ''))
    const offer = product.offers
    if (!offer || typeof offer !== 'object' || Array.isArray(offer)) return null
    const quote = offer as JsonObject
    if (typeof quote.url !== 'string' || productUrl(quote.url) !== destination
      || typeof quote.availability !== 'string' || !/^https?:\/\/schema\.org\/(?:InStock|BackOrder|PreOrder|LimitedAvailability|OnlineOnly)$/.test(quote.availability)) return null
    const cart = [...clean.matchAll(/<button\b([^>]*)>/gi)].map(button => attrs(button[1])).find(button => button.id === 'prd_addtocart')
    if (!cart || /<button\b[^>]*\bdisabled(?:\s|=|>)[^>]*\bid=["']prd_addtocart["']|<button\b[^>]*\bid=["']prd_addtocart["'][^>]*\bdisabled(?:\s|=|>)/i.test(clean)) return null
    const parsed = parseMerchantOffer(`<script type="application/ld+json">${JSON.stringify(product)}</script>`, { shop: this.name, price, url: destination }, identity)
    return parsed && parsed.price === price && productUrl(parsed.url) === destination ? parsed : null
  },
}
