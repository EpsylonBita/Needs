import { matchesProduct, type ProductIdentity } from '../matching'
import { canonicalUrl, CONDITIONAL_PRICE_KEYS, excluded, hasClass, inside, normalize, ownUrl, parseHtml, priceAmount, text, visible, type HtmlDocument, type HtmlNode } from './music-photo-html'
import type { MerchantAdapter } from './types'

const ORIGIN = 'https://www.photoagora.gr'
const COLORS = new Set(['black', 'white', 'blue', 'green', 'red', 'purple', 'pink', 'silver', 'gold', 'gray', 'yellow', 'orange', 'titanium', 'space', 'midnight', 'starlight', 'natural', 'desert', 'mint', 'navy', 'graphite'])
// A separate trailing letter can denote another camera model (e.g. R5 C), never discard it.
const unsupportedSuffix = (title: string) => /\b[a-z]+\d+[a-z]*\s+[a-z]\b/i.test(title)
function searchMatches(identity: ProductIdentity, title: string): boolean {
  return !excluded(title) && !unsupportedSuffix(title) && (matchesProduct(identity, title)
    || matchesProduct({ ...identity, variantTokens: identity.variantTokens.filter(token => !COLORS.has(token)) }, title))
}
function feature(doc: HtmlDocument, primary: HtmlNode, label: string): string | null {
  const entries = doc.nodes.filter(node => hasClass(node, 'ty-product-feature') && node.closed && inside(node, primary))
  const values: string[] = []
  for (const entry of entries) {
    const labels = doc.nodes.filter(node => hasClass(node, 'ty-product-feature__label') && inside(node, entry))
    if (labels.length !== 1 || normalize(text(doc, labels[0])).replace(/:$/, '') !== label) continue
    const matches = doc.nodes.filter(node => hasClass(node, 'ty-product-feature__value') && node.closed && inside(node, entry))
    if (matches.length !== 1) return null
    values.push(text(doc, matches[0]))
  }
  return values.length === 1 ? values[0] : null
}

type JsonObject = Record<string, unknown>
const object = (value: unknown): JsonObject | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [value]
function schemaName(value: unknown): string {
  const name = typeof value === 'string' ? value : object(value)?.['@id']
  return typeof name === 'string' ? name.replace(/^https?:\/\/schema\.org\//i, '').toLowerCase() : ''
}
function structuredContradiction(html: string, url: string, identity: ProductIdentity, title: string, color: string | null, price: number): boolean {
  const nodes: JsonObject[] = []
  let overflow = false
  const collect = (value: unknown, depth = 0) => {
    if (depth > 12 || nodes.length >= 500) { overflow = true; return }
    if (Array.isArray(value)) { value.slice(0, 501).forEach(item => collect(item, depth + 1)); return }
    const node = object(value)
    if (!node) return
    nodes.push(node)
    for (const key of ['@graph', 'mainEntity', 'hasVariant']) if (node[key]) collect(node[key], depth + 1)
  }
  for (const script of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([^]*?)<\/script\s*>/gi)) {
    try { collect(JSON.parse(script[1])) } catch { /* Never evaluate malformed catalogue data. */ }
  }
  if (overflow) return true
  const byId = new Map(nodes.filter(node => typeof node['@id'] === 'string').map(node => [node['@id'], node]))
  for (const product of nodes.filter(node => list(node['@type']).some(type => schemaName(type) === 'product'))) {
    if (product.url !== undefined) {
      const destination = typeof product.url === 'string' ? ownUrl(product.url, ORIGIN, url) : null
      if (!destination) return true
      if (new URL(destination).pathname !== new URL(url).pathname) continue // Explicitly unrelated recommendation.
    }
    const brand = typeof product.brand === 'string' ? product.brand : object(product.brand)?.name
    if ((product.name !== undefined && typeof product.name !== 'string') || (product.brand !== undefined && typeof brand !== 'string')
      || (product.color !== undefined && typeof product.color !== 'string')) return true
    const name = [brand, product.name ?? title, product.color ?? color].filter(value => typeof value === 'string').join(' ')
    if (excluded(name) || !matchesProduct(identity, name)) return true
    const newCondition = (value: unknown) => value == null || ['new', 'newcondition'].includes(schemaName(value))
    if (!newCondition(product.itemCondition)) return true
    if (product.availability !== undefined && schemaName(product.availability) !== 'instock') return true
    if (product.offers === undefined) continue
    for (const value of list(product.offers)) {
      let offer = object(value)
      if (!offer) return true
      if (typeof offer['@id'] === 'string') {
        if (!byId.has(offer['@id'])) return true
        offer = byId.get(offer['@id'])!
      }
      if ((offer['@type'] !== undefined && !list(offer['@type']).some(type => schemaName(type) === 'offer')) || !newCondition(offer.itemCondition)) return true
      if (typeof offer.name === 'string' && excluded(offer.name)) return true
      if (offer.availability !== undefined && schemaName(offer.availability) !== 'instock') return true
      if (offer.url !== undefined && (typeof offer.url !== 'string' || ownUrl(offer.url, ORIGIN, url) !== url)) return true
      const specification = object(offer.priceSpecification)
      if (offer.priceSpecification !== undefined && !specification) return true
      if (CONDITIONAL_PRICE_KEYS.some(key => offer[key] !== undefined || specification?.[key] !== undefined)) return true
      for (const quote of [offer, specification].filter((value): value is JsonObject => value !== null)) {
        if (quote.priceCurrency !== undefined && quote.priceCurrency !== 'EUR') return true
        if (quote.price !== undefined && !((typeof quote.price === 'number' || (typeof quote.price === 'string' && /^\d+(?:\.\d{1,4})?$/.test(quote.price))) && Number(quote.price) === price)) return true
      }
      if (typeof offer.priceValidUntil === 'string') {
        const expiry = Date.parse(offer.priceValidUntil.length === 10 ? `${offer.priceValidUntil}T23:59:59.999Z` : offer.priceValidUntil)
        if (!Number.isFinite(expiry) || expiry < Date.now()) return true
      }
    }
  }
  return false
}

export const photoagoraAdapter: MerchantAdapter = {
  id: 'photoagora', name: 'Photoagora', origin: ORIGIN,
  searchUrl(identity) {
    const url = new URL('/', ORIGIN)
    for (const [key, value] of Object.entries({ dispatch: 'products.search', search_performed: 'Y', q: identity.model, match: 'all', pname: 'Y', items_per_page: '96' })) url.searchParams.set(key, value)
    return url.href
  },
  productLinks(html, searchUrl, identity) {
    if (!ownUrl(searchUrl, ORIGIN)) return []
    const doc = parseHtml(html)
    if (!doc) return []
    const urls = new Set<string>()
    for (const node of doc.nodes) {
      if (node.tag !== 'a' || !node.closed || !hasClass(node, 'product-title') || !searchMatches(identity, text(doc, node))) continue
      const url = ownUrl(node.attrs.href ?? '', ORIGIN, searchUrl)
      if (url && !new URL(url).search && new URL(url).pathname.startsWith('/fwtografia/') && url.endsWith('.html')) urls.add(url)
      if (urls.size === 3) break
    }
    return [...urls]
  },
  parseOffer(html, url, identity) {
    const requested = ownUrl(url, ORIGIN), doc = parseHtml(html)
    if (!requested || !doc || !new URL(requested).pathname.startsWith('/fwtografia/')) return null
    const canonical = canonicalUrl(doc, requested, ORIGIN)
    const products = doc.nodes.filter(node => hasClass(node, 'ty-product-detail') && node.closed)
    if (!canonical || products.length !== 1) return null
    const primary = products[0]
    const titles = doc.nodes.filter(node => node.tag === 'h1' && node.closed && inside(node, primary))
    if (titles.length !== 1) return null
    const title = text(doc, titles[0]), color = feature(doc, primary, 'χρωμα')
    if (excluded(title) || unsupportedSuffix(title) || !matchesProduct(identity, [title, color].filter(Boolean).join(' '))) return null
    // Isolated catalogue inference: body-only retail inventory with the product's own
    // Greek distributor warranty. Open-box/bulk are a separate shop category and excluded.
    // No NewCondition schema is fabricated; the generic merchant verifier stays strict.
    if (normalize(feature(doc, primary, 'body or kit') ?? '') !== 'body only'
      || normalize(feature(doc, primary, 'παροχος εγγυησης') ?? '') !== 'ελληνικη αντιπροσωπεια'
      || !/^(?:2[4-9]|[3-9]\d)\s+μηνες$/.test(normalize(feature(doc, primary, 'εγγυηση') ?? ''))) return null
    const data = titles[0].parent
    if (!data || !hasClass(data, 'ty-product-block__data') || excluded(text(doc, data))) return null
    const prices = doc.nodes.filter(node => hasClass(node, 'ty-product-block__price-actual') && node.closed && inside(node, data) && visible(node))
    if (prices.length !== 1) return null
    const pricesNodes = doc.nodes.filter(node => /^sec_discounted_price_\d+$/.test(node.attrs.id ?? '') && node.closed && inside(node, prices[0]) && visible(node))
    if (pricesNodes.length !== 1 || !/^€\s*[\d.,\s]+$/.test(text(doc, prices[0]))) return null
    if (doc.nodes.some(node => inside(node, prices[0]) && node.attrs.itemprop?.split(/\s+/).some(prop => CONDITIONAL_PRICE_KEYS.includes(prop)))) return null
    const price = priceAmount(text(doc, pricesNodes[0]), 'en')
    if (price === null || priceAmount(text(doc, prices[0]).replace('€', ''), 'en') !== price) return null
    const id = pricesNodes[0].attrs.id.replace('sec_discounted_price_', '')
    const stock = doc.nodes.filter(node => node.attrs.id === `product_amount_update_${id}` && node.closed && inside(node, primary))
    if (stock.length !== 1 || normalize(text(doc, stock[0])) !== 'αμεσα διαθεσιμο') return null
    const conditions = doc.nodes.filter(node => node.attrs.itemprop === 'itemCondition' && inside(node, primary))
    if (conditions.some(node => !/^(?:https?:\/\/schema.org\/)?NewCondition$/i.test(node.attrs.content ?? node.attrs.href ?? text(doc, node)))) return null
    if (structuredContradiction(html, canonical, identity, title, color, price)) return null
    return { shop: this.name, price, url: canonical }
  },
}
