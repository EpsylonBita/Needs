// Node-only: call with audited retailer catalogue links, never an arbitrary request URL.
import { lookup } from 'node:dns/promises'
import { get } from 'node:https'
import type { ClientRequest } from 'node:http'
import { isIP } from 'node:net'
import { matchesProduct, normalizeProductBrand, type ProductIdentity } from './matching'
import type { RetailOffer } from './types'

const MAX_BYTES = 1024 * 1024
const TIMEOUT_MS = 4000
const BLOCKED_DOMAINS = [
  'bestprice.gr', 'skroutz.gr', 'serpapi.com', 'shopping.com', 'bing.com', 'duckduckgo.com',
  'googleusercontent.com', 'gstatic.com', 'shopzilla.com', 'pricegrabber.com',
  'bit.ly', 't.co', 'tinyurl.com',
]
const REDIRECT_KEYS = /^(?:url|target|redirect(?:_?url|_?uri)?|dest(?:ination)?|next|continue|return(?:_?url)?|link|out)$/i

/** Syntactic gate only. DNS is checked and pinned immediately before every request. */
export function safeRetailUrl(value: string): string | null {
  try {
    if (typeof value !== 'string' || value.length > 4096) return null
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null
    if (isIP(hostname.replace(/^\[|\]$/g, '')) || !hostname.includes('.') || hostname.endsWith('.')) return null
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname) || hostname.includes('..')) return null
    if (/(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example|onion)$/.test(hostname)) return null
    if (/(?:^|\.)google\.[a-z.]+$/.test(hostname)) return null
    if (BLOCKED_DOMAINS.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))) return null
    if (/(?:^|\/)(?:redirect|out|away|click|url|go)(?:\/|$)/i.test(decodeURIComponent(url.pathname))) return null
    for (const [key, queryValue] of url.searchParams) {
      if (REDIRECT_KEYS.test(key) && /^(?:https?:)?\/\//i.test(queryValue.trim())) return null
    }
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

function publicIPv4(address: string): boolean {
  if (isIP(address) !== 4) return false
  const [a, b, c] = address.split('.').map(Number)
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99)))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113))
}

function merchantHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '')
}

async function resolvePublicAddress(hostname: string, deadline: number): Promise<string | null> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) return null
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), remaining)
    // IPv4 only is intentional: IPv6-only retailers fail closed instead of weakening IP checks.
    lookup(hostname, { family: 4, all: true, verbatim: true }).then(addresses => {
      clearTimeout(timer)
      resolve(addresses.length > 0 && addresses.every(item => publicIPv4(item.address))
        ? addresses[0].address : null)
    }, () => { clearTimeout(timer); resolve(null) })
  })
}

type Page = { html: string } | { redirect: string }

async function requestPage(url: URL, deadline: number): Promise<Page | null> {
  const address = await resolvePublicAddress(url.hostname, deadline)
  const remaining = deadline - Date.now()
  if (!address || remaining <= 0) return null
  return new Promise(resolve => {
    let settled = false
    let request: ClientRequest | undefined
    const finish = (page: Page | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      request?.destroy()
      resolve(page)
    }
    const timer = setTimeout(() => finish(null), remaining)
    try {
      request = get(url, {
        agent: false,
        family: 4,
        // Keep URL hostname for Host, SNI and certificate verification, but connect only to this IP.
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [{ address, family: 4 }])
          else callback(null, address, 4)
        },
        headers: { Accept: 'text/html,application/xhtml+xml', 'Accept-Encoding': 'identity', 'User-Agent': 'NeedsPriceVerifier/1.0' },
      }, response => {
        response.on('error', () => finish(null))
        response.on('aborted', () => finish(null))
        const status = response.statusCode ?? 0
        if ([301, 302, 303, 307, 308].includes(status)) {
          finish(response.headers.location ? { redirect: response.headers.location } : null)
          response.destroy()
          return
        }
        const contentType = String(response.headers['content-type'] ?? '').toLowerCase()
        const encoding = response.headers['content-encoding']
        if (status !== 200 || !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/.test(contentType)
          || (encoding && encoding !== 'identity')
          || Number(response.headers['content-length']) > MAX_BYTES) {
          finish(null)
          response.destroy()
          return
        }
        let size = 0
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer | string) => {
          if (settled) return
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          size += buffer.length
          if (size > MAX_BYTES) { finish(null); response.destroy(); return }
          chunks.push(buffer)
        })
        response.on('end', () => {
          try {
            const charset = contentType.match(/charset\s*=\s*["']?([\w-]+)/)?.[1] ?? 'utf-8'
            // e-shop.gr serves its catalogue in ISO-8859-7. Decode declared text, never scripts.
            finish({ html: new TextDecoder(charset).decode(Buffer.concat(chunks)) })
          } catch { finish(null) }
        })
      })
      request.on('error', () => finish(null))
    } catch {
      finish(null)
    }
  })
}

type JsonObject = Record<string, unknown>
function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null
}
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : [value] }
function schemaName(value: unknown): string {
  const identifier = typeof value === 'string' ? value : object(value)?.['@id']
  return typeof identifier === 'string' ? identifier.replace(/^https?:\/\/schema\.org\//i, '').toLowerCase() : ''
}
function hasType(value: JsonObject, type: string): boolean {
  return list(value['@type']).some(item => schemaName(item) === type.toLowerCase())
}
function amount(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d{1,4})?$/.test(value.trim()))) return null
  const price = Number(value)
  return Number.isFinite(price) && price > 0 && price <= 10000000 ? price : null
}

function secondhandName(value: unknown): boolean {
  return typeof value === 'string' && /\b(?:used|refurbished|renewed|pre[ -]?owned|open[ -]?box|second[ -]?hand)\b|μεταχειρισ|ανακατασκευ|εκθεσιακ/i.test(value)
}

function productMatches(product: JsonObject, identity: ProductIdentity): boolean {
  if (typeof product.name !== 'string' || secondhandName(product.name)) return false
  const brand = typeof product.brand === 'string' ? product.brand : object(product.brand)?.name
  if (product.brand != null) {
    if (typeof brand !== 'string' || !brand.trim()) return false
    const familyBrands: Record<string, string> = { iphone: 'apple', macbook: 'apple', pixel: 'google', playstation: 'sony', xbox: 'microsoft' }
    const family = identity.model.split(' ')[0]
    const brandWords = normalizeProductBrand(brand).split(' ')
    if (!brandWords.includes(familyBrands[family] ?? family)) return false
  }
  if (product.color != null && typeof product.color !== 'string') return false
  // Only metadata belonging to this Product may complete its name; never infer from the query.
  return matchesProduct(identity, [brand, product.name, product.color].filter(value => typeof value === 'string').join(' '))
}

function productDestination(value: unknown, pageUrl: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = safeRetailUrl(new URL(value, pageUrl).href)
    return url && merchantHost(new URL(url)) === merchantHost(new URL(pageUrl)) ? url : null
  } catch { return null }
}

/** Reads evidence only. Missing or blocked merchant markup means insufficient coverage. */
export function parseMerchantOffer(html: string, offer: RetailOffer, identity: ProductIdentity): RetailOffer | null {
  const safeUrl = safeRetailUrl(offer.url)
  if (!safeUrl || Buffer.byteLength(html, 'utf8') > MAX_BYTES) return null
  const nodes: JsonObject[] = []
  const collect = (value: unknown, depth = 0) => {
    if (depth > 15 || nodes.length >= 500) return
    if (Array.isArray(value)) { value.slice(0, 500).forEach(item => collect(item, depth + 1)); return }
    const node = object(value)
    if (!node) return
    nodes.push(node)
    if (node['@graph']) collect(node['@graph'], depth + 1)
    if (hasType(node, 'ProductGroup')) collect(node.hasVariant, depth + 1)
    if (hasType(node, 'WebPage') || hasType(node, 'ItemPage')) collect(node.mainEntity, depth + 1)
  }
  const scripts = html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)
  let count = 0
  for (const script of scripts) {
    if (++count > 80) break
    if (!/\btype\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json'|application\/ld\+json(?=\s|$))/i.test(script[1])) continue
    try { collect(JSON.parse(script[2])) } catch { /* Ignore malformed data; never evaluate scripts. */ }
  }
  const byId = new Map(nodes.filter(node => typeof node['@id'] === 'string').map(node => [node['@id'], node]))
  const products = nodes.filter(node => hasType(node, 'Product'))
  const mainProducts = new Set<JsonObject>()
  for (const page of nodes.filter(node => hasType(node, 'WebPage') || hasType(node, 'ItemPage'))) {
    for (const value of list(page.mainEntity)) {
      const reference = object(value)
      if (!reference) continue
      const entity = typeof reference['@id'] === 'string'
        ? products.find(product => product['@id'] === reference['@id']) ?? reference : reference
      if (hasType(entity, 'Product')) mainProducts.add(entity)
    }
  }
  let lowest: { price: number; url: string } | null = null
  for (const product of products) {
    if (!productMatches(product, identity)) continue
    const productUrl = product.url != null ? productDestination(product.url, safeUrl) : null
    if (product.url != null && !productUrl) continue
    const productCondition = schemaName(product.itemCondition)
    if (product.itemCondition !== undefined && product.itemCondition !== null
      && productCondition !== 'newcondition' && productCondition !== 'new') continue
    for (const value of list(product.offers)) {
      let quote = object(value)
      if (!quote) continue
      if (typeof quote['@id'] === 'string' && byId.has(quote['@id'])) quote = byId.get(quote['@id'])!
      if (quote['@type'] !== undefined && !hasType(quote, 'Offer')) continue
      if (secondhandName(quote.name)) continue
      const condition = schemaName(quote.itemCondition ?? product.itemCondition)
      if (condition !== 'newcondition' && condition !== 'new') continue
      if (['outofstock', 'soldout', 'discontinued', 'instoreonly'].includes(schemaName(quote.availability ?? product.availability))) continue
      if (typeof quote.priceValidUntil === 'string') {
        const expiration = Date.parse(quote.priceValidUntil.length === 10 ? `${quote.priceValidUntil}T23:59:59.999Z` : quote.priceValidUntil)
        if (Number.isFinite(expiration) && expiration < Date.now()) continue
      }
      const quoteUrl = quote.url != null ? productDestination(quote.url, safeUrl) : null
      if (quote.url != null && !quoteUrl) continue
      if (!quoteUrl && !productUrl && products.length > 1 && (mainProducts.size !== 1 || !mainProducts.has(product))) continue
      const specification = object(quote.priceSpecification)
      // A monthly/unit/member/list price must not become the price of the whole item.
      const conditionalPriceKeys = ['billingDuration', 'billingIncrement', 'unitCode', 'unitText', 'referenceQuantity', 'eligibleQuantity', 'eligibleTransactionVolume', 'validForMemberTier']
      if (conditionalPriceKeys.some(key => quote[key] !== undefined || specification?.[key] !== undefined)
        || (quote.price === undefined && specification?.priceType !== undefined)) continue
      const currency = quote.priceCurrency ?? specification?.priceCurrency
      if (currency !== 'EUR') continue
      const price = amount(quote.price ?? specification?.price)
      if (price !== null && (lowest === null || price < lowest.price)) lowest = { price, url: quoteUrl ?? productUrl ?? safeUrl }
    }
  }
  return lowest === null ? null : { ...offer, ...lowest }
}

export async function readRetailPage(url: string, deadline = Date.now() + TIMEOUT_MS): Promise<{ html: string; url: string } | null> {
  const safeUrl = safeRetailUrl(url)
  if (!safeUrl) return null
  const initial = new URL(safeUrl)
  let current = initial
  try {
    for (let redirects = 0; redirects <= 2; redirects++) {
      const page = await requestPage(current, deadline)
      if (!page) return null
      if ('html' in page) return { html: page.html, url: current.href }
      const destination = safeRetailUrl(new URL(page.redirect, current).href)
      if (!destination || merchantHost(new URL(destination)) !== merchantHost(initial)) return null
      current = new URL(destination)
    }
  } catch { /* Network and malformed merchant responses fail closed. */ }
  return null
}

export async function verifyNewRetailOffer(offer: RetailOffer, identity: ProductIdentity): Promise<RetailOffer | null> {
  const page = await readRetailPage(offer.url)
  return page ? parseMerchantOffer(page.html, { ...offer, url: page.url }, identity) : null
}
