import { matchesProduct } from '../matching'
import { parseMerchantOffer, safeRetailUrl } from '../merchant-verifier'
import type { MerchantAdapter } from './types'

const ORIGIN = 'https://www.cosmodata.gr'
const MAX_BYTES = 1024 * 1024
const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const excluded = (value: string) => /\b(?:used|refurbish(?:ed)?|renewed|outlet|open[ -]?box|b[ -]?stock|grade\s*[abc]|bundle)\b|μεταχειρισ|ανακατασκευ|εκθεσιακ|ανοιχτη\s+συσκευασια|αποσφραγισ/.test(normalize(value))

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
type Element = { attrs: Record<string, string>; html: string; content: string }
function concealed(element: Element): boolean {
  const opening = element.html.slice(0, element.html.indexOf('>'))
  return /(?:^|\s)hidden(?:\s|=|$)/i.test(opening) || element.attrs['aria-hidden'] === 'true'
    || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(element.attrs.style ?? '')
    || (element.attrs.class?.split(/\s+/).some(name => name === 'hidden' || name === 'd-none') ?? false)
}

/** Scan balanced elements in bounded inert HTML, so prices cannot escape their own buy box. */
function elements(source: string, tag: string, predicate: (attributes: Record<string, string>) => boolean): Element[] {
  const found: Element[] = []
  const opening = new RegExp(`<${tag}\\b([^>]*)>`, 'gi')
  for (const match of source.matchAll(opening)) {
    const attributes = attrs(match[1])
    if (!predicate(attributes)) continue
    if (found.length >= 200) break
    const start = match.index! + match[0].length
    const tokens = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi')
    tokens.lastIndex = start
    let depth = 1, count = 0
    for (let token = tokens.exec(source); token && ++count < 10000; token = tokens.exec(source)) {
      depth += token[0].startsWith('</') ? -1 : 1
      if (depth === 0) {
        found.push({ attrs: attributes, content: source.slice(start, token.index), html: source.slice(match.index, tokens.lastIndex) })
        break
      }
    }
  }
  return found
}
const hasClass = (attributes: Record<string, string>, name: string) => attributes.class?.split(/\s+/).includes(name) ?? false
function inputs(html: string): Record<string, string>[] { return [...html.matchAll(/<input\b([^>]*)>/gi)].map(input => attrs(input[1])) }
function productUrl(value: string, base = ORIGIN): string | null {
  try {
    const safe = safeRetailUrl(new URL(decode(value), base).href)
    if (!safe) return null
    const url = new URL(safe)
    if (url.origin !== ORIGIN || url.search || !/^\/product\/\d+\/[a-z0-9/-]+$/i.test(url.pathname) || excluded(url.pathname)) return null
    return url.href
  } catch { return null }
}

export const cosmodataAdapter: MerchantAdapter = {
  id: 'cosmodata', name: 'Cosmodata', origin: ORIGIN,
  searchUrl(identity) {
    if (!identity.model || identity.model.length > 100 || !/^[a-z0-9 /-]+$/.test(identity.model)) return null
    return `${ORIGIN}/search?${new URLSearchParams({ aq: identity.model })}`
  },
  productLinks(html, sourceUrl, identity) {
    if (Buffer.byteLength(html, 'utf8') > MAX_BYTES) return []
    try { if (new URL(sourceUrl).origin !== ORIGIN || new URL(sourceUrl).pathname !== '/search') return [] } catch { return [] }
    // Some queries redirect to a category that requires JavaScript. No results there
    // is limited coverage, not permission to infer URLs from a category or query.
    const clean = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    const links = new Set<string>()
    for (const card of elements(clean, 'div', attributes => hasClass(attributes, 'pd_div5'))) {
      const titles = elements(card.content, 'div', attributes => hasClass(attributes, 'pd_title'))
      if (titles.length !== 1 || excluded(text(titles[0].content)) || !matchesProduct(identity, text(titles[0].content))) continue
      const candidates = [...card.content.matchAll(/<a\b([^>]*)>/gi)].map(anchor => attrs(anchor[1]).href)
        .filter((value): value is string => !!value).map(value => productUrl(value, sourceUrl)).filter((value): value is string => !!value)
      const urls = [...new Set(candidates)]
      if (urls.length === 1) links.add(urls[0])
      if (links.size === 3) break
    }
    return [...links]
  },
  parseOffer(html, sourceUrl, identity) {
    const destination = productUrl(sourceUrl)
    if (!destination || Buffer.byteLength(html, 'utf8') > MAX_BYTES) return null
    // The audited regular-peripheral catalogue is separate from refurbished paths.
    // Other categories need their own condition evidence before being admitted here.
    if (!new URL(destination).pathname.match(/^\/product\/\d+\/periferiaka\//)) return null
    const productId = new URL(destination).pathname.split('/')[2]
    const clean = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    const canonical = [...clean.matchAll(/<link\b([^>]*)>/gi)].map(link => attrs(link[1])).filter(link => link.rel === 'canonical')
    if (canonical.length !== 1 || productUrl(canonical[0].href ?? '') !== destination) return null
    const titles = elements(clean, 'div', attributes => attributes.id === 'product_title')
    const bars = elements(clean, 'div', attributes => hasClass(attributes, 'product_diathe_bar'))
    const boxes = elements(clean, 'div', attributes => hasClass(attributes, 'pd_top_main_right'))
    if (titles.length !== 1 || bars.length !== 1 || boxes.length !== 1 || [titles[0], bars[0], boxes[0]].some(concealed)) return null
    const title = text(titles[0].content), bar = bars[0].content, box = boxes[0].content
    if (excluded(title + ' ' + text(bar) + ' ' + text(box)) || !matchesProduct(identity, title)) return null
    const info = inputs(bar)
    const ids = info.filter(input => input.id === 'pd_idx')
    const names = info.filter(input => input.id === `title_${productId}`)
    if (ids.length !== 1 || ids[0].value !== productId || names.length !== 1 || names[0].value !== title) return null
    if (!/ΚΩΔΙΚΟΣ\s*:\s*0\.\d{3}\.\d{5}(?:\s|$)/u.test(text(bar))) return null
    const stock = elements(bar, 'span', attributes => hasClass(attributes, 'productStock'))
    if (stock.length !== 1 || !/^(?:σε αποθεμα|κατοπιν παραγγελιας|\d{1,2} εως \d{1,2} ημερες)$/.test(normalize(text(stock[0].content)))) return null
    // Isolated catalogue inference, not fabricated NewCondition: /view/44 documents
    // sealed original goods and manufacturer DOA replacement. Admission additionally
    // requires regular SKU 0.*, no refurb/open-box label, and an explicit zero-cost
    // standard manufacturer warranty on THIS product. Missing evidence fails closed.
    const warranties = elements(box, 'select', attributes => attributes.id === 'warranty_select')
    if (warranties.length !== 1) return null
    const standard = elements(warranties[0].content, 'option', attributes => attributes.value === '0' && attributes.warfpw === '0')
    if (standard.length !== 1 || normalize(text(standard[0].content)) !== 'τυπικη με ορους αντιπροσωπειας + 0.00€') return null
    const money = inputs(box).filter(input => input.id === 'price_current')
    const from = inputs(box).filter(input => input.id === 'price_from')
    const whole = elements(box, 'span', attributes => attributes.id === 'price_current1')
    const cents = elements(box, 'span', attributes => attributes.id === 'price_current1x')
    if (money.length !== 1 || !/^\d+(?:\.\d{1,2})?$/.test(money[0].value ?? '')
      || from.length !== 1 || from[0].value !== '0' || whole.length !== 1 || cents.length !== 1 || whole.some(concealed) || cents.some(concealed)) return null
    const visible = text(whole[0].content) + text(cents[0].content)
    if (!/^\d+\.\d{2}€$/.test(visible)) return null
    const price = Number(visible.slice(0, -1))
    if (!Number.isFinite(price) || price <= 0 || price > 10000000 || price !== Number(money[0].value)) return null
    const cart = elements(box, 'div', attributes => attributes.id === `basketnew_${productId}` && hasClass(attributes, 'basketnew'))
    if (!cart.length || cart.some(element => /display\s*:\s*none|visibility\s*:\s*hidden/i.test(element.attrs.style ?? ''))) return null
    // If this store adds structured product/price evidence, it must corroborate
    // the visible quote; unsupported new markup is not silently ignored.
    if (/\bitemprop\s*=\s*["'](?:price|itemCondition)["']/i.test(clean)) return null
    if (/["']@type["']\s*:\s*["']Product["']/.test(html)) {
      const structured = parseMerchantOffer(html, { shop: this.name, price, url: destination }, identity)
      if (!structured || structured.price !== price || productUrl(structured.url) !== destination) return null
    }
    return { shop: this.name, price, url: destination }
  },
}
