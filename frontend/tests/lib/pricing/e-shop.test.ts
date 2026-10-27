// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getProductIdentity } from '@/lib/pricing/matching'
import { eShopAdapter } from '@/lib/pricing/merchants/e-shop'

const blueUrl = 'https://www.e-shop.gr/kinito-samsung-galaxy-s25-128gb-12gb-5g-s931-blue-black-p-TEL.096612'
const silverUrl = 'https://www.e-shop.gr/kinito-samsung-galaxy-s25-128gb-12gb-5g-s931-silver-shadow-p-TEL.096175'
const blueHtml = readFileSync(new URL('./fixtures/eshop-s25-128-blueblack.html', import.meta.url), 'utf8')
const silverHtml = readFileSync(new URL('./fixtures/eshop-s25-128-silver.html', import.meta.url), 'utf8')
const searchHtml = readFileSync(new URL('./fixtures/eshop-s25-search.html', import.meta.url), 'utf8')

function identity(title = 'Samsung Galaxy S25 128GB 12GB 5G Blue Black') {
  const result = getProductIdentity({ title, description: '', mainCategory: 'Items', subCategory: 'Sell', coordinates: null })
  if (!result) throw new Error('Invalid test product identity')
  return result
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 27))
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('The merchant adapter must not perform network requests') }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('e-shop public search discovery', () => {
  it('uses the observed public search form and encoded phone category with the requested storage', () => {
    const url = new URL(eShopAdapter.searchUrl(identity())!)
    expect(url.origin).toBe('https://www.e-shop.gr')
    expect(url.pathname).toBe('/search')
    expect(url.searchParams.get('q')).toBe('samsung s25 128gb')
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.href).toContain('category=%CA%C9%CD%C7%D4%CF+%D4%C7%CB%C5%D6%D9%CD%CF')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('discovers only the exact color and capacity from captured public search anchors', () => {
    const search = eShopAdapter.searchUrl(identity())!
    expect(eShopAdapter.productLinks(searchHtml, search, identity())).toEqual([blueUrl])
    expect(eShopAdapter.productLinks(searchHtml, search, identity('Samsung Galaxy S25 128GB 12GB 5G Silver Shadow'))).toEqual([silverUrl])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects cross-origin, credentialed, insecure and non-product destinations', () => {
    const title = 'ΚΙΝΗΤΟ SAMSUNG GALAXY S25 128GB 12GB 5G S931 BLUE BLACK'
    const bad = [
      blueUrl.replace('www.e-shop.gr', 'other.example.com'),
      blueUrl.replace('https://', 'http://'),
      blueUrl.replace('https://', 'https://user:pass@'),
      blueUrl.replace('www.e-shop.gr', 'www.e-shop.gr:8443'),
      blueUrl + '?redirect=https://other.example.com',
      'https://www.e-shop.gr/search?q=Samsung',
    ]
    const html = bad.map(url => `<a href="${url}">${title}</a>`).join('') + searchHtml
    expect(eShopAdapter.productLinks(html, eShopAdapter.searchUrl(identity())!, identity())).toEqual([blueUrl])
    expect(eShopAdapter.productLinks(searchHtml, 'https://other.example.com/search', identity())).toEqual([])
  })

  it('deduplicates desktop/mobile links and caps product requests at three', () => {
    const urls = [blueUrl, ...['096613', '096614', '096615'].map(sku => blueUrl.replace('096612', sku))]
    const title = 'ΚΙΝΗΤΟ SAMSUNG GALAXY S25 128GB 12GB 5G S931 BLUE BLACK'
    const html = urls.flatMap(url => [`<a href="${url}">${title}</a>`, `<a href="${url}#photo">${title}</a>`]).join('')
    expect(eShopAdapter.productLinks(html, eShopAdapter.searchUrl(identity())!, identity())).toEqual(urls.slice(0, 3))
  })

  it('ignores accessory listings even when they include the exact phone model', () => {
    const html = `<a href="${blueUrl}">ΘΗΚΗ SAMSUNG GALAXY S25 128GB 12GB 5G S931 BLUE BLACK</a>`
    expect(eShopAdapter.productLinks(html, eShopAdapter.searchUrl(identity())!, identity())).toEqual([])
  })

  it('does not collapse unrecognized Mint and Navy variants into a listing without a color', () => {
    const noColor = identity('Samsung Galaxy S25 128GB 12GB 5G')
    expect(eShopAdapter.productLinks(searchHtml, eShopAdapter.searchUrl(noColor)!, noColor)).toEqual([])
  })
})

describe('e-shop primary product microdata', () => {
  it.each([
    ['Blue Black', blueHtml, blueUrl], ['Silver Shadow', silverHtml, silverUrl],
  ])('verifies the captured %s new offer at its current full EUR price', (color, html, url) => {
    const offer = eShopAdapter.parseOffer(html, url, identity('Samsung Galaxy S25 128GB 12GB 5G ' + color))
    expect(offer).toEqual({ shop: 'e-shop.gr', price: 599, url })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('ignores a lower historic, installment or unrelated price outside the primary offer', () => {
    const unrelated = '<div class="web-price-tax-v2">Ελάχιστη 30 ημερών 594.90 €</div>'
      + '<div>Από 49.90 € / μήνα</div><span itemprop="price">1.00</span>'
    expect(eShopAdapter.parseOffer(unrelated + blueHtml, blueUrl, identity())?.price).toBe(599)
  })

  it.each([
    'Samsung Galaxy S25 256GB 12GB 5G Blue Black',
    'Samsung Galaxy S25 128GB 8GB 5G Blue Black',
    'Samsung Galaxy S25 128GB 12GB 4G Blue Black',
    'Samsung Galaxy S25 128GB 12GB 5G Black',
    'Samsung Galaxy S25 128GB 12GB 5G Silver Shadow',
    'Samsung Galaxy S25 Plus 128GB 12GB 5G Blue Black',
    'Samsung Galaxy S24 128GB 12GB 5G Blue Black',
  ])('rejects a different requested model or variant: %s', title => {
    expect(eShopAdapter.parseOffer(blueHtml, blueUrl, identity(title))).toBeNull()
  })

  it('does not discard an unrecognized supplemental manufacturer model code', () => {
    expect(eShopAdapter.parseOffer(blueHtml.replaceAll('S931', 'S936'), blueUrl, identity())).toBeNull()
  })

  it.each(['UsedCondition', 'RefurbishedCondition', 'DamagedCondition'])('rejects explicit %s even if another new marker exists outside the product', condition => {
    const html = '<meta itemprop="itemCondition" content="http://schema.org/NewCondition">'
      + blueHtml.replace('http://schema.org/NewCondition', 'http://schema.org/' + condition)
    expect(eShopAdapter.parseOffer(html, blueUrl, identity())).toBeNull()
  })

  it('requires explicit new-condition evidence in the primary product or offer', () => {
    const html = blueHtml.replace(/<meta itemprop="itemCondition"[^>]*>/, '')
    expect(eShopAdapter.parseOffer(html, blueUrl, identity())).toBeNull()
  })

  it('rejects contradictory product-new and offer-used conditions', () => {
    const html = blueHtml.replace('<span itemprop="price">', '<meta itemprop="itemCondition" content="http://schema.org/UsedCondition"><span itemprop="price">')
    expect(eShopAdapter.parseOffer(html, blueUrl, identity())).toBeNull()
  })

  it.each(['REFURBISHED', 'OPEN BOX', 'ΜΕΤΑΧΕΙΡΙΣΜΕΝΟ', 'ΕΚΘΕΣΙΑΚΟ'])('rejects a %s title despite an explicit new schema marker', condition => {
    const html = blueHtml.replaceAll('ΚΙΝΗΤΟ SAMSUNG', condition + ' ΚΙΝΗΤΟ SAMSUNG')
    expect(eShopAdapter.parseOffer(html, blueUrl, identity())).toBeNull()
  })

  it.each(['OutOfStock', 'SoldOut', 'Discontinued', 'InStoreOnly', 'Unknown'])('rejects unavailable or unsupported availability %s', availability => {
    expect(eShopAdapter.parseOffer(blueHtml.replace('schema.org/PreOrder', 'schema.org/' + availability), blueUrl, identity())).toBeNull()
  })

  it('requires an orderable availability marker', () => {
    const html = blueHtml.replace(/<link itemprop="availability"[^>]*>/, '')
    expect(eShopAdapter.parseOffer(html, blueUrl, identity())).toBeNull()
  })

  it.each(['USD', 'GBP', ''])('rejects a primary offer without EUR currency: %s', currency => {
    const html = blueHtml.replace('content="EUR"', 'content="' + currency + '"')
    expect(eShopAdapter.parseOffer(html, blueUrl, identity())).toBeNull()
  })

  it.each(['0', '-10', 'NaN', '49.90/month', '599.00 49.90', '1,299.00'])('rejects invalid or ambiguous current price %s', price => {
    const html = blueHtml.replace('<span itemprop="price">599.00</span>', '<span itemprop="price">' + price + '</span>')
    expect(eShopAdapter.parseOffer(html, blueUrl, identity())).toBeNull()
  })

  it('rejects conflicting current prices instead of choosing the cheapest number', () => {
    const html = blueHtml.replace('<span itemprop="price">599.00</span>', '<span itemprop="price">599.00</span><span itemprop="price">49.90</span>')
    expect(eShopAdapter.parseOffer(html, blueUrl, identity())).toBeNull()
  })

  it('requires structured price to agree with the primary displayed whole price', () => {
    const html = blueHtml.replace('<span itemprop="price">599.00</span>', '<span itemprop="price">49.90</span>')
    expect(eShopAdapter.parseOffer(html, blueUrl, identity())).toBeNull()
    expect(eShopAdapter.parseOffer(blueHtml, blueUrl, identity())?.price).toBe(599)
  })

  it('does not accept a missing or contradictory primary visible price', () => {
    expect(eShopAdapter.parseOffer(blueHtml.replace('class="web-prices-v2"', 'class="web-price-tax-v2"'), blueUrl, identity())).toBeNull()
    const html = blueHtml.replace('<div class="web-prices-v2">', '<div class="web-prices-v2">49.90 €</div><div class="web-prices-v2">')
    expect(eShopAdapter.parseOffer(html, blueUrl, identity())).toBeNull()
  })

  it('ignores another visible price outside the primary heading-to-schema region', () => {
    const other = '<div class="web-prices-v2">49.90 €</div>'
    expect(eShopAdapter.parseOffer(other + blueHtml + other, blueUrl, identity())?.price).toBe(599)
  })

  it('finds the primary price within ordinary layout containers', () => {
    const html = blueHtml.replace(/<div class="web-prices-v2">[\s\S]*?<\/div>/, '<div class="layout"><div class="price-box">$&</div></div>')
    expect(eShopAdapter.parseOffer(html, blueUrl, identity())?.price).toBe(599)
  })

  it.each([
    'billingDuration', 'billingIncrement', 'unitCode', 'unitText', 'referenceQuantity',
    'eligibleQuantity', 'eligibleTransactionVolume', 'validForMemberTier', 'priceType',
  ])('rejects an offer constrained by %s despite a valid numeric EUR price', property => {
    const metadata = `<meta itemprop="${property}" content="1">`
    const html = blueHtml.replace('<span itemprop="price">', metadata + '<span itemprop="price">')
    expect(eShopAdapter.parseOffer(html, blueUrl, identity())).toBeNull()
  })

  it('finds conditional pricing inside a nested price specification', () => {
    const metadata = '<span itemprop="priceSpecification" itemscope itemtype="https://schema.org/UnitPriceSpecification">'
      + '<meta content="P1M" itemprop="billingDuration"></span>'
    const html = blueHtml.replace('<span itemprop="price">', metadata + '<span itemprop="price">')
    expect(eShopAdapter.parseOffer(html, blueUrl, identity())).toBeNull()
  })

  it('does not apply unrelated conditional-price metadata outside the primary offer', () => {
    const html = '<meta itemprop="billingDuration" content="P1M">' + blueHtml
    expect(eShopAdapter.parseOffer(html, blueUrl, identity())?.price).toBe(599)
  })

  it('rejects expired prices', () => {
    expect(eShopAdapter.parseOffer(blueHtml.replace('2026-11-26', '2026-10-26'), blueUrl, identity())).toBeNull()
  })

  it('rejects impossible or conflicting validity dates', () => {
    expect(eShopAdapter.parseOffer(blueHtml.replace('2026-11-26', '2026-11-31'), blueUrl, identity())).toBeNull()
    const html = blueHtml.replace('<meta itemprop="priceValidUntil"', '<meta itemprop="priceValidUntil" content="2026-10-26"><meta itemprop="priceValidUntil"')
    expect(eShopAdapter.parseOffer(html, blueUrl, identity())).toBeNull()
  })

  it('requires agreement between the page heading, scoped name, SKU and product URL', () => {
    expect(eShopAdapter.parseOffer(blueHtml, silverUrl, identity())).toBeNull()
    expect(eShopAdapter.parseOffer(blueHtml.replace('<span itemprop="sku">TEL.096612</span>', '<span itemprop="sku">TEL.000000</span>'), blueUrl, identity())).toBeNull()
    expect(eShopAdapter.parseOffer(blueHtml.replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/, '<h1>Other product</h1>'), blueUrl, identity())).toBeNull()
  })

  it('does not substitute another product scope or offer outside the primary product', () => {
    expect(eShopAdapter.parseOffer(blueHtml + silverHtml, blueUrl, identity())).toBeNull()
    const html = blueHtml.replace('<div itemprop="offers"', '</div><div itemprop="offers"')
    expect(eShopAdapter.parseOffer(html, blueUrl, identity())).toBeNull()
  })

  it('ignores inert script/comment copies of structured product markup', () => {
    const inert = silverHtml.replace(/<!--[\s\S]*?-->/g, '')
    const html = '<script type="text/plain">' + inert + '</script><!--' + inert + '-->' + blueHtml
    expect(eShopAdapter.parseOffer(html, blueUrl, identity())?.price).toBe(599)
  })

  it('fails closed on oversized markup', () => {
    const html = 'x'.repeat(1024 * 1024) + blueHtml
    expect(eShopAdapter.parseOffer(html, blueUrl, identity())).toBeNull()
    expect(eShopAdapter.productLinks(html, eShopAdapter.searchUrl(identity())!, identity())).toEqual([])
  })
})
