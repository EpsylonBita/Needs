import { matchesProduct } from '../matching'
import { parseMerchantOffer, safeRetailUrl } from '../merchant-verifier'
import type { MerchantAdapter } from './types'

type JsonObject = Record<string, unknown>
type PrestaShopSource = {
  id: string
  name: string
  origin: string
  searchPath: string
  searchParameters?: Record<string, string>
  productPath: RegExp
  priceClass: string
  productIdInPath?: boolean
}
const MAX_BYTES = 1024 * 1024
const conditionalPriceKeys = [
  'billingDuration', 'billingIncrement', 'unitCode', 'unitText', 'referenceQuantity',
  'eligibleQuantity', 'eligibleTransactionVolume', 'validForMemberTier', 'priceType',
]

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null
}

function decode(value: string): string {
  const entities: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', euro: '€' }
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp|euro);/gi, (entity, key: string) => {
    if (!key.startsWith('#')) return entities[key.toLowerCase()] ?? entity
    const code = /^#x/i.test(key) ? Number.parseInt(key.slice(2), 16) : Number(key.slice(1))
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
  })
}

function text(value: string): string {
  return decode(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function attributes(value: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const attr of value.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    result[attr[1].toLowerCase()] = decode(attr[2] ?? attr[3])
  }
  return result
}

function explicitlyHidden(value: string): boolean {
  let style = ''
  // Boolean and unquoted attributes are valid HTML, including hidden="false".
  for (const attr of value.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = attr[1].toLowerCase()
    const content = decode(attr[2] ?? attr[3] ?? attr[4] ?? '').trim().toLowerCase()
    if (name === 'hidden' || (name === 'aria-hidden' && content === 'true')) return true
    if (name === 'style') style = content.replace(/\/\*[\s\S]*?\*\//g, '')
  }
  return /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|content-visibility\s*:\s*hidden|opacity\s*:\s*(?:0(?:\.0*)?|\.0+)%?)\s*(?:!\s*important\s*)?(?:;|$)/i.test(style)
}

/** Checks explicit visibility along the actual price's ancestor chain, without executing page code. */
function visiblePriceElement(html: string, position: number): boolean {
  const voidElements = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
  const stack: { name: string; hidden: boolean }[] = []
  let count = 0
  for (const tag of html.matchAll(/<(\/?)([a-z][\w:-]*)\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>/gi)) {
    if (++count > 15000 || tag.index! > position) return false
    const name = tag[2].toLowerCase()
    if (tag[1]) {
      for (let index = stack.length - 1; index >= 0; index--) {
        if (stack[index].name === name) { stack.splice(index); break }
      }
      continue
    }
    const hidden = (stack[stack.length - 1]?.hidden ?? false) || explicitlyHidden(tag[3]) || name === 'template' || name === 'noscript'
    if (tag.index === position) return !hidden
    if (!voidElements.has(name) && !/\/\s*$/.test(tag[3])) {
      if (stack.length >= 128) return false
      stack.push({ name, hidden })
    }
  }
  return false
}

function amount(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value))) return null
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function visibleAmount(value: string): number | null {
  const normalized = text(value)
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{2}\s*€$/.test(normalized)) return null
  return amount(normalized.replace(/\./g, '').replace(',', '.').replace(/\s*€$/, ''))
}

function primaryProduct(html: string): JsonObject | null {
  const products: JsonObject[] = []
  let count = 0
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (++count > 100) break
    if (attributes(script[1]).type !== 'application/ld+json') continue
    try {
      const product = object(JSON.parse(script[2]))
      if (product?.['@type'] === 'Product') products.push(product)
    } catch { /* Public metadata is parsed as data, never executed. */ }
  }
  return products.length === 1 ? products[0] : null
}

function isNew(value: unknown): boolean {
  return typeof value === 'string' && /^(?:https?:\/\/schema\.org\/)?(?:NewCondition|new)$/i.test(value)
}

function validPriceDate(value: unknown): boolean {
  if (value === undefined) return true
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))) return false
  return new Date(value).toISOString().slice(0, 10) === value && Date.parse(value + 'T23:59:59.999Z') >= Date.now()
}

/** Pure parser shared only by the two audited PrestaShop catalogues. No requests or inferred condition. */
export function createPrestaShopAdapter(source: PrestaShopSource): MerchantAdapter {
  function productUrl(value: string, base = source.origin): string | null {
    try {
      const safe = safeRetailUrl(new URL(decode(value), base).href)
      if (!safe) return null
      const url = new URL(safe)
      if (url.origin !== source.origin || !source.productPath.test(url.pathname)) return null
      for (const key of [...url.searchParams.keys()]) {
        if (!key.startsWith('utm_')) return null
        url.searchParams.delete(key)
      }
      return url.href
    } catch { return null }
  }

  return {
    id: source.id, name: source.name, origin: source.origin,
    searchUrl(identity) {
      if (!identity.model || identity.model.length > 100 || !/^[a-z\d /-]+$/i.test(identity.model)) return null
      const url = new URL(source.searchPath, source.origin)
      for (const [key, value] of Object.entries({ controller: 'search', ...source.searchParameters, s: identity.model })) url.searchParams.set(key, value)
      return url.href
    },
    productLinks(html, searchUrl, identity) {
      if (Buffer.byteLength(html, 'utf8') > MAX_BYTES) return []
      try {
        const url = new URL(searchUrl)
        if (url.origin !== source.origin || url.pathname !== new URL(source.searchPath, source.origin).pathname
          || url.searchParams.get('controller') !== 'search') return []
      } catch { return [] }
      const clean = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      const links = new Set<string>()
      for (const anchor of clean.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
        const attrs = attributes(anchor[1])
        const name = text(attrs.title ?? anchor[2])
        if (!attrs.href || !matchesProduct(identity, name)) continue
        const url = productUrl(attrs.href, searchUrl)
        if (url) links.add(url)
        if (links.size === 3) break
      }
      return [...links]
    },
    parseOffer(html, url, identity) {
      const destination = productUrl(url)
      if (!destination || Buffer.byteLength(html, 'utf8') > MAX_BYTES) return null
      const product = primaryProduct(html)
      const clean = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      const headings = [...clean.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi)]
      const details = [...clean.matchAll(/<div\b([^>]*)>/gi)].filter(tag => attributes(tag[1]).id === 'product-details')
      if (!product || headings.length !== 1 || details.length !== 1 || typeof product.name !== 'string') return null
      let data: JsonObject | null
      try { data = object(JSON.parse(attributes(details[0][1])['data-product'])) } catch { return null }
      if (!data || data.condition !== 'new' || String(data.available_for_order) !== '1' || String(data.show_price) !== '1'
        || data.availability !== 'available' || Number(data.id_product_attribute) !== 0
        || (data.minimal_quantity !== undefined && Number(data.minimal_quantity) !== 1)) return null
      const name = text(headings[0][1])
      if (typeof data.name !== 'string' || text(data.name) !== name || text(product.name) !== name || !matchesProduct(identity, name)) return null
      const headingEnd = headings[0].index! + headings[0][0].length
      if (details[0].index! <= headingEnd) return null
      const main = clean.slice(headingEnd, details[0].index)
      const ids = [...main.matchAll(/<input\b([^>]*)>/gi)].map(tag => attributes(tag[1])).filter(attrs => attrs.id === 'product_page_product_id')
      if (ids.length !== 1 || !/^\d+$/.test(ids[0].value ?? '') || String(data.id_product) !== ids[0].value || String(data.id) !== ids[0].value) return null
      if (source.productIdInPath && new URL(destination).pathname.match(/\/(\d+)-[^/]+\.html$/)?.[1] !== ids[0].value) return null
      const canonical = [...clean.matchAll(/<link\b([^>]*)>/gi)].map(tag => attributes(tag[1])).filter(attrs => attrs.rel === 'canonical')
      if (!canonical.length || canonical.some(attrs => !attrs.href || productUrl(attrs.href, destination) !== destination)) return null
      const spans = [...main.matchAll(/<span\b([^>]*)>/gi)]
        .filter(tag => (attributes(tag[1]).class ?? '').split(/\s+/).includes(source.priceClass))
        .map(tag => {
          const remainder = main.slice(tag.index! + tag[0].length)
          const end = remainder.search(/<\/span\s*>/i)
          return { attrs: attributes(tag[1]), body: end < 0 ? '' : remainder.slice(0, end), position: headingEnd + tag.index! }
        })
      // A changed template or multiple current prices is ambiguous, never a cheapest-price fallback.
      if (spans.length !== 1 || !visiblePriceElement(clean, spans[0].position)) return null
      const price = visibleAmount(spans[0].body)
      if (price === null || amount(spans[0].attrs.content) !== price || amount(data.price_amount) !== price
        || visibleAmount(typeof data.price === 'string' ? data.price : '') !== price) return null
      const offer = object(product.offers)
      if (!offer || offer['@type'] !== 'Offer' || offer.priceCurrency !== 'EUR' || amount(offer.price) !== price
        || typeof offer.url !== 'string' || productUrl(offer.url, destination) !== destination
        || (offer.name !== undefined && text(String(offer.name)) !== name)
        || typeof data.reference !== 'string' || product.sku !== data.reference || offer.sku !== data.reference) return null
      if ((product.itemCondition !== undefined && !isNew(product.itemCondition)) || (offer.itemCondition !== undefined && !isNew(offer.itemCondition))) return null
      if (typeof offer.availability !== 'string' || !/^(?:https?:\/\/schema\.org\/)?(?:InStock|LimitedAvailability|OnlineOnly|PreOrder|PreSale|BackOrder)$/i.test(offer.availability)
        || !validPriceDate(offer.priceValidUntil)) return null
      const specification = object(offer.priceSpecification)
      if (offer.priceSpecification !== undefined && !specification) return null
      if (conditionalPriceKeys.some(key => offer[key] !== undefined || specification?.[key] !== undefined)) return null
      // Condition comes from this exact server-rendered product record; absence is never treated as new.
      const enriched = { ...product, itemCondition: product.itemCondition ?? 'https://schema.org/NewCondition' }
      const verified = parseMerchantOffer(`<script type="application/ld+json">${JSON.stringify(enriched)}</script>`, { shop: source.name, price, url: destination }, identity)
      return verified && verified.price === price && productUrl(verified.url) === destination ? verified : null
    },
  }
}

export const mpakasDiyAdapter = createPrestaShopAdapter({
  id: 'mpakas-diy', name: 'MPAKAS DIY', origin: 'https://eshop.mpakasdiy.com',
  searchPath: '/el/αναζήτηση', productPath: /^\/el\/[^/]+\/\d+-[^/]+\.html$/, priceClass: 'price', productIdInPath: true,
})
