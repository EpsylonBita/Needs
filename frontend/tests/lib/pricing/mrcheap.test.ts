import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mrCheapAdapter } from '@/lib/pricing/merchants/mrcheap'
import { getProductIdentity, type ProductIdentity } from '@/lib/pricing/matching'

const fixture = (name: string) => readFileSync(resolve('tests/lib/pricing/fixtures/mrcheap', name), 'utf8')
const identity = (title: string): ProductIdentity => getProductIdentity({ title, description: '', mainCategory: 'Items', subCategory: 'Sell', coordinates: null })!
const sony = identity('Sony WH-1000XM5 Black')
const iphone = identity('iPhone 16 128GB Pink')
const sonyUrl = 'https://mrcheap.gr/sony-wh-1000xm5-wireless-bluetooth-headphones-wh1000xm5bce7'
const iphoneUrl = 'https://mrcheap.gr/iphone-16-128gb-pink-myea3ql-a'

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-27T19:00:00Z')) })
afterEach(() => vi.useRealTimers())

describe('MrCheap public catalogue adapter', () => {
  it('uses the observed public search endpoint with model terms, without listing prose or tracking', () => {
    const url = new URL(mrCheapAdapter.searchUrl(sony)!)
    expect(url.origin).toBe('https://mrcheap.gr')
    expect(url.pathname).toBe('/index.php')
    expect(url.searchParams.get('route')).toBe('product/search')
    expect(url.searchParams.get('search')).toBe('sony wh1000xm5')
    expect([...url.searchParams.keys()]).toEqual(['route', 'search'])
  })

  it.each([
    ['sony', sony, sonyUrl], ['iphone', iphone, iphoneUrl],
  ] as const)('discovers the exact %s product from recorded generic search results', (name, product, url) => {
    expect(mrCheapAdapter.productLinks(fixture(`${name}-search.html`), mrCheapAdapter.searchUrl(product)!, product)).toEqual([url])
  })

  it.each([
    ['sony', sony, sonyUrl, 227], ['iphone', iphone, iphoneUrl, 1023],
  ] as const)('verifies the recorded %s whole EUR price and direct product destination', (name, product, url, price) => {
    expect(mrCheapAdapter.parseOffer(fixture(`${name}-product.html`), url, product)).toEqual({ shop: 'MrCheap.gr', price, url })
  })

  it('retains exact capacity and color, and rejects another model or an unspecified Sony color', () => {
    const html = fixture('iphone-product.html')
    for (const title of ['iPhone 16 256GB Pink', 'iPhone 16 128GB Black', 'iPhone 16 Pro 128GB Pink']) {
      expect(mrCheapAdapter.parseOffer(html, iphoneUrl, identity(title))).toBeNull()
    }
    expect(mrCheapAdapter.parseOffer(fixture('sony-product.html'), sonyUrl, identity('Sony WH-1000XM5'))).toBeNull()
    expect(mrCheapAdapter.parseOffer(fixture('sony-product.html'), sonyUrl, identity('Sony WH-1000XM4 Black'))).toBeNull()
  })

  it('requires the Sony code and black color together in its own description', () => {
    const html = fixture('sony-product.html')
    expect(mrCheapAdapter.parseOffer(html.replace('Χρώμα:</strong> Black', 'Χρώμα:</strong> White'), sonyUrl, sony)).toBeNull()
    expect(mrCheapAdapter.parseOffer(html.replace(/<div class="tab-content">[\s\S]*/, ''), sonyUrl, sony)).toBeNull()
    expect(mrCheapAdapter.parseOffer(html.replace('Κωδικός:</strong> WH1000XM5B.CE7', 'Κωδικός:</strong> WH1000XM4B.CE7'), sonyUrl, sony)).toBeNull()
  })

  it.each(['WH1000XM5SAB.CE7', 'WH1000XM5V2B.CE7', 'WH1000XM5W.CE7'])('never erases the unverified part-number suffix %s', sku => {
    expect(mrCheapAdapter.parseOffer(fixture('sony-product.html').replaceAll('WH1000XM5B.CE7', sku), sonyUrl, sony)).toBeNull()
    expect(mrCheapAdapter.productLinks(fixture('sony-search.html').replaceAll('WH1000XM5B.CE7', sku), mrCheapAdapter.searchUrl(sony)!, sony)).toEqual([])
  })

  it.each([
    ['NewCondition', 'UsedCondition'], ['NewCondition', 'RefurbishedCondition'],
    ['InStock', 'OutOfStock'], ['"EUR"', '"USD"'],
    ['"227.00"', '"22.70"'], ['227,00€', '22,70€'],
    ['227,00€', '22,70€ / μήνα'], ['2027-10-27', '2020-10-27'],
  ])('rejects unusable or contradictory product evidence: %s → %s', (from, to) => {
    expect(mrCheapAdapter.parseOffer(fixture('sony-product.html').replaceAll(from, to), sonyUrl, sony)).toBeNull()
  })

  it('fails closed when condition, stock or visible full price is missing', () => {
    const html = fixture('sony-product.html')
    expect(mrCheapAdapter.parseOffer(html.replace(/"itemCondition":\s*"[^"]+",?/, ''), sonyUrl, sony)).toBeNull()
    expect(mrCheapAdapter.parseOffer(html.replace(/"availability":\s*"[^"]+",?/, ''), sonyUrl, sony)).toBeNull()
    expect(mrCheapAdapter.parseOffer(html.replace(/<div class="product-price">.*?<\/div>/, ''), sonyUrl, sony)).toBeNull()
  })

  it('does not borrow a matching JSON-LD product from a different visible product page', () => {
    const html = fixture('sony-product.html').replace(/(<h1[^>]*>)[\s\S]*?(<\/h1>)/, '$1Sony WH-1000XM4 Black$2')
    expect(mrCheapAdapter.parseOffer(html, sonyUrl, sony)).toBeNull()
    expect(mrCheapAdapter.parseOffer(fixture('sony-product.html'), iphoneUrl, sony)).toBeNull()
    expect(mrCheapAdapter.parseOffer(fixture('sony-product.html') + fixture('iphone-product.html'), sonyUrl, sony)).toBeNull()
  })

  it('ignores navigation, wrong products, foreign destinations and duplicate tracking links', () => {
    const real = fixture('sony-search.html')
    const other = real.replaceAll('https://mrcheap.gr/', 'https://other.gr/')
    const wrong = real.replaceAll('WH-1000XM5', 'WH-1000XM4').replaceAll('WH1000XM5B.CE7', 'WH1000XM4B.CE7')
    const outsideCard = `<a href="${sonyUrl}">Sony WH-1000XM5 Black</a>`
    expect(mrCheapAdapter.productLinks(other + wrong + outsideCard + real + real, mrCheapAdapter.searchUrl(sony)!, sony)).toEqual([sonyUrl])
  })

  it('caps exact same-shop candidates at three and removes only known search tracking', () => {
    const cards = Array.from({ length: 5 }, (_, i) => `<div class="name"><a href="${iphoneUrl}-${i}?search=iphone&amp;utm_source=test#buy">iPhone 16 128GB Pink</a></div>`).join('')
    expect(mrCheapAdapter.productLinks(cards, mrCheapAdapter.searchUrl(iphone)!, iphone)).toEqual([0, 1, 2].map(i => `${iphoneUrl}-${i}`))
  })

  it.each(['https://other.gr/p', 'http://mrcheap.gr/p', 'https://user@mrcheap.gr/p', 'https://mrcheap.gr/index.php?route=checkout/cart'])('rejects an invalid product source %s', url => {
    expect(mrCheapAdapter.parseOffer(fixture('sony-product.html'), url, sony)).toBeNull()
  })

  it('rejects unknown destination query parameters, malformed pages and over-limit HTML', () => {
    const real = fixture('sony-search.html').replace('?search=Sony%20WH1000XM5', '?variant=other')
    expect(mrCheapAdapter.productLinks(real, mrCheapAdapter.searchUrl(sony)!, sony)).toEqual([])
    expect(mrCheapAdapter.productLinks(fixture('sony-search.html'), 'https://other.gr/search', sony)).toEqual([])
    expect(mrCheapAdapter.parseOffer('<html>Access denied</html>', sonyUrl, sony)).toBeNull()
    expect(mrCheapAdapter.parseOffer('a'.repeat(1024 * 1024 + 1), sonyUrl, sony)).toBeNull()
  })
})
