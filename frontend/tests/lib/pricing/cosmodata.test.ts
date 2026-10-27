// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cosmodataAdapter } from '@/lib/pricing/merchants/cosmodata'
import { getProductIdentity } from '@/lib/pricing/matching'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/cosmodata/${name}.html`, import.meta.url), 'utf8')
const identity = (color = 'Black') => getProductIdentity({ title: `Logitech G305 Lightspeed ${color}`, description: '', mainCategory: 'Items', subCategory: 'Sell', coordinates: null })!
const blackUrl = 'https://www.cosmodata.gr/product/340779/periferiaka/pliktrologia-pontikia/gaming-mouse/gaming-pontiki-logitech-g305-lightspeed-asirmato-black'
const whiteUrl = 'https://www.cosmodata.gr/product/345647/periferiaka/pliktrologia-pontikia/gaming-mouse/gaming-pontiki-logitech-g305-lightspeed-asirmato-white'

describe('Cosmodata isolated regular-catalogue adapter', () => {
  it('uses the observed public aq GET form and preserves encoded manufacturer-code slashes', () => {
    const url = new URL(cosmodataAdapter.searchUrl(identity())!)
    expect(url.origin).toBe('https://www.cosmodata.gr')
    expect(url.pathname).toBe('/search')
    expect(Object.fromEntries(url.searchParams)).toEqual({ aq: 'logitech g305' })
    const code = new URL(cosmodataAdapter.searchUrl({ ...identity(), model: 'philips hd9252/70' })!)
    expect(code.searchParams.get('aq')).toBe('philips hd9252/70')
  })

  it.each([
    ['Black', 'g305-product', blackUrl], ['White', 'g305-white-product', whiteUrl],
  ])('discovers the exact %s card and verifies its recorded current whole EUR price', (color, name, url) => {
    const product = identity(color)
    expect(cosmodataAdapter.productLinks(fixture('g305-search'), cosmodataAdapter.searchUrl(product)!, product)).toEqual([url])
    expect(cosmodataAdapter.parseOffer(fixture(name), url, product)).toEqual({ shop: 'Cosmodata', price: 64.9, url })
  })

  it('requires product-level manufacturer warranty and regular SKU evidence, never absence of a used label alone', () => {
    const html = fixture('g305-product')
    for (const page of [
      html.replace(/<select[\s\S]*?<\/select>/, ''),
      html.replace('Τυπική με όρους Αντιπροσωπείας', 'Εγγύηση καταστήματος'),
      html.replace('warfpw="0"', 'warfpw="10"'),
      html.replace('ΚΩΔΙΚΟΣ : 0.', 'ΚΩΔΙΚΟΣ : 1.'),
      html.replace('ΚΩΔΙΚΟΣ : 0.827.80250', 'ΚΩΔΙΚΟΣ : άγνωστος'),
    ]) expect(cosmodataAdapter.parseOffer(page, blackUrl, identity())).toBeNull()
  })

  it.each(['Refurbished', 'Open Box', 'Εκθεσιακό', 'Μεταχειρισμένο', 'Grade B', 'Ανοιχτή Συσκευασία'])('rejects conflicting %s evidence in the own product scope', condition => {
    const html = fixture('g305-product').replace('Εγγύηση: 2 έτη', `Εγγύηση: 2 έτη ${condition}`)
    expect(cosmodataAdapter.parseOffer(html, blackUrl, identity())).toBeNull()
    const box = fixture('g305-product').replace('<div class="pd_top_main_right">', `<div class="pd_top_main_right"><div>${condition}</div>`)
    expect(cosmodataAdapter.parseOffer(box, blackUrl, identity())).toBeNull()
  })

  it('ignores unrelated navigation mentioning refurbished stock, but rejects refurbished product paths', () => {
    expect(cosmodataAdapter.parseOffer('<nav>Refurbished PC / Open Box</nav>' + fixture('g305-product'), blackUrl, identity())?.price).toBe(64.9)
    expect(cosmodataAdapter.parseOffer(fixture('g305-product'), blackUrl.replace('/periferiaka/', '/refurbished/'), identity())).toBeNull()
    expect(cosmodataAdapter.parseOffer(fixture('g305-product'), blackUrl.replace('/periferiaka/', '/appliances/'), identity())).toBeNull()
  })

  it.each([
    ['id="price_current" value="64.9"', 'id="price_current" value="3.08"'],
    ['>64</span>', '>3</span>'], ['>.90€</span>', '>.08€</span>'],
    ['>.90€</span>', '>.90€ / μήνα</span>'],
    ['id="price_from" value="0"', 'id="price_from" value="1"'],
  ])('rejects contradictory, installment or from-price markup: %s', (from, to) => {
    const html = fixture('g305-product')
    expect(html).toContain(from)
    expect(cosmodataAdapter.parseOffer(html.replace(from, to), blackUrl, identity())).toBeNull()
  })

  it('uses neither store prices, installments, member offers nor unrelated product values', () => {
    const extra = '<span id="price_doseis">3,08</span><span id="price_katastima">68.00</span><span id="member_price">49.00</span>'
    expect(cosmodataAdapter.parseOffer(extra + fixture('g305-product'), blackUrl, identity())?.price).toBe(64.9)
    expect(cosmodataAdapter.parseOffer(fixture('g305-product').replace(/<span id="price_current1"[^>]*>.*?<\/span>/, ''), blackUrl, identity())).toBeNull()
  })

  it.each(['hidden', 'aria-hidden="true"', 'style="display:none"'])('rejects concealed primary price evidence: %s', attribute => {
    const html = fixture('g305-product')
    for (const page of [html.replace('id="price_current1"', `id="price_current1" ${attribute}`), html.replace('class="pd_top_main_right"', `class="pd_top_main_right" ${attribute}`)]) {
      expect(cosmodataAdapter.parseOffer(page, blackUrl, identity())).toBeNull()
    }
  })

  it.each(['ΕΞΑΝΤΛΗΜΕΝΟ', 'ΜΗ ΔΙΑΘΕΣΙΜΟ', 'Άγνωστο'])('does not quote unavailable or unrecognized availability %s', stock => {
    expect(cosmodataAdapter.parseOffer(fixture('g305-product').replace('1 ΕΩΣ 3 ΗΜΕΡΕΣ', stock), blackUrl, identity())).toBeNull()
  })

  it('requires an active product cart control, matching title, internal ID and canonical URL', () => {
    const html = fixture('g305-product')
    for (const page of [
      html.replace('id="basketnew_340779"', 'id="basketnew_340779" style="display:none"'),
      html.replace('id="basketnew_340779"', 'id="other_cart"'),
      html.replace('id="pd_idx" name="pd_idx" value="340779"', 'id="pd_idx" name="pd_idx" value="345647"'),
      html.replace(/(<div id="product_title"[^>]*>)[\s\S]*?(<\/div>)/, '$1Other product$2'),
      html.replace(/<link rel="canonical"[^>]*>/, ''),
    ]) expect(cosmodataAdapter.parseOffer(page, blackUrl, identity())).toBeNull()
    expect(cosmodataAdapter.parseOffer(html, whiteUrl, identity())).toBeNull()
    expect(cosmodataAdapter.parseOffer(html, blackUrl, identity('White'))).toBeNull()
  })

  it('requires added structured evidence to corroborate the current visible quote', () => {
    const html = fixture('g305-product')
    const structured = (price: number, condition: string) => `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Logitech G305 Lightspeed Black', offers: { price, priceCurrency: 'EUR', itemCondition: condition, url: blackUrl } })}</script>`
    expect(cosmodataAdapter.parseOffer(html + structured(64.9, 'NewCondition'), blackUrl, identity())?.price).toBe(64.9)
    expect(cosmodataAdapter.parseOffer(html + structured(3.08, 'NewCondition'), blackUrl, identity())).toBeNull()
    expect(cosmodataAdapter.parseOffer(html + structured(64.9, 'UsedCondition'), blackUrl, identity())).toBeNull()
    expect(cosmodataAdapter.parseOffer(html + '<meta itemprop="itemCondition" content="UsedCondition">', blackUrl, identity())).toBeNull()
  })

  it('does not turn category AJAX shells, foreign URLs, commented links or ambiguous cards into product links', () => {
    const search = cosmodataAdapter.searchUrl(identity())!
    const html = fixture('g305-search')
    expect(cosmodataAdapter.productLinks(html, 'https://www.cosmodata.gr/category/536/', identity())).toEqual([])
    expect(cosmodataAdapter.productLinks(html, 'https://other.gr/search', identity())).toEqual([])
    expect(cosmodataAdapter.productLinks('<!--' + html.replace(/<!--[\s\S]*?-->/g, '') + '-->', search, identity())).toEqual([])
    expect(cosmodataAdapter.productLinks(html.replaceAll('href="/product/', 'href="https://other.gr/product/'), search, identity())).toEqual([])
  })

  it('deduplicates image links and caps exact candidate pages at three', () => {
    const cards = Array.from({ length: 5 }, (_, i) => `<div class="pd_div5"><a href="${blackUrl}-${i}"></a><a href="${blackUrl}-${i}"></a><div class="pd_title">Logitech G305 Lightspeed Black</div></div>`).join('')
    expect(cosmodataAdapter.productLinks(cards, cosmodataAdapter.searchUrl(identity())!, identity())).toEqual([0, 1, 2].map(i => `${blackUrl}-${i}`))
  })

  it('fails closed on oversized, truncated, ambiguous or foreign product markup', () => {
    expect(cosmodataAdapter.parseOffer('x'.repeat(1024 * 1024 + 1), blackUrl, identity())).toBeNull()
    expect(cosmodataAdapter.parseOffer('<div class="pd_top_main_right">', blackUrl, identity())).toBeNull()
    expect(cosmodataAdapter.parseOffer(fixture('g305-product') + fixture('g305-white-product'), blackUrl, identity())).toBeNull()
    expect(cosmodataAdapter.parseOffer(fixture('g305-product'), blackUrl.replace('www.cosmodata.gr', 'other.gr'), identity())).toBeNull()
  })
})
