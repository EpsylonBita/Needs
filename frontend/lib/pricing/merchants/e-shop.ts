import { matchesProduct, type ProductIdentity } from '../matching'
import type { RetailOffer } from '../types'
import type { MerchantAdapter } from './types'

const ORIGIN = 'https://www.e-shop.gr'
const MAX_HTML = 1024 * 1024
// This encoded value is the public site's observed ISO-8859-7 phone-category link.
const PHONE_CATEGORY = '%CA%C9%CD%C7%D4%CF+%D4%C7%CB%C5%D6%D9%CD%CF'
const notNew = /\b(?:used|refurbished|renewed|reconditioned|open[ -]?box|second[ -]?hand|stock[ -]?house|ex[ -]?display)\b|μεταχειρισ|ανακατασκευασ|εκθεσιακ|αποσφραγισ/iu
const conditionalPriceProperties = new Set([
  'billingduration', 'billingincrement', 'unitcode', 'unittext', 'referencequantity',
  'eligiblequantity', 'eligibletransactionvolume', 'validformembertier', 'pricetype',
])

function decode(value: string): string {
  const named: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', euro: '€' }
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp|euro);/gi, (entity, key: string) => {
    if (named[key.toLowerCase()]) return named[key.toLowerCase()]
    const point = /^#x/i.test(key) ? Number.parseInt(key.slice(2), 16) : Number(key.slice(1))
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity
  })
}

function text(value: string): string {
  return decode(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function attributes(value: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const attribute of value.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    result[attribute[1].toLowerCase()] = decode(attribute[2] ?? attribute[3])
  }
  return result
}

function properties(html: string): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const tag of html.matchAll(/<(meta|link|span|a)\b([^>]*)>/gi)) {
    const attrs = attributes(tag[2])
    if (!attrs.itemprop) continue
    let value = attrs.content ?? attrs.href
    if (value === undefined && tag[1].toLowerCase() === 'span') {
      const remainder = html.slice(tag.index! + tag[0].length)
      const end = remainder.search(/<\/span\s*>/i)
      if (end < 0) continue
      value = text(remainder.slice(0, end))
    }
    if (value === undefined) continue
    for (const property of attrs.itemprop.split(/\s+/)) {
      result.set(property, [...(result.get(property) ?? []), value.trim()])
    }
  }
  return result
}

function scalar(values: Map<string, string[]>, key: string): string | null {
  const unique = [...new Set(values.get(key))]
  return unique.length === 1 && unique[0] ? unique[0] : null
}

function productUrl(value: string, base = ORIGIN): string | null {
  try {
    const url = new URL(value, base)
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !['e-shop.gr', 'www.e-shop.gr'].includes(url.hostname)
      || !/-p-[a-z]{2,6}\.\d{3,12}$/i.test(url.pathname) || url.search) return null
    url.hostname = 'www.e-shop.gr'
    url.hash = ''
    return url.href
  } catch { return null }
}

function normalizedTitle(title: string): string {
  // The live S25 pages explicitly carry S931 as a supplemental manufacturer code.
  // Other model codes, RAM, capacity, connectivity and colors remain meaningful.
  if (/\bsamsung\s+(?:galaxy\s+)?s25\b/i.test(title) && !/\bs25\s*(?:plus|ultra|\+)/i.test(title)) {
    return title.replace(/\bs931\b/gi, ' ')
  }
  return title
}

function exactProduct(identity: ProductIdentity, title: string): boolean {
  // Older shared identities do not retain these distinct Samsung color names.
  // They must not collapse into the same product merely because both lost their color token.
  const namedColor = title.match(/\b(mint|navy)\b/i)?.[1].toLowerCase()
  if (namedColor && !identity.variantTokens.includes(namedColor)) return false
  return !notNew.test(title) && matchesProduct(identity, normalizedTitle(title))
}

function searchUrl(identity: ProductIdentity): string | null {
  if (!identity.model || !identity.query) return null
  const phone = /^(?:samsung (?:s\d+|a\d+|note\d+)|iphone \d+|pixel \d+a?)$/.test(identity.model)
  const capacity = identity.variantTokens.filter(token => /^(?:\d+(?:p\d+)?tb|(?:[6-9]\d|\d{3,})gb)$/.test(token))
  const url = new URL('/search', ORIGIN)
  // Color is checked on product links; keeping it out of discovery avoids a retailer's color aliases.
  url.searchParams.set('q', phone ? [identity.model, ...capacity].join(' ') : identity.query)
  return url.href + (phone ? '&page=1&category=' + PHONE_CATEGORY : '')
}

function productLinks(html: string, sourceUrl: string, identity: ProductIdentity): string[] {
  if (html.length > MAX_HTML) return []
  try {
    if (new URL(sourceUrl).origin !== ORIGIN || new URL(sourceUrl).pathname !== '/search') return []
  } catch { return [] }
  const links = new Set<string>()
  for (const anchor of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = attributes(anchor[1]).href
    const url = href ? productUrl(href, sourceUrl) : null
    if (!url || !exactProduct(identity, text(anchor[2]))) continue
    links.add(url)
    if (links.size === 3) break
  }
  return [...links]
}

function parseOffer(html: string, sourceUrl: string, identity: ProductIdentity): RetailOffer | null {
  const url = productUrl(sourceUrl)
  if (!url || html.length > MAX_HTML) return null
  const clean = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
  const headingTags = [...clean.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi)]
  const headings = headingTags.map(match => text(match[1]))
  if (headings.length !== 1 || !exactProduct(identity, headings[0])) return null
  const scopes = [...clean.matchAll(/<div\b([^>]*)>/gi)].filter(match => /\bitemscope\b/i.test(match[1])
    && /^https?:\/\/schema\.org\/Product$/.test(attributes(match[1]).itemtype ?? ''))
  if (scopes.length !== 1) return null
  const headingEnd = headingTags[0].index! + headingTags[0][0].length
  if (scopes[0].index! <= headingEnd) return null
  const primaryRegion = clean.slice(headingEnd, scopes[0].index)
  const visiblePrices = [...primaryRegion.matchAll(/<div\b([^>]*)>/gi)]
    .filter(match => (attributes(match[1]).class ?? '').split(/\s+/).includes('web-prices-v2'))
    .map(match => {
      const remainder = primaryRegion.slice(match.index! + match[0].length)
      const end = remainder.search(/<\/div\s*>/i)
      return end < 0 ? '' : text(remainder.slice(0, end))
    })
  if (!visiblePrices.length || visiblePrices.some(value => !/^\d+(?:[.,]\d{1,2})?\s*€$/.test(value))) return null
  const body = clean.slice(scopes[0].index! + scopes[0][0].length)
  const offerTag = [...body.matchAll(/<div\b([^>]*)>/gi)].find(match => {
    const attrs = attributes(match[1])
    return /\bitemscope\b/i.test(match[1]) && attrs.itemprop === 'offers' && /^https?:\/\/schema\.org\/Offer$/.test(attrs.itemtype ?? '')
  })
  // Fail closed on a changed layout instead of searching the rest of the page for an unrelated price.
  if (!offerTag || offerTag.index! > 12000 || /<\/div\s*>/i.test(body.slice(0, offerTag.index))) return null
  const offerBody = body.slice(offerTag.index! + offerTag[0].length)
  const offerEnd = offerBody.search(/<\/div\s*>/i)
  if (offerEnd < 0 || offerEnd > 4000 || /<div\b/i.test(offerBody.slice(0, offerEnd))) return null
  const offerMarkup = offerBody.slice(0, offerEnd)
  for (const tag of offerMarkup.matchAll(/<[a-z][\w:-]*\b([^>]*)>/gi)) {
    const props = attributes(tag[1]).itemprop?.toLowerCase().split(/\s+/) ?? []
    if (props.some(property => conditionalPriceProperties.has(property))) return null
  }
  const product = properties(body.slice(0, offerTag.index))
  const offer = properties(offerMarkup)
  const name = scalar(product, 'name')
  const sku = scalar(product, 'sku')
  if (!name || text(name) !== headings[0] || !exactProduct(identity, name)
    || !sku || !url.toLowerCase().endsWith('-p-' + sku.toLowerCase())) return null
  const declaredUrls = [...(product.get('url') ?? []), ...(offer.get('url') ?? [])]
  if (!declaredUrls.length || declaredUrls.some(value => productUrl(value) !== url)) return null
  const conditions = [...(product.get('itemCondition') ?? []), ...(offer.get('itemCondition') ?? [])]
  if (!conditions.length || conditions.some(value => !/^https?:\/\/schema\.org\/NewCondition$/.test(value))) return null
  if (scalar(offer, 'priceCurrency') !== 'EUR') return null
  const priceText = scalar(offer, 'price')
  if (!priceText || !/^\d+(?:[.,]\d{1,2})?$/.test(priceText)) return null
  const price = Number(priceText.replace(',', '.'))
  if (!Number.isFinite(price) || price <= 0) return null
  // The primary displayed whole price must corroborate the structured offer.
  // Historic minimum/list prices have different classes and are never fallback evidence.
  if (visiblePrices.some(value => Number(value.replace(/\s*€$/, '').replace(',', '.')) !== price)) return null
  const availability = scalar(offer, 'availability')
  if (!availability || !/^https?:\/\/schema\.org\/(?:InStock|LimitedAvailability|OnlineOnly|PreOrder|PreSale|BackOrder)$/.test(availability)) return null
  const validUntil = scalar(offer, 'priceValidUntil')
  if (offer.has('priceValidUntil') && !validUntil) return null
  if (validUntil && (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil)
    || !Number.isFinite(Date.parse(validUntil)) || new Date(validUntil).toISOString().slice(0, 10) !== validUntil
    || Date.parse(validUntil + 'T23:59:59.999Z') < Date.now())) return null
  return { shop: 'e-shop.gr', price, url }
}

export const eShopAdapter: MerchantAdapter = { id: 'e-shop', name: 'e-shop.gr', origin: ORIGIN, searchUrl, productLinks, parseOffer }
