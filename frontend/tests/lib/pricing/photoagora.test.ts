// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getProductIdentity } from '@/lib/pricing/matching'
import { photoagoraAdapter as adapter } from '@/lib/pricing/merchants/photoagora'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), 'utf8')
const r5Html = fixture('photoagora-r5'), r6Html = fixture('photoagora-r6ii')
const identity = (title: string) => getProductIdentity({ title, description: 'Used', mainCategory: 'Items', subCategory: 'Sell', coordinates: null })!
const r5 = identity('Canon EOS R5 Black'), r6 = identity('Canon EOS R6 Mark II Black')
const url5 = 'https://www.photoagora.gr/fwtografia/mirrorless-cameras/canon-eos-r5-body.html'
const url6 = 'https://www.photoagora.gr/fwtografia/mirrorless-cameras/canon-eos-r6-mark-ii-mirrorless-camera.html'

describe('Photoagora public body-only camera catalogue', () => {
  it('uses the observed anonymous search with enough results to pass accessory matches', () => {
    const url = new URL(adapter.searchUrl(r6)!)
    expect(Object.fromEntries(url.searchParams)).toEqual({ dispatch: 'products.search', search_performed: 'Y', q: 'canon r6', match: 'all', pname: 'Y', items_per_page: '96' })
  })

  it('discovers two exact bodies, excluding kits, accessories, revisions and R5 C', () => {
    expect(adapter.productLinks(fixture('photoagora-search-canon-r5-all'), adapter.searchUrl(r5)!, r5)).toEqual([url5])
    expect(adapter.productLinks(fixture('photoagora-search-canon-r6'), adapter.searchUrl(r6)!, r6)).toEqual([url6])
  })

  it('reads actual primary retail EUR prices and the product color feature', () => {
    expect(adapter.parseOffer(r5Html, url5, r5)).toEqual({ shop: 'Photoagora', price: 2799, url: url5 })
    expect(adapter.parseOffer(r6Html, url6, r6)).toEqual({ shop: 'Photoagora', price: 2299, url: url6 })
    expect(adapter.parseOffer(r5Html, url5, identity('Canon EOS R5 White'))).toBeNull()
    expect(adapter.parseOffer(r6Html, url6, identity('Canon EOS R6 Mark III Black'))).toBeNull()
  })

  it('rejects actual backorder R7 and exhausted R5 Mark II pages', () => {
    expect(adapter.parseOffer(fixture('photoagora-r7'), 'https://www.photoagora.gr/fwtografia/mirrorless-cameras/canon-eos-r7-mirrorless-camera-el.html', identity('Canon EOS R7 Black'))).toBeNull()
    expect(adapter.parseOffer(fixture('photoagora-r5ii'), 'https://www.photoagora.gr/fwtografia/mirrorless-cameras/canon-eos-r5-mark-ii-mirrorless-camera.html', identity('Canon EOS R5 Mark II Black'))).toBeNull()
  })

  it('requires primary body-only and Greek-distributor warranty evidence', () => {
    for (const html of [r5Html.replace('Body Only', 'Kit (Body & Lens)'), r5Html.replace('Ελληνική Αντιπροσωπεία', 'Other'), r5Html.replaceAll('24 Μήνες', '12 Μήνες')]) {
      expect(adapter.parseOffer(html, url5, r5)).toBeNull()
    }
    expect(adapter.parseOffer(r5Html.replace('Canon EOS R5 Body', 'Canon EOS R5 Body Open Box'), url5, r5)).toBeNull()
    expect(adapter.parseOffer(r5Html.replace('Canon EOS R5 Body', 'Canon EOS R5 C Body'), url5, r5)).toBeNull()
  })

  it('lets a primary used/open-box badge override standard-stock inference', () => {
    for (const badge of ['Open Box', 'Used', 'Μεταχειρισμένο', 'Εκθεσιακό']) {
      expect(adapter.parseOffer(r5Html.replace('</h1>', `</h1><span class="stock-condition">${badge}</span>`), url5, r5)).toBeNull()
    }
    expect(adapter.parseOffer('<aside>Related Open Box camera</aside>' + r5Html, url5, r5)?.price).toBe(2799)
  })

  it('allows absent condition or consistent primary structured evidence, and rejects explicit contradictions', () => {
    const product = { '@type': 'Product', name: 'Canon EOS R5 Body', color: 'Black', url: url5, offers: { '@type': 'Offer', price: 2799, priceCurrency: 'EUR', availability: 'https://schema.org/InStock' } }
    const page = (value: unknown) => r5Html + `<script type="application/ld+json">${JSON.stringify(value)}</script>`
    expect(adapter.parseOffer(page(product), url5, r5)?.price).toBe(2799)
    expect(adapter.parseOffer(page({ ...product, itemCondition: 'https://schema.org/NewCondition' }), url5, r5)?.price).toBe(2799)
    for (const bad of [
      { ...product, itemCondition: 'https://schema.org/UsedCondition' },
      { ...product, itemCondition: { '@id': 'https://schema.org/RefurbishedCondition' } },
      { ...product, color: 'White' },
      { ...product, availability: 'https://schema.org/OutOfStock' },
      { ...product, offers: { ...product.offers, name: 'Used Canon EOS R5' } },
      { ...product, offers: { ...product.offers, itemCondition: 'UsedCondition' } },
      { ...product, offers: { ...product.offers, price: 27.99 } },
      { ...product, offers: { ...product.offers, priceCurrency: 'USD' } },
      { ...product, offers: { ...product.offers, availability: 'https://schema.org/BackOrder' } },
      { ...product, offers: { ...product.offers, priceSpecification: { price: 27.99, billingDuration: 'P1M' } } },
    ]) expect(adapter.parseOffer(page(bad), url5, r5)).toBeNull()
    const unrelated = { ...product, url: url6, name: 'Canon EOS R6 Mark II Body', itemCondition: 'UsedCondition' }
    expect(adapter.parseOffer(page({ '@graph': [product, unrelated] }), url5, r5)?.price).toBe(2799)
    expect(adapter.parseOffer(page({ '@graph': [{ '@type': 'WebPage', mainEntity: { ...product, itemCondition: 'UsedCondition' } }] }), url5, r5)).toBeNull()
  })

  it('does not use monthly/list/related prices or a stock indicator belonging to another item', () => {
    const other = '<div><span id="sec_discounted_price_888">99.00</span><span>12 x €99.00</span></div>'
    expect(adapter.parseOffer(other + r5Html, url5, r5)?.price).toBe(2799)
    expect(adapter.parseOffer(r5Html.replace('ty-product-block__price-actual', 'monthly-price') + other, url5, r5)).toBeNull()
    expect(adapter.parseOffer(r5Html.replace('2,799.00', '12 x 99.00'), url5, r5)).toBeNull()
    expect(adapter.parseOffer(r5Html.replace('product_amount_update_10642', 'product_amount_update_888'), url5, r5)).toBeNull()
    expect(adapter.parseOffer(r5Html.replace('class="ty-product-block__price-actual"', 'class="ty-product-block__price-actual" hidden'), url5, r5)).toBeNull()
  })

  it.each(['billingDuration', 'billingIncrement', 'unitCode', 'unitText', 'referenceQuantity', 'eligibleQuantity', 'eligibleTransactionVolume', 'validForMemberTier', 'priceType'])('rejects conditional %s in the primary price', key => {
    const html = r5Html.replace('class="ty-product-block__price-actual">', `class="ty-product-block__price-actual"><meta itemprop="${key}" content="conditional">`)
    expect(adapter.parseOffer(html, url5, r5)).toBeNull()
  })

  it('rejects malformed EUR, conflicting conditions, ambiguous products and unsafe URLs', () => {
    for (const html of [r5Html.replace('€', '$'), r5Html.replace('2,799.00', '2,79.00'), r5Html + r5Html, r5Html.replace('Canon EOS R5 Body', 'Canon EOS R5 Body</bdi><meta itemprop="itemCondition" content="UsedCondition"><bdi>')]) {
      expect(adapter.parseOffer(html, url5, r5)).toBeNull()
    }
    expect(adapter.parseOffer(r5Html, url6, r5)).toBeNull()
    expect(adapter.parseOffer(r5Html, url5.replace('www.photoagora.gr', 'evil.example'), r5)).toBeNull()
    expect(adapter.parseOffer('x'.repeat(1024 * 1024 + 1), url5, r5)).toBeNull()
    const search = fixture('photoagora-search-canon-r5-all').replaceAll('https://www.photoagora.gr/', 'https://evil.example/')
    expect(adapter.productLinks(search, adapter.searchUrl(r5)!, r5)).toEqual([])
  })
})
