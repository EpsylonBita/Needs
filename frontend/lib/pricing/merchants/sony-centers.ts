import { matchesProduct, type ProductIdentity } from '../matching'
import { safeRetailUrl } from '../merchant-verifier'
import type { RetailOffer } from '../types'
import type { MerchantAdapter } from './types'

const ORIGIN = 'https://sonycenters.gr'
const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const excluded = (value: string) => /\b(?:used|refurbished|renewed|outlet|open[ -]?box|b[ -]?stock|bundle)\b|μεταχειρισ|ανακατασκευ|εκθεσιακ/.test(normalize(value))

type Element = { tag: string; attrs: Record<string, string>; start: number; content: number; end: number; parent: Element | null; closed: boolean }
type Document = { source: string; elements: Element[] }
function decode(value: string): string {
  const named: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (_, entity: string) => {
    if (!entity.startsWith('#')) return named[entity.toLowerCase()]
    const point = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1))
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ''
  })
}

/** Bounded structural scanner for this store's server-rendered catalogue; never executes HTML. */
function document(html: string): Document | null {
  if (Buffer.byteLength(html, 'utf8') > 1024 * 1024) return null
  const source = html.replace(/<!--[^]*?-->|<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi, '')
  const elements: Element[] = [], stack: Element[] = []
  for (const match of source.matchAll(/<\/?([a-z][\w:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)) {
    const tag = match[1].toLowerCase(), raw = match[0]
    if (raw.startsWith('</')) {
      const index = stack.findLastIndex(node => node.tag === tag)
      if (index >= 0) {
        for (const node of stack.splice(index)) { node.end = match.index; node.closed = true }
      }
      continue
    }
    if (elements.length >= 25000 || stack.length >= 150) return null
    const attrs: Record<string, string> = {}
    for (const attr of raw.slice(match[1].length + 1).matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      const key = attr[1].toLowerCase()
      if (!(key in attrs)) attrs[key] = decode(attr[2] ?? attr[3] ?? attr[4] ?? '')
    }
    const content = match.index + raw.length
    const closed = /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag) || /\/\s*>$/.test(raw)
    const node: Element = { tag, attrs, start: match.index, content, end: content, parent: stack.at(-1) ?? null, closed }
    elements.push(node)
    if (!closed) stack.push(node)
  }
  return { source, elements }
}
function inside(node: Element, parent: Element): boolean {
  for (let current = node.parent; current; current = current.parent) if (current === parent) return true
  return false
}
function type(node: Element, name: string): boolean { return node.attrs.itemtype?.replace(/^https?:\/\/schema.org\//, '') === name }
function className(node: Element, name: string): boolean { return node.attrs.class?.split(/\s+/).includes(name) ?? false }
function text(doc: Document, node: Element): string { return decode(doc.source.slice(node.content, node.end).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim() }
function scope(node: Element): Element | null {
  for (let parent = node.parent; parent; parent = parent.parent) if ('itemscope' in parent.attrs) return parent
  return null
}
function conditionalPrice(doc: Document, offer: Element): boolean {
  const conditions = new Set(['billingDuration', 'billingIncrement', 'unitCode', 'unitText', 'referenceQuantity', 'eligibleQuantity', 'eligibleTransactionVolume', 'validForMemberTier', 'priceType'])
  return doc.elements.some(node => {
    if (!node.attrs.itemprop?.split(/\s+/).some(prop => conditions.has(prop)) || !inside(node, offer)) return false
    if (scope(node) === offer) return true
    for (let parent = node.parent; parent && parent !== offer; parent = parent.parent) {
      if (parent.attrs.itemprop?.split(/\s+/).includes('priceSpecification') && scope(parent) === offer) return true
    }
    // Shipping transit/handling units belong to delivery metadata, not the item quote.
    return false
  })
}
function visibleAmount(value: string): number | null {
  const amount = value.replace(/\s+/g, '')
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{2})?$/.test(amount)) return Number(amount.replace(/\./g, '').replace(',', '.'))
  if (/^\d+(?:,\d{2})?$/.test(amount)) return Number(amount.replace(',', '.'))
  return /^\d+\.\d{2}$/.test(amount) ? Number(amount) : null
}
function ownUrl(value: string, base = ORIGIN): string | null {
  try {
    const safe = safeRetailUrl(new URL(value, base).href)
    return safe && new URL(safe).origin === ORIGIN ? safe : null
  } catch { return null }
}

/** Sony's documented WH1000XM5B/S/L/P colour SKUs; the XM4C revision is deliberately retained. */
function sourceTitle(value: string): string {
  const colors: Record<string, RegExp> = { b: /\bblack\b|μαυρ/, s: /\bsilver\b|ασημι/, l: /\bblue\b|μπλε/, p: /\bpink\b|ροζ/ }
  return value.replace(/\bWH-?1000XM5([BSLP])\b/gi, (model: string, color: string) => colors[color.toLowerCase()].test(normalize(value)) ? 'WH-1000XM5' : model)
}
function matches(identity: ProductIdentity, title: string): boolean {
  return !excluded(title) && (matchesProduct(identity, title) || matchesProduct(identity, sourceTitle(title)))
}

export const sonyCentersAdapter: MerchantAdapter = {
  id: 'sony-centers', name: 'Sony Center', origin: ORIGIN,
  searchUrl(identity) {
    const model = identity.model.match(/^sony (wh1000xm[456](?:c|[bslp])?)$/i)?.[1]
    if (!model) return null
    const url = new URL('/', ORIGIN)
    url.searchParams.set('dispatch', 'products.search')
    url.searchParams.set('search_performed', 'Y')
    url.searchParams.set('q', model.replace(/^wh/i, 'WH-'))
    url.searchParams.set('pname', 'Y')
    url.searchParams.set('pcode_from_q', 'Y')
    return url.href
  },
  productLinks(html, searchUrl, identity) {
    if (!ownUrl(searchUrl) || !this.searchUrl(identity)) return []
    const doc = document(html)
    if (!doc) return []
    const urls = new Set<string>()
    for (const node of doc.elements) {
      if (node.tag !== 'a' || !node.closed || !className(node, 'product-title') || !matches(identity, text(doc, node))) continue
      const url = ownUrl(node.attrs.href ?? '', searchUrl)
      if (!url || !new URL(url).pathname.startsWith('/ixos/akoystika/akoystika-kefalis/') || excluded(url)) continue
      urls.add(url)
      if (urls.size === 3) break
    }
    return [...urls]
  },
  parseOffer(html, url, identity): RetailOffer | null {
    const requested = ownUrl(url)
    if (!requested || !this.searchUrl(identity) || excluded(url)) return null
    const doc = document(html)
    if (!doc) return null
    const detail = doc.elements.find(node => node.attrs.id === 'product_detail_page' && node.closed)
    if (!detail) return null
    const products = doc.elements.filter(node => type(node, 'Product') && node.closed && inside(node, detail))
    if (products.length !== 1) return null
    const product = products[0]
    const titles = doc.elements.filter(node => node.tag === 'h1' && node.closed && inside(node, product))
    if (titles.length !== 1 || !matches(identity, text(doc, titles[0]))) return null
    const canonical = doc.elements.find(node => node.tag === 'link' && node.attrs.rel === 'canonical')
    const destination = canonical ? ownUrl(canonical.attrs.href ?? '') : null
    if (!destination || new URL(destination).pathname !== new URL(requested).pathname) return null
    // Domain-specific new-stock inference, NOT fabricated schema: Sony lists this retailer
    // on its product buy pages; its standard catalogue states factory Sony warranty, and
    // /oroi-khrisis describes manufacturer warranty from purchase and new DOA replacement.
    // This inference is confined to this adapter; the generic verifier requires NewCondition.
    if (!/εργοστασιακη\s+εγγυηση\s+sony/.test(normalize(decode(doc.source)))
      || !doc.elements.some(node => inside(node, product) && className(node, 'ty-product-detail'))
      || excluded(text(doc, product))) return null
    const condition = doc.elements.filter(node => node.attrs.itemprop === 'itemCondition' && inside(node, product))
    if (condition.some(node => !/^(?:https?:\/\/schema.org\/)?NewCondition$/i.test(node.attrs.content ?? node.attrs.href ?? text(doc, node)))) return null
    const offers = doc.elements.filter(node => node.attrs.itemprop === 'offers' && type(node, 'Offer') && node.closed && scope(node) === product)
    if (offers.length !== 1) return null
    const offer = offers[0]
    if (conditionalPrice(doc, offer)) return null
    const props = (prop: string) => doc.elements.filter(node => node.attrs.itemprop === prop && scope(node) === offer)
    const prices = props('price'), currencies = props('priceCurrency'), stock = props('availability')
    if (prices.length !== 1 || currencies.length !== 1 || stock.length !== 1
      || !/^sec_discounted_price_bigpicture_\d+$/.test(prices[0].attrs.id ?? '')
      || currencies[0].attrs.content !== 'EUR' || !/^https?:\/\/schema.org\/InStock$/.test(stock[0].attrs.href ?? '')
      || !/^\d+(?:\.\d{1,2})?$/.test(prices[0].attrs.content ?? '')) return null
    const price = Number(prices[0].attrs.content)
    return Number.isFinite(price) && price > 0 && price <= 1000000 && visibleAmount(text(doc, prices[0])) === price
      ? { shop: this.name, price, url: destination } : null
  },
}
