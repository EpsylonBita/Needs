// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getProductIdentity } from '@/lib/pricing/matching'
import { babizosAdapter } from '@/lib/pricing/merchants/babizos'

const html = readFileSync(new URL('./fixtures/babizos-hd9252.html', import.meta.url), 'utf8')
const secondHtml = readFileSync(new URL('./fixtures/babizos-hd9255.html', import.meta.url), 'utf8')
const searchHtml = readFileSync(new URL('./fixtures/babizos-search.html', import.meta.url), 'utf8')
const url = 'https://babizos.eu/Fryers/philips-hd925270-'
const secondUrl = 'https://babizos.eu/Fryers/philips-hd925560-'
function identity(title = 'Philips HD9252/70') {
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
function changeData(change: (data: Record<string, unknown>) => void) {
  return html.replace(/data-product="([^"]*)"/, (_all, encoded: string) => {
    const data = JSON.parse(encoded.replace(/&quot;/g, '"').replace(/&amp;/g, '&')); change(data)
    return 'data-product="' + JSON.stringify(data).replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"'
  })
}
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 27)); vi.stubGlobal('fetch', vi.fn()) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Βαβίζος public appliance catalogue', () => {
  it('preserves the slash-suffixed exact model in the observed public search form', () => {
    const search = new URL(babizosAdapter.searchUrl(identity())!)
    expect(search.origin).toBe('https://babizos.eu')
    expect(search.pathname).toBe('/search')
    expect(search.searchParams.get('s')).toBe('philips hd9252/70')
    expect(search.searchParams.get('controller')).toBe('search')
    expect(search.searchParams.get('search_category')).toBe('all')
    expect(babizosAdapter.productLinks(searchHtml, search.href, identity())).toEqual([url])
    expect(babizosAdapter.productLinks(searchHtml, search.href, identity('Philips HD9255/60'))).toEqual([secondUrl])
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([
    ['Philips HD9252/70', html, url, 89], ['Philips HD9255/60', secondHtml, secondUrl, 99],
  ])('verifies the real %s new offer from three agreeing price sources', (title, fixture, destination, price) => {
    expect(babizosAdapter.parseOffer(fixture, destination, identity(title))).toEqual({ shop: 'Βαβίζος', price, url: destination })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('uses explicit primary condition=new even when the visible condition label is absent', () => {
    expect(html).not.toContain('NewCondition')
    expect(babizosAdapter.parseOffer(html, url, identity())?.price).toBe(89)
    expect(babizosAdapter.parseOffer(changeData(data => { delete data.condition }), url, identity())).toBeNull()
  })
  it.each(['Philips HD9252/90', 'Philips HD9255/60', 'Philips HD9252', 'Philips HD9252/70 White'])('rejects another model suffix or unconfirmed variant: %s', title => {
    expect(babizosAdapter.parseOffer(html, url, identity(title))).toBeNull()
  })
  it('ignores shipping-day and product-weight units without treating them as installment price units', () => {
    expect(html).toContain('"unitCode":"DAY"')
    expect(html).toContain('"unitCode":"kg"')
    expect(babizosAdapter.parseOffer(html, url, identity())?.price).toBe(89)
    expect(babizosAdapter.parseOffer(changeProduct(product => { product.offers.priceSpecification = { unitCode: 'MON' } }), url, identity())).toBeNull()
  })
  it('rejects contradictory new condition or price evidence', () => {
    expect(babizosAdapter.parseOffer(changeData(data => { data.condition = 'refurbished' }), url, identity())).toBeNull()
    expect(babizosAdapter.parseOffer(changeProduct(product => { product.itemCondition = 'https://schema.org/UsedCondition' }), url, identity())).toBeNull()
    expect(babizosAdapter.parseOffer(changeProduct(product => { product.offers.price = '8.90' }), url, identity())).toBeNull()
    expect(babizosAdapter.parseOffer(changeData(data => { data.price_amount = 8.9 }), url, identity())).toBeNull()
  })
  it('does not use sale-list, related-product or monthly prices outside the primary product', () => {
    const unrelated = '<span class="current-price-value" content="8.90">8,90 €</span>'
    expect(babizosAdapter.parseOffer(unrelated + html + unrelated, url, identity())?.price).toBe(89)
  })
  it.each(['hidden', 'aria-hidden="true"', 'style="display:none"'])('rejects an explicitly hidden appliance price: %s', hidden => {
    const fixture = html.replace("<span class='current-price-value'", "<span " + hidden + " class='current-price-value'")
    expect(babizosAdapter.parseOffer(fixture, url, identity())).toBeNull()
  })
  it.each(['hidden', 'aria-hidden="true"', 'style="display:none"'])('rejects a hidden wrapper around the appliance price: %s', hidden => {
    const fixture = html.replace('<span class="price-inner"', '<span ' + hidden + ' class="price-inner"')
    expect(babizosAdapter.parseOffer(fixture, url, identity())).toBeNull()
  })
  it('rejects other hosts, URL-changing queries and mismatched embedded product IDs', () => {
    expect(babizosAdapter.parseOffer(html, 'https://www.skroutz.gr/Fryers/philips-hd925270-', identity())).toBeNull()
    expect(babizosAdapter.parseOffer(html, url + '?id_product=64932', identity())).toBeNull()
    expect(babizosAdapter.parseOffer(changeData(data => { data.id = 64932 }), url, identity())).toBeNull()
    expect(babizosAdapter.productLinks(searchHtml, 'https://other.example.com/search', identity())).toEqual([])
  })
  it('fails closed for an invalid or expired validity date', () => {
    expect(babizosAdapter.parseOffer(changeProduct(product => { product.offers.priceValidUntil = '2026-02-31' }), url, identity())).toBeNull()
    expect(babizosAdapter.parseOffer(changeProduct(product => { product.offers.priceValidUntil = '2026-10-26' }), url, identity())).toBeNull()
  })
})
