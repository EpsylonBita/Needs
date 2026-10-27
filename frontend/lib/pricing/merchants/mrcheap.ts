import { matchesProduct } from '../matching'
import { parseMerchantOffer, safeRetailUrl } from '../merchant-verifier'
import type { MerchantAdapter } from './types'

const ORIGIN = 'https://mrcheap.gr'
const MAX_BYTES = 1024 * 1024
type JsonObject = Record<string, unknown>

function decode(value: string): string {
  const entities: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (entity, key: string) => {
    if (!key.startsWith('#')) return entities[key.toLowerCase()] ?? entity
    const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1))
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
  })
}

function text(value: string): string {
  return decode(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function productUrl(value: string, base = ORIGIN): string | null {
  try {
    const safe = safeRetailUrl(new URL(decode(value), base).href)
    if (!safe) return null
    const url = new URL(safe)
    if (url.origin !== ORIGIN || !/^\/[a-z0-9][a-z0-9-]*$/i.test(url.pathname)) return null
    for (const key of [...url.searchParams.keys()]) {
      if (key !== 'search' && !key.startsWith('utm_')) return null
      url.searchParams.delete(key)
    }
    return url.href
  } catch { return null }
}

/** This observed Sony suffix denotes Black; other suffixes/revisions stay unmatched. */
function sonyBlackName(name: string): { name: string; sku: string } | null {
  const code = /\s*\((WH1000XM(\d+)B\.CE7)\)\s*$/i.exec(name)
  if (!code) return null
  const base = name.slice(0, code.index).trim()
  if (!new RegExp(`\\bSony\\s+WH-?1000XM${code[2]}\\b`, 'i').test(base)) return null
  return { name: `${base} Black`, sku: code[1] }
}

function productDescription(html: string): string | null {
  // The recorded product description tab precedes tags and related-product cards.
  // A changed template fails closed rather than borrowing text from another product.
  const tab = /<div\b[^>]*class=["'][^"']*\btab-content\b[^"']*["'][^>]*>([\s\S]*?)<div\b[^>]*class=["'][^"']*\bblock-content\b[^"']*["'][^>]*>([\s\S]*?)<\/div\s*>/i.exec(html)
  return tab?.[2] ?? null
}

function mainProduct(html: string): JsonObject | null {
  const products: JsonObject[] = []
  let count = 0
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (++count > 80) break
    if (!/\btype\s*=\s*["']application\/ld\+json["']/i.test(script[1])) continue
    try {
      const value: unknown = JSON.parse(script[2])
      if (value && typeof value === 'object' && !Array.isArray(value)
        && (value as JsonObject)['@type'] === 'Product') products.push(value as JsonObject)
    } catch { /* Malformed metadata is never executed. */ }
  }
  return products.length === 1 ? products[0] : null
}

function visiblePrice(html: string): number | null {
  const prices = [...html.matchAll(/<div\b[^>]*class=["']product-price["'][^>]*>([\s\S]*?)<\/div\s*>/gi)]
  if (prices.length !== 1) return null
  const value = text(prices[0][1])
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{2}\s*€$/.test(value)) return null
  return Number(value.replace(/\./g, '').replace(',', '.').replace(/\s*€$/, ''))
}

export const mrCheapAdapter: MerchantAdapter = {
  id: 'mrcheap',
  name: 'MrCheap.gr',
  origin: ORIGIN,

  searchUrl(identity) {
    if (!identity.model || identity.model.length > 100 || !/^[a-z0-9 /]+$/.test(identity.model)) return null
    // Search model terms first: the store's card title can encode color in its SKU.
    const params = new URLSearchParams({ route: 'product/search', search: identity.model })
    return `${ORIGIN}/index.php?${params}`
  },

  productLinks(html, searchUrl, identity) {
    if (Buffer.byteLength(html, 'utf8') > MAX_BYTES) return []
    try {
      const source = new URL(searchUrl)
      if (source.origin !== ORIGIN || source.pathname !== '/index.php' || source.searchParams.get('route') !== 'product/search') return []
    } catch { return [] }
    const links = new Set<string>()
    let count = 0
    for (const card of html.matchAll(/<div\b[^>]*class=["']name["'][^>]*>([\s\S]*?)<\/div\s*>/gi)) {
      if (++count > 200) break
      const anchor = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/i.exec(card[1])
      if (!anchor) continue
      const name = text(anchor[2])
      if (!matchesProduct(identity, sonyBlackName(name)?.name ?? name)) continue
      const url = productUrl(anchor[1], searchUrl)
      if (url) links.add(url)
      if (links.size === 3) break
    }
    return [...links]
  },

  parseOffer(html, url, identity) {
    const destination = productUrl(url)
    if (!destination || Buffer.byteLength(html, 'utf8') > MAX_BYTES) return null
    const product = mainProduct(html)
    const price = visiblePrice(html)
    if (!product || typeof product.name !== 'string' || price === null) return null
    const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(html)
    if (!heading || text(heading[1]) !== text(product.name)) return null
    const quote = product.offers
    if (!quote || typeof quote !== 'object' || Array.isArray(quote)) return null
    const offer = quote as JsonObject
    if (typeof offer.url !== 'string' || productUrl(offer.url, destination) !== destination
      || typeof offer.availability !== 'string' || !/^(?:https?:\/\/schema\.org\/)?InStock$/i.test(offer.availability)) return null

    const sony = sonyBlackName(product.name)
    if (sony) {
      if (product.sku !== sony.sku || product.model !== sony.sku) return null
      const description = productDescription(html)
      if (!description) return null
      const rows = [...description.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi)].map(row => text(row[1]))
      if (!rows.includes(`Κωδικός: ${sony.sku}`) || !rows.includes('Χρώμα: Black')) return null
      product.name = sony.name
    }
    // Reuse the strict condition/currency/identity/full-price checks, with the
    // retailer's independently evidenced Sony SKU alias as the only enrichment.
    const parsed = parseMerchantOffer(`<script type="application/ld+json">${JSON.stringify(product)}</script>`, {
      shop: 'MrCheap.gr', price, url: destination,
    }, identity)
    return parsed && parsed.price === price && productUrl(parsed.url) === destination ? { ...parsed, url: destination } : null
  },
}
