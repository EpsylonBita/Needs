// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getProductIdentity } from '@/lib/pricing/matching'
import { mpakasDiyAdapter } from '@/lib/pricing/merchants/mpakas-diy'

const html = readFileSync(new URL('./fixtures/mpakas-dhp484z.html', import.meta.url), 'utf8')
const secondHtml = readFileSync(new URL('./fixtures/mpakas-dhp482z.html', import.meta.url), 'utf8')
const searchHtml = readFileSync(new URL('./fixtures/mpakas-search.html', import.meta.url), 'utf8')
const url = 'https://eshop.mpakasdiy.com/el/-/85--dhp484rme-makita.html'
const secondUrl = 'https://eshop.mpakasdiy.com/el/-/86--dhp482z-makita.html'
const fullTitle = 'MAKITA DHP484Z Brushless Κρουστικό Δραπ/σάβιδο μπαταρίας 18V LXT χωρίς κάρβουνα (χωρίς μπαταρία και φορτιστή) σε χαρτόκουτο'
function identity(title = 'Makita DHP484Z') {
  const value = getProductIdentity({ title, description: '', mainCategory: 'Items', subCategory: 'Sell', coordinates: null })
  if (!value) throw new Error('Unrecognized test identity: ' + title)
  return value
}
type ProductFixture = Record<string, unknown> & { offers: Record<string, unknown> }
function changeProduct(change: (product: ProductFixture) => void, input = html) {
  return input.replace(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/, (_all, start, json, end) => {
    const product = JSON.parse(json); change(product); return start + JSON.stringify(product) + end
  })
}
function changeData(change: (data: Record<string, unknown>) => void, input = html) {
  return input.replace(/data-product="([^"]*)"/, (_all, encoded: string) => {
    const data = JSON.parse(encoded.replace(/&quot;/g, '"').replace(/&amp;/g, '&'))
    change(data)
    return 'data-product="' + JSON.stringify(data).replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"'
  })
}
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 27)); vi.stubGlobal('fetch', vi.fn()) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('MPAKAS DIY public catalogue', () => {
  it('recognizes the real full tool title including voltage and explicitly excluded charger', () => {
    expect(identity(fullTitle).model).toBe('makita dhp484z')
    expect(identity(fullTitle).variantTokens).toEqual(identity().variantTokens)
  })
  it('uses the observed free public form and discovers both exact bare-tool models', () => {
    const search = new URL(mpakasDiyAdapter.searchUrl(identity())!)
    expect(search.origin).toBe('https://eshop.mpakasdiy.com')
    expect(decodeURIComponent(search.pathname)).toBe('/el/αναζήτηση')
    expect([...search.searchParams]).toEqual([['controller', 'search'], ['s', 'makita dhp484z']])
    expect(mpakasDiyAdapter.productLinks(searchHtml, search.href, identity())).toEqual([url])
    expect(mpakasDiyAdapter.productLinks(searchHtml, search.href, identity('Makita DHP482Z'))).toEqual([secondUrl])
    expect(fetch).not.toHaveBeenCalled()
  })
  it('deduplicates discovery and caps accepted product destinations at three', () => {
    const urls = [url, ...[86, 87, 88].map(id => url.replace('/85-', '/' + id + '-'))]
    const anchors = urls.flatMap(destination => [`<a href="${destination}">${fullTitle}</a>`, `<a href="${destination}#details">${fullTitle}</a>`]).join('')
    expect(mpakasDiyAdapter.productLinks(anchors, mpakasDiyAdapter.searchUrl(identity())!, identity())).toEqual(urls.slice(0, 3))
  })
  it('rejects another search route and ignores inert discovery anchors', () => {
    const fake = '<script><a href="' + url + '">' + fullTitle + '</a></script>'
    expect(mpakasDiyAdapter.productLinks(fake, mpakasDiyAdapter.searchUrl(identity())!, identity())).toEqual([])
    expect(mpakasDiyAdapter.productLinks(searchHtml, 'https://eshop.mpakasdiy.com/el/αναζήτηση?controller=cart', identity())).toEqual([])
  })
  it.each([
    ['Makita DHP484Z', html, url, 197], ['Makita DHP482Z', secondHtml, secondUrl, 130.49],
  ])('verifies the real new %s offer using agreeing primary price evidence', (title, fixture, destination, price) => {
    expect(mpakasDiyAdapter.parseOffer(fixture, destination, identity(title))).toEqual({ shop: 'MPAKAS DIY', price, url: destination })
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['Makita DHP484RFE', 'Makita DHP484', 'Makita DHP482Z', 'DeWalt DCD796D2'])('rejects another model or battery-kit SKU: %s', title => {
    expect(mpakasDiyAdapter.parseOffer(html, url, identity(title))).toBeNull()
  })
  it.each(['http://eshop.mpakasdiy.com/el/-/85--dhp484rme-makita.html', 'https://evil.example.com/el/-/85--dhp484rme-makita.html', url + '?redirect=https://example.com'])('rejects unsafe or foreign product destinations: %s', destination => {
    expect(mpakasDiyAdapter.parseOffer(html, destination, identity())).toBeNull()
  })
  it('does not borrow an unrelated price, condition or product title', () => {
    const other = '<div><span class="price" content="1">1,00 €</span><h2>Makita DHP482Z</h2></div>'
    expect(mpakasDiyAdapter.parseOffer(other + html + other, url, identity())?.price).toBe(197)
    expect(mpakasDiyAdapter.parseOffer(changeProduct(product => { product.name = 'Makita DHP482Z' }), url, identity())).toBeNull()
  })
  it.each(['used', 'refurbished', '', undefined])('requires primary product condition=new, rejecting %s', condition => {
    expect(mpakasDiyAdapter.parseOffer(changeData(data => { data.condition = condition }), url, identity())).toBeNull()
  })
  it('rejects a structured used condition contradicting primary condition=new', () => {
    expect(mpakasDiyAdapter.parseOffer(changeProduct(product => { product.offers.itemCondition = 'https://schema.org/UsedCondition' }), url, identity())).toBeNull()
    expect(mpakasDiyAdapter.parseOffer(changeProduct(product => { product.itemCondition = 'RefurbishedCondition' }), url, identity())).toBeNull()
  })
  it.each([
    ['available_for_order', '0'], ['show_price', '0'], ['availability', 'unavailable'],
    ['id_product_attribute', 1], ['minimal_quantity', 2], ['reference', 'other-sku'], ['id_product', 86],
  ])('rejects inconsistent primary product metadata: %s', (field, value) => {
    expect(mpakasDiyAdapter.parseOffer(changeData(data => { data[field] = value }), url, identity())).toBeNull()
  })
  it('requires agreement among visible, embedded and structured prices', () => {
    expect(mpakasDiyAdapter.parseOffer(changeProduct(product => { product.offers.price = '19.70' }), url, identity())).toBeNull()
    expect(mpakasDiyAdapter.parseOffer(changeData(data => { data.price_amount = 19.7 }), url, identity())).toBeNull()
    expect(mpakasDiyAdapter.parseOffer(changeData(data => { data.price = '19,70 €' }), url, identity())).toBeNull()
    expect(mpakasDiyAdapter.parseOffer(html.replace('content="197">197,00', 'content="197">19,70'), url, identity())).toBeNull()
  })
  it.each(['hidden', 'hidden="false"', 'aria-hidden="true"', 'aria-hidden=true', 'style="display: none !important"', 'style="visibility:hidden"', 'style="opacity:0"'])('rejects an explicitly hidden current price: %s', hidden => {
    const fixture = html.replace('<span class="price"', '<span ' + hidden + ' class="price"')
    expect(mpakasDiyAdapter.parseOffer(fixture, url, identity())).toBeNull()
  })
  it.each(['hidden', 'aria-hidden="true"', 'style="display:none"'])('rejects a hidden current-price ancestor: %s', hidden => {
    const fixture = html.replace('<div class="current-price"', '<div ' + hidden + ' class="current-price"')
    expect(mpakasDiyAdapter.parseOffer(fixture, url, identity())).toBeNull()
  })
  it('checks hidden ancestors that begin before the primary heading', () => {
    expect(mpakasDiyAdapter.parseOffer('<main hidden>' + html + '</main>', url, identity())).toBeNull()
  })
  it('does not mistake hidden form metadata or an unrelated hidden sibling for a hidden price', () => {
    const unrelated = '<div hidden><span>Other content</span></div><input type="hidden" value="other">'
    expect(mpakasDiyAdapter.parseOffer(unrelated + html, url, identity())?.price).toBe(197)
    expect(mpakasDiyAdapter.parseOffer(html.replace('<span class="price"', '<span aria-hidden="false" class="price"'), url, identity())?.price).toBe(197)
  })
  it.each(['billingDuration', 'billingIncrement', 'unitCode', 'unitText', 'referenceQuantity', 'eligibleQuantity', 'eligibleTransactionVolume', 'validForMemberTier', 'priceType'])('rejects conditional-price metadata %s', key => {
    const fixture = changeProduct(product => { product.offers[key] = 'restricted' })
    expect(mpakasDiyAdapter.parseOffer(fixture, url, identity())).toBeNull()
  })
  it('rejects nested installment pricing and currency substitution', () => {
    expect(mpakasDiyAdapter.parseOffer(changeProduct(product => { product.offers.priceSpecification = { billingDuration: 'P1M' } }), url, identity())).toBeNull()
    expect(mpakasDiyAdapter.parseOffer(changeProduct(product => { product.offers.priceCurrency = 'USD' }), url, identity())).toBeNull()
  })
  it.each(['OutOfStock', 'Discontinued', 'InStoreOnly'])('rejects unavailable stock %s', stock => {
    expect(mpakasDiyAdapter.parseOffer(changeProduct(product => { product.offers.availability = 'https://schema.org/' + stock }), url, identity())).toBeNull()
  })
  it('rejects expired prices and mismatched canonical/offer URLs', () => {
    expect(mpakasDiyAdapter.parseOffer(changeProduct(product => { product.offers.priceValidUntil = '2026-10-26' }), url, identity())).toBeNull()
    expect(mpakasDiyAdapter.parseOffer(changeProduct(product => { product.offers.url = secondUrl }), url, identity())).toBeNull()
    expect(mpakasDiyAdapter.parseOffer(html.replace('<link rel="canonical" href="' + url, '<link rel="canonical" href="' + secondUrl), url, identity())).toBeNull()
  })
  it('rejects multiple primary product scopes and oversized UTF-8 responses', () => {
    expect(mpakasDiyAdapter.parseOffer(html + secondHtml, url, identity())).toBeNull()
    expect(mpakasDiyAdapter.parseOffer('€'.repeat(360000) + html, url, identity())).toBeNull()
    expect(mpakasDiyAdapter.productLinks('€'.repeat(360000), mpakasDiyAdapter.searchUrl(identity())!, identity())).toEqual([])
  })
})
