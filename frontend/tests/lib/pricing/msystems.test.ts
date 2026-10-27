// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mSystemsAdapter } from '@/lib/pricing/merchants/msystems'
import { getProductIdentity } from '@/lib/pricing/matching'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/msystems/${name}.html`, import.meta.url), 'utf8')
const identity = (title: string) => {
  const value = getProductIdentity({ title, description: '', mainCategory: 'Items', subCategory: 'Sell', coordinates: null })
  if (!value) throw new Error(`Unrecognized test identity: ${title}`)
  return value
}
const mouseTitle = 'Logitech G305 Lightspeed Wireless Black'
const storageTitle = 'Kingston 1TB NV3 NVMe M.2 PCIe 4.0 SSD'
const mouseUrl = 'https://www.msystems.gr/gaming-mice/logitech-g305-lightspeed-wireless-gaming-mouse-black-910-005283'
const storageUrl = 'https://www.msystems.gr/ssd/kingston-1tb-nv3-nvme-m-2-pcie-4-0-ssd-snv3s-1000g'

describe('Msystems public retailer adapter', () => {
  it('uses the observed anonymous GET search form without private listing prose', () => {
    const url = new URL(mSystemsAdapter.searchUrl(identity(mouseTitle))!)
    expect(url.origin).toBe('https://www.msystems.gr')
    expect(url.pathname).toBe('/search/')
    expect([...url.searchParams.keys()]).toEqual(['keywords'])
    expect(url.searchParams.get('keywords')).toBe(identity(mouseTitle).model)
  })

  it.each([
    ['g305', mouseTitle, mouseUrl, 42.5], ['nv3', storageTitle, storageUrl, 212.9],
  ] as const)('discovers and verifies the live-recorded %s whole EUR offer', (name, title, url, price) => {
    const product = identity(title)
    expect(mSystemsAdapter.productLinks(fixture(`${name}-search`), mSystemsAdapter.searchUrl(product)!, product)).toEqual([url])
    expect(mSystemsAdapter.parseOffer(fixture(`${name}-product`), url, product)).toEqual({ shop: 'Msystems', price, url })
  })

  it('does not merge storage capacities or the distinct 2230 form factor', () => {
    const html = fixture('nv3-product')
    expect(mSystemsAdapter.parseOffer(html, storageUrl, identity('Kingston 2TB NV3 NVMe M.2 PCIe 4.0 SSD'))).toBeNull()
    expect(mSystemsAdapter.parseOffer(html, storageUrl, identity('Kingston 1TB NV3 NVMe M.2 2230 PCIe 4.0 SSD'))).toBeNull()
    expect(mSystemsAdapter.parseOffer(fixture('g305-product'), mouseUrl, identity('Logitech G305 Lightspeed Wireless White'))).toBeNull()
  })

  it.each([
    ['NewCondition', 'UsedCondition'], ['NewCondition', 'RefurbishedCondition'],
    ['InStock', 'OutOfStock'], ['"EUR"', '"USD"'],
    ['"212.90"', '"106.45"'], ['212,90 €', '106,45 €'],
    ['212,90 €', '106,45 € / μήνα'],
  ])('fails neutral for contradictory or unsupported evidence %s → %s', (from, to) => {
    expect(mSystemsAdapter.parseOffer(fixture('nv3-product').replaceAll(from, to), storageUrl, identity(storageTitle))).toBeNull()
  })

  it('requires explicit condition, stock, main visible price, matching heading and canonical URL', () => {
    const html = fixture('nv3-product')
    const variants = [
      html.replace(/"itemCondition":\s*"[^"]+",?/, ''),
      html.replace(/"availability":\s*"[^"]+",?/, ''),
      html.replace(/<span class="h3 fw-normal me-1">.*?<\/span>/, ''),
      html.replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/, '<h1>Other product</h1>'),
      html.replace(/<link rel="canonical"[^>]*>/, ''),
      html.replace(/(<link rel="canonical" href=")[^"]+/, '$1https://www.msystems.gr/ssd/other-product'),
    ]
    for (const page of variants) expect(mSystemsAdapter.parseOffer(page, storageUrl, identity(storageTitle))).toBeNull()
  })

  it.each(['billingDuration', 'unitCode', 'validForMemberTier', 'eligibleQuantity'])('rejects a conditional quote marked %s', field => {
    const html = fixture('nv3-product').replace('"price": "212.90"', `"price": "212.90", "${field}": "conditional"`)
    expect(mSystemsAdapter.parseOffer(html, storageUrl, identity(storageTitle))).toBeNull()
  })

  it('requires an enabled main add-to-cart control even if stale schema says available', () => {
    const html = fixture('nv3-product')
    for (const page of [html.replace('id="prd_addtocart"', 'id="prd_addtocart" disabled'), html.replace(/<button[\s\S]*?<\/button>/, '')]) {
      expect(mSystemsAdapter.parseOffer(page, storageUrl, identity(storageTitle))).toBeNull()
    }
  })

  it('does not choose lower installment, net-of-VAT or unrelated recommendation amounts', () => {
    const others = '<div class="product-price">10,00 €</div><span class="text-muted">Χωρίς ΦΠΑ: 171,69 €</span><span class="doseis2-price">106,45</span>'
    expect(mSystemsAdapter.parseOffer(others + fixture('nv3-product'), storageUrl, identity(storageTitle))?.price).toBe(212.9)
    expect(mSystemsAdapter.parseOffer(fixture('nv3-product') + fixture('g305-product'), storageUrl, identity(storageTitle))).toBeNull()
  })

  it.each(['hidden', 'aria-hidden="true"', 'style="display:none"'])('requires an actually exposed current-price element: %s', attribute => {
    const html = fixture('nv3-product').replace('class="h3 fw-normal me-1"', `class="h3 fw-normal me-1" ${attribute}`)
    expect(mSystemsAdapter.parseOffer(html, storageUrl, identity(storageTitle))).toBeNull()
  })

  it('rejects external, credentialed, query-bearing and non-product URLs', () => {
    for (const url of ['http://www.msystems.gr/ssd/example', 'https://www.msystems.gr/page/returns', 'https://other.gr/ssd/example', 'https://user@www.msystems.gr/ssd/example', `${storageUrl}?redirect=other`]) {
      expect(mSystemsAdapter.parseOffer(fixture('nv3-product'), url, identity(storageTitle))).toBeNull()
    }
    expect(mSystemsAdapter.productLinks(fixture('nv3-search'), 'https://other.gr/search/', identity(storageTitle))).toEqual([])
  })

  it('deduplicates product cards, ignores script copies, and caps exact links at three', () => {
    const cards = Array.from({ length: 5 }, (_, i) => `<h3 class="product-title"><a href="${storageUrl}-${i}">${storageTitle}</a></h3>`).join('')
    const hidden = '<script>' + fixture('nv3-search') + '</script>'
    const product = identity(storageTitle)
    expect(mSystemsAdapter.productLinks(hidden + cards + cards, mSystemsAdapter.searchUrl(product)!, product)).toEqual([0, 1, 2].map(i => `${storageUrl}-${i}`))
  })

  it('fails closed on oversized or broken markup', () => {
    expect(mSystemsAdapter.parseOffer('x'.repeat(1024 * 1024 + 1), storageUrl, identity(storageTitle))).toBeNull()
    expect(mSystemsAdapter.parseOffer('<html>Unavailable</html>', storageUrl, identity(storageTitle))).toBeNull()
  })
})
