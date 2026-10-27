import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientRequest, IncomingMessage } from 'node:http'
import type { RequestOptions } from 'node:https'
import { parseMerchantOffer, readRetailPage, safeRetailUrl, verifyNewRetailOffer } from '@/lib/pricing/merchant-verifier'
import type { ProductIdentity } from '@/lib/pricing/matching'

const network = vi.hoisted(() => ({ lookup: vi.fn(), get: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: network.lookup }))
vi.mock('node:https', () => ({ get: network.get }))

const identity: ProductIdentity = {
  query: 'Sony WH-1000XM5', model: 'sony wh1000xm5', tokens: ['sony', 'wh1000xm5'],
  variantTokens: [], condition: 'unknown',
}
const offer = { shop: 'Example retailer', price: 190, url: 'https://retailer.gr/product/sony-wh1000xm5' }
const product = (changes: Record<string, unknown> = {}) => ({
  '@type': 'Product', name: 'Sony WH-1000XM5',
  offers: { '@type': 'Offer', price: '179.88', priceCurrency: 'EUR', itemCondition: 'https://schema.org/NewCondition', availability: 'https://schema.org/InStock' },
  ...changes,
})
const html = (value: unknown) => `<html><script type="application/ld+json">${JSON.stringify(value)}</script></html>`

beforeEach(() => {
  network.lookup.mockReset().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  network.get.mockReset()
  vi.useRealTimers()
})

describe('merchant offer evidence', () => {
  it('uses the current exact-product EUR quote, rather than the search price', () => {
    expect(parseMerchantOffer(html(product()), offer, identity)).toEqual({ ...offer, price: 179.88 })
  })
  it('agrees on multi-word manufacturer spellings without accepting a different brand', () => {
    const router: ProductIdentity = { model: 'tplink archer ax55', query: 'tplink archer ax55', tokens: ['tplink', 'archer', 'ax55'], variantTokens: [], condition: 'unknown' }
    const value = product({ name: 'TP-Link Archer AX55 AX3000', brand: 'TP-Link' })
    expect(parseMerchantOffer(html(value), offer, router)?.price).toBe(179.88)
    expect(parseMerchantOffer(html({ ...value, brand: 'D-Link' }), offer, router)).toBeNull()
  })

  it('accepts a Product-level new condition and referenced graph Offer', () => {
    const value = { '@graph': [
      product({ itemCondition: 'NewCondition', offers: { '@id': '#offer' } }),
      { '@id': '#offer', '@type': 'Offer', price: 180, priceCurrency: 'EUR' },
    ] }
    expect(parseMerchantOffer(html(value), offer, identity)?.price).toBe(180)
  })

  it('uses explicit product brand and color without borrowing query metadata', () => {
    const black = { ...identity, variantTokens: ['black'] }
    for (const brand of ['Sony', { '@type': 'Brand', name: 'Sony' }]) {
      expect(parseMerchantOffer(html(product({ name: 'WH-1000XM5', brand, color: 'Black' })), offer, black)?.price).toBe(179.88)
    }
    expect(parseMerchantOffer(html(product({ name: 'Sony WH-1000XM5 Black', brand: 'Sony', color: 'Black' })), offer, black)?.price).toBe(179.88)
    expect(parseMerchantOffer(html(product({ name: 'WH-1000XM5', color: 'Black' })), offer, black)).toBeNull()
    expect(parseMerchantOffer(html(product({ brand: 'Apple' })), offer, identity)).toBeNull()
    expect(parseMerchantOffer(html(product({ name: 'Sony WH-1000XM5 Black', color: 'White' })), offer, black)).toBeNull()
  })

  it('accepts explicit schema enum identifiers without weakening condition or stock checks', () => {
    const quote = { price: 180, priceCurrency: 'EUR', itemCondition: { '@id': 'https://schema.org/NewCondition' } }
    expect(parseMerchantOffer(html(product({ offers: quote })), offer, identity)?.price).toBe(180)
    expect(parseMerchantOffer(html(product({ itemCondition: { '@id': 'https://schema.org/NewCondition' }, offers: { price: 180, priceCurrency: 'EUR' } })), offer, identity)?.price).toBe(180)
    expect(parseMerchantOffer(html(product({ offers: { ...quote, itemCondition: { '@id': 'https://schema.org/UsedCondition' } } })), offer, identity)).toBeNull()
    expect(parseMerchantOffer(html(product({ offers: { ...quote, availability: { '@id': 'https://schema.org/OutOfStock' } } })), offer, identity)).toBeNull()
  })

  it('returns the safe product destination belonging to the lowest verified quote', () => {
    const page = { ...offer, url: 'https://retailer.gr/category/headphones' }
    const quote = { price: 180, priceCurrency: 'EUR', itemCondition: 'NewCondition' }
    const value = product({ url: '/product/default', offers: [
      { ...quote, url: '/product/expensive' }, { ...quote, price: 170, url: '/product/lowest' },
    ] })
    expect(parseMerchantOffer(html(value), page, identity)).toEqual({ ...page, price: 170, url: 'https://retailer.gr/product/lowest' })
    expect(parseMerchantOffer(html(product({ url: '/product/default' })), page, identity)?.url).toBe('https://retailer.gr/product/default')
    expect(parseMerchantOffer(html(product({ url: 'https://other-shop.gr/product' })), page, identity)).toBeNull()
    expect(parseMerchantOffer(html(product({ url: 'http://retailer.gr/product' })), page, identity)).toBeNull()
  })

  it('does not turn an ambiguous multi-product page into a direct product link', () => {
    const first = product({ '@id': '#exact' })
    const other = product({ '@id': '#other', name: 'Sony WH-1000XM4' })
    expect(parseMerchantOffer(html([first, other]), offer, identity)).toBeNull()
    expect(parseMerchantOffer(html([{ ...first, url: '/product/exact' }, other]), offer, identity)?.url).toBe('https://retailer.gr/product/exact')
    expect(parseMerchantOffer(html({ '@graph': [{ '@type': 'WebPage', mainEntity: { '@id': '#exact' } }, first, other] }), offer, identity)?.url).toBe(offer.url)
    expect(parseMerchantOffer(html({ '@graph': [first, other, { '@type': 'WebPage', mainEntity: { '@id': '#exact' } }] }), offer, identity)?.url).toBe(offer.url)
    expect(parseMerchantOffer(html({ '@graph': [{ '@type': 'WebPage', mainEntity: { '@id': '#other' } }, first, other] }), offer, identity)).toBeNull()
    expect(parseMerchantOffer(html({ '@graph': [{ '@type': 'WebPage', mainEntity: [{ '@id': '#exact' }, { '@id': '#other' }] }, first, other] }), offer, identity)).toBeNull()
    expect(parseMerchantOffer(html({ '@type': 'ItemPage', mainEntity: first }), offer, identity)?.price).toBe(179.88)
  })

  it.each([
    { price: 180, priceCurrency: 'EUR' },
    { price: 180, priceCurrency: 'EUR', itemCondition: 'UsedCondition' },
    { price: 180, priceCurrency: 'EUR', itemCondition: 'RefurbishedCondition' },
    { price: 180, priceCurrency: 'USD', itemCondition: 'NewCondition' },
    { price: 0, priceCurrency: 'EUR', itemCondition: 'NewCondition' },
    { price: '1,999', priceCurrency: 'EUR', itemCondition: 'NewCondition' },
    { price: 180, priceCurrency: 'EUR', itemCondition: 'NewCondition', availability: 'OutOfStock' },
    { price: 180, priceCurrency: 'EUR', itemCondition: 'NewCondition', priceValidUntil: '2020-01-01' },
    { price: 180, priceCurrency: 'EUR', itemCondition: 'NewCondition', url: 'https://other-shop.gr/p' },
    { '@type': 'AggregateOffer', lowPrice: 180, priceCurrency: 'EUR', itemCondition: 'NewCondition' },
    { itemCondition: 'NewCondition', priceSpecification: { price: 20, priceCurrency: 'EUR', billingDuration: 'P1M' } },
    { itemCondition: 'NewCondition', priceSpecification: { price: 20, priceCurrency: 'EUR', priceType: 'https://schema.org/StrikethroughPrice' } },
    { price: 20, priceCurrency: 'EUR', itemCondition: 'NewCondition', priceSpecification: { price: 20, priceCurrency: 'EUR', billingDuration: 'P1M' } },
  ])('rejects unverified or unusable quote %j', quote => {
    expect(parseMerchantOffer(html(product({ offers: quote })), offer, identity)).toBeNull()
  })

  it('does not borrow new condition from an unrelated or different-model product', () => {
    expect(parseMerchantOffer(html([
      product({ name: 'Sony WH-1000XM4' }),
      product({ offers: { price: 180, priceCurrency: 'EUR' } }),
    ]), offer, identity)).toBeNull()
  })

  it('does not override an offer condition with a product condition', () => {
    expect(parseMerchantOffer(html(product({ itemCondition: 'NewCondition', offers: { price: 180, priceCurrency: 'EUR', itemCondition: 'UsedCondition' } })), offer, identity)).toBeNull()
  })

  it('rejects conflicting used-product / new-offer condition evidence', () => {
    expect(parseMerchantOffer(html(product({ itemCondition: 'UsedCondition' })), offer, identity)).toBeNull()
  })

  it('rejects a refurbished product name even if the offer wrongly claims new', () => {
    expect(parseMerchantOffer(html(product({ name: 'Sony WH-1000XM5 Refurbished' })), offer, identity)).toBeNull()
  })

  it('accepts priceSpecification and skips malformed scripts without executing code', () => {
    const page = `<script type="application/ld+json">not json</script>${html(product({ offers: { itemCondition: 'new', priceSpecification: { price: '181.25', priceCurrency: 'EUR' } } }))}`
    expect(parseMerchantOffer(page, offer, identity)?.price).toBe(181.25)
  })
})

describe('retail URL boundary', () => {
  it.each([
    'http://retailer.gr/p', 'https://user:password@retailer.gr/p', 'https://retailer.gr:8443/p',
    'https://127.0.0.1/p', 'https://2130706433/p', 'https://[::1]/p', 'https://localhost/p',
    'https://machine.local/p', 'https://www.google.gr/shopping/product/123', 'https://bestprice.gr/p',
    'https://www.skroutz.gr/p', 'https://serpapi.com/search', 'https://retailer.gr/redirect?url=https://other.gr',
    'https://duckduckgo.com/?q=sony', 'https://html.duckduckgo.com/html/?q=sony',
    'https://retailer.gr/p?next=https%3A%2F%2Fother.gr',
  ])('rejects %s', url => expect(safeRetailUrl(url)).toBeNull())

  it('preserves normal merchant links and strips fragments', () => {
    expect(safeRetailUrl(`${offer.url}?srsltid=abc#details`)).toBe(`${offer.url}?srsltid=abc`)
  })
})

type Reply = { status?: number; headers?: Record<string, string | undefined>; body?: string | Buffer }
function replies(...pages: Reply[]) {
  network.get.mockImplementation((_url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    const req = new EventEmitter() as ClientRequest
    req.destroy = vi.fn(() => req)
    const reply = pages.shift() ?? {}
    queueMicrotask(() => {
      const res = new EventEmitter() as IncomingMessage
      res.statusCode = reply.status ?? 200
      res.headers = { 'content-type': 'text/html', ...reply.headers }
      res.destroy = vi.fn(() => res)
      callback(res)
      res.emit('data', Buffer.from(reply.body ?? html(product())))
      res.emit('end')
    })
    return req
  })
}

describe('bounded merchant requests', () => {
  it('decodes the declared Greek catalogue charset without mangling product identity', async () => {
    // ISO-8859-7 bytes for ΜΑΥΡΟ, used by the e-shop.gr catalogue.
    replies({ headers: { 'content-type': 'text/html; charset=iso-8859-7' }, body: Buffer.from([0xcc, 0xc1, 0xd5, 0xd1, 0xcf]) })
    expect(await readRetailPage(offer.url)).toEqual({ html: 'ΜΑΥΡΟ', url: offer.url })
  })

  it('fails closed for an unsupported charset', async () => {
    replies({ headers: { 'content-type': 'text/html; charset=unknown-encoding' } })
    expect(await readRetailPage(offer.url)).toBeNull()
  })

  it.each(['0.0.0.0', '10.0.0.1', '127.0.0.1', '100.64.0.1', '169.254.169.254', '172.16.1.1', '192.168.1.1', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::1'])('rejects DNS resolving to %s before opening a connection', async address => {
    network.lookup.mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }])
    expect(await verifyNewRetailOffer(offer, identity)).toBeNull()
    expect(network.get).not.toHaveBeenCalled()
  })

  it('pins the approved IP in lookup while preserving the HTTPS hostname', async () => {
    replies({})
    expect(await verifyNewRetailOffer(offer, identity)).toEqual({ ...offer, price: 179.88 })
    const [url, options] = network.get.mock.calls[0] as [URL, RequestOptions]
    expect(url.hostname).toBe('retailer.gr')
    expect(options.agent).toBe(false)
    expect(options.family).toBe(4)
    const callback = vi.fn()
    options.lookup?.('retailer.gr', {}, callback)
    expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4)
  })

  it('rejects a mixed public/private DNS answer', async () => {
    network.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }])
    expect(await verifyNewRetailOffer(offer, identity)).toBeNull()
    expect(network.get).not.toHaveBeenCalled()
  })

  it('allows a www redirect and re-resolves its destination', async () => {
    replies({ status: 301, headers: { location: 'https://www.retailer.gr/product/sony-wh1000xm5' } }, {})
    expect(await verifyNewRetailOffer(offer, identity)).toEqual({ ...offer, url: 'https://www.retailer.gr/product/sony-wh1000xm5', price: 179.88 })
    expect(network.lookup).toHaveBeenCalledTimes(2)
  })

  it('rejects cross-host redirects before requesting them', async () => {
    replies({ status: 302, headers: { location: 'https://other-shop.gr/p' } })
    expect(await verifyNewRetailOffer(offer, identity)).toBeNull()
    expect(network.get).toHaveBeenCalledTimes(1)
  })

  it('caps redirects at two', async () => {
    replies(...Array.from({ length: 3 }, () => ({ status: 302, headers: { location: '/product/next' } })))
    expect(await verifyNewRetailOffer(offer, identity)).toBeNull()
    expect(network.get).toHaveBeenCalledTimes(3)
  })

  it.each([
    { status: 403 }, { headers: { 'content-type': 'application/json' } },
    { headers: { 'content-length': '1048577' } }, { body: 'a'.repeat(1048577) },
    { headers: { 'content-encoding': 'gzip' } },
  ])('rejects blocked, non-HTML, oversized or encoded responses', async reply => {
    replies(reply)
    expect(await verifyNewRetailOffer(offer, identity)).toBeNull()
  })

  it('includes stalled DNS in the total four-second deadline', async () => {
    vi.useFakeTimers()
    network.lookup.mockReturnValue(new Promise(() => {}))
    const pending = verifyNewRetailOffer(offer, identity)
    await vi.advanceTimersByTimeAsync(4000)
    expect(await pending).toBeNull()
    expect(network.get).not.toHaveBeenCalled()
  })

  it('destroys a request that never responds by the deadline', async () => {
    vi.useFakeTimers()
    const req = new EventEmitter() as ClientRequest
    req.destroy = vi.fn(() => req)
    network.get.mockReturnValue(req)
    const pending = verifyNewRetailOffer(offer, identity)
    await vi.advanceTimersByTimeAsync(4000)
    expect(await pending).toBeNull()
    expect(req.destroy).toHaveBeenCalled()
  })
})
