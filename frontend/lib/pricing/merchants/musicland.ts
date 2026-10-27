import { matchesProduct } from '../matching'
import { parseMerchantOffer } from '../merchant-verifier'
import { canonicalUrl, CONDITIONAL_PRICE_KEYS, excluded, hasClass, inside, normalize, ownUrl, parseHtml, priceAmount, text, visible } from './music-photo-html'
import type { MerchantAdapter } from './types'

const ORIGIN = 'https://www.musicland.gr'

export const musiclandAdapter: MerchantAdapter = {
  id: 'musicland', name: 'Musicland', origin: ORIGIN,
  searchUrl(identity) {
    const url = new URL('/search', ORIGIN)
    url.searchParams.set('q', identity.model)
    return url.href
  },
  productLinks(html, searchUrl, identity) {
    if (!ownUrl(searchUrl, ORIGIN)) return []
    const doc = parseHtml(html)
    if (!doc) return []
    const urls = new Set<string>()
    for (const node of doc.nodes) {
      if (node.tag !== 'a' || !node.closed || !hasClass(node, 'ml-card-link')) continue
      const titles = doc.nodes.filter(title => title.tag === 'h2' && title.closed && inside(title, node))
      if (titles.length !== 1 || excluded(text(doc, titles[0])) || !matchesProduct(identity, text(doc, titles[0]))) continue
      const url = ownUrl(node.attrs.href ?? '', ORIGIN, searchUrl)
      if (url && !new URL(url).search && new URL(url).pathname.split('/').filter(Boolean).length === 2) urls.add(url)
      if (urls.size === 3) break
    }
    return [...urls]
  },
  parseOffer(html, url, identity) {
    const requested = ownUrl(url, ORIGIN), doc = parseHtml(html)
    if (!requested || !doc) return null
    const canonical = canonicalUrl(doc, requested, ORIGIN)
    const products = doc.nodes.filter(node => node.attrs.id === 'pd' && node.closed)
    if (!canonical || products.length !== 1) return null
    const primary = products[0]
    const titles = doc.nodes.filter(node => node.tag === 'h1' && node.closed && inside(node, primary))
    const info = doc.nodes.filter(node => node.attrs.id === 'pinfo' && node.closed && inside(node, primary))
    if (titles.length !== 1 || info.length !== 1 || excluded(text(doc, titles[0])) || !matchesProduct(identity, text(doc, titles[0]))) return null
    const prices = doc.nodes.filter(node => hasClass(node, 'prices') && node.parent === info[0] && node.closed && visible(node))
    const stock = doc.nodes.filter(node => node.attrs.id === 'avlbt' && inside(node, info[0]) && node.closed)
    if (prices.length !== 1 || stock.length !== 1 || !/^διαθεσιμο(?:[.\s]|$)/u.test(normalize(text(doc, stock[0])))) return null
    const shown = text(doc, prices[0])
    if (!/^(?:€\s*[\d.,\s]+|[\d.,\s]+\s*€)$/.test(shown)) return null
    const price = priceAmount(shown.replace('€', ''), 'el')
    if (price === null) return null
    // This store publishes an explicit Product/NewCondition/Offer, not an inferred condition.
    const schema: Record<string, unknown>[] = []
    for (const script of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([^]*?)<\/script\s*>/gi)) {
      try {
        const value = JSON.parse(script[1])
        if (value && value['@type'] === 'Product') schema.push(value)
      } catch { /* Malformed evidence is never evaluated. */ }
    }
    if (schema.length !== 1) return null
    const offer = schema[0].offers as Record<string, unknown> | undefined
    if (!offer || Array.isArray(offer) || typeof offer !== 'object' || offer.availability !== 'https://schema.org/InStock') return null
    const specification = offer.priceSpecification as Record<string, unknown> | undefined
    if (CONDITIONAL_PRICE_KEYS.some(key => key in offer || (specification && typeof specification === 'object' && key in specification))) return null
    const verified = parseMerchantOffer(html, { shop: this.name, price, url: canonical }, identity)
    return verified && verified.url === canonical && verified.price === price ? verified : null
  },
}
