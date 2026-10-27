// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getProductIdentity } from '@/lib/pricing/matching'
import { sonyCentersAdapter } from '@/lib/pricing/merchants/sony-centers'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), 'utf8')
const xm5 = fixture('sonycenters-xm5-black'), xm4 = fixture('sonycenters-xm4-black')
const identity = (title: string) => getProductIdentity({ title, description: 'Used headphones.', mainCategory: 'Items', subCategory: 'Sell', coordinates: null })!
const black = identity('Sony WH-1000XM5 Black'), revision = identity('Sony WH-1000XM4C Black')
const url5 = 'https://sonycenters.gr/ixos/akoystika/akoystika-kefalis/sony-wh-1000xm5b-asyrmata-akoystika-eksoydeterosis-thoryboy-mayro/'
const url4 = 'https://sonycenters.gr/ixos/akoystika/akoystika-kefalis/sony-wh-1000xm4c-noise-cancelling-asyrmata-over-ear-akoystika-black/'

describe('Sony Center public catalogue adapter', () => {
  it('uses the observed anonymous GET form and searches the model without descriptive keywords', () => {
    const url = new URL(sonyCentersAdapter.searchUrl(black)!)
    expect(url.origin).toBe('https://sonycenters.gr')
    expect(Object.fromEntries(url.searchParams)).toEqual({ dispatch: 'products.search', search_performed: 'Y', q: 'WH-1000xm5', pname: 'Y', pcode_from_q: 'Y' })
    expect(sonyCentersAdapter.searchUrl(identity('iPhone 16 128GB Black'))).toBeNull()
  })

  it('selects exact product links from real search results and retains the XM4C revision', () => {
    expect(sonyCentersAdapter.productLinks(fixture('sonycenters-search-xm5'), sonyCentersAdapter.searchUrl(black)!, black)).toEqual([url5])
    expect(sonyCentersAdapter.productLinks(fixture('sonycenters-search-xm4'), sonyCentersAdapter.searchUrl(revision)!, revision)).toEqual([url4])
    expect(sonyCentersAdapter.productLinks(fixture('sonycenters-search-xm4'), sonyCentersAdapter.searchUrl(black)!, identity('Sony WH-1000XM4 Black'))).toEqual([])
  })

  it('reads the actual whole-item EUR offers from two captured product pages', () => {
    expect(sonyCentersAdapter.parseOffer(xm5, url5, black)).toEqual({ shop: 'Sony Center', price: 299, url: url5 })
    expect(sonyCentersAdapter.parseOffer(xm4, url4, revision)).toEqual({ shop: 'Sony Center', price: 259, url: url4 })
    expect(sonyCentersAdapter.parseOffer(xm4, url4, identity('Sony WH-1000XM4 Black'))).toBeNull()
    expect(sonyCentersAdapter.parseOffer(xm5, url5, identity('Sony WH-1000XM5 Silver'))).toBeNull()
  })

  it('does not borrow monthly prices, list prices or recommendations', () => {
    const unrelated = '<section><span itemprop="price" content="8.72">8,72 / μήνα</span><span itemprop="price" content="419">Προτ. Λιαν.</span></section>'
    expect(sonyCentersAdapter.parseOffer(unrelated + xm5, url5, black)?.price).toBe(299)
    expect(sonyCentersAdapter.parseOffer(xm5.replace('sec_discounted_price_bigpicture_2231', 'monthly_installment_2231'), url5, black)).toBeNull()
    expect(sonyCentersAdapter.parseOffer(xm5.replace('WH-1000XM5B', 'WH-1000XM4C') + '<h1>Sony WH-1000XM5 Black</h1>', url5, black)).toBeNull()
    expect(sonyCentersAdapter.parseOffer(xm5.replace('<span itemprop="shippingDetails"', '<span itemprop="price" content="8.72"></span><span itemprop="shippingDetails"'), url5, black)).toBeNull()
  })

  it.each(['billingDuration', 'billingIncrement', 'unitCode', 'unitText', 'referenceQuantity', 'eligibleQuantity', 'eligibleTransactionVolume', 'validForMemberTier', 'priceType'])('rejects conditional %s on the Offer or inside its price specification', property => {
    const metadata = `<meta itemprop="${property}" content="conditional">`
    for (const addition of [metadata, `<span itemprop="priceSpecification" itemscope itemtype="https://schema.org/UnitPriceSpecification"><span itemscope itemtype="https://schema.org/QuantitativeValue">${metadata}</span></span>`]) {
      const html = xm5.replace('<span itemprop="shippingDetails"', `${addition}<span itemprop="shippingDetails"`)
      expect(sonyCentersAdapter.parseOffer(html, url5, black)).toBeNull()
    }
  })

  it('keeps shipping transit units separate from item-price conditions', () => {
    expect(xm5).toContain('itemprop="unitCode" content="d"')
    expect(sonyCentersAdapter.parseOffer(xm5, url5, black)?.price).toBe(299)
  })

  it('requires structured and visible primary prices to agree including Greek punctuation', () => {
    expect(sonyCentersAdapter.parseOffer(xm5.replace('content="299.00"', 'content="29.90"'), url5, black)).toBeNull()
    const thousands = xm5.replace('content="299.00"', 'content="1299.90"').replace('>299,00</span>', '>1.299,90</span>')
    expect(sonyCentersAdapter.parseOffer(thousands, url5, black)?.price).toBe(1299.9)
    expect(sonyCentersAdapter.parseOffer(xm5.replace('>299,00</span>', '>29,90</span>'), url5, black)).toBeNull()
  })

  it.each([
    ['factory-warranty assertion missing', (html: string) => html.replace('Εργοστασιακή εγγύηση Sony', '')],
    ['used', (html: string) => html.replace('WH-1000XM5B', 'WH-1000XM5B Μεταχειρισμένο')],
    ['open box', (html: string) => html.replace('WH-1000XM5B', 'WH-1000XM5B Open Box')],
    ['outlet', (html: string) => html.replace('WH-1000XM5B', 'WH-1000XM5B Outlet')],
    ['wrong currency', (html: string) => html.replace('content="EUR"', 'content="USD"')],
    ['unavailable', (html: string) => html.replace('schema.org/InStock', 'schema.org/OutOfStock')],
    ['invalid amount', (html: string) => html.replace('content="299.00"', 'content="0"')],
    ['missing machine price', (html: string) => html.replace('content="299.00"', '')],
    ['contradictory explicit condition', (html: string) => html.replace('<h1', '<meta itemprop="itemCondition" content="https://schema.org/UsedCondition"><h1')],
  ])('fails neutral for %s', (_name, change) => {
    expect(sonyCentersAdapter.parseOffer(change(xm5), url5, black)).toBeNull()
  })

  it('requires the real store, canonical product destination, and exactly one primary Product', () => {
    expect(sonyCentersAdapter.parseOffer(xm5, 'https://attacker.gr/product', black)).toBeNull()
    expect(sonyCentersAdapter.parseOffer(xm5, url4, black)).toBeNull()
    expect(sonyCentersAdapter.parseOffer(xm5.replace(url5, 'https://other.gr/product'), url5, black)).toBeNull()
    expect(sonyCentersAdapter.parseOffer(xm5.replace('<div class="ut2-pb', '<div itemscope itemtype="http://schema.org/Product"></div><div class="ut2-pb'), url5, black)).toBeNull()
    expect(sonyCentersAdapter.parseOffer('x'.repeat(1024 * 1024) + xm5, url5, black)).toBeNull()
  })

  it('never returns off-domain or non-product search links', () => {
    const search = fixture('sonycenters-search-xm5')
    expect(sonyCentersAdapter.productLinks(search.replaceAll('https://sonycenters.gr/', 'https://other.gr/'), sonyCentersAdapter.searchUrl(black)!, black)).toEqual([])
    expect(sonyCentersAdapter.productLinks(search.replaceAll('class="product-title"', 'class="related"'), sonyCentersAdapter.searchUrl(black)!, black)).toEqual([])
  })
})
