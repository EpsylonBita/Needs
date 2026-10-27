// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getProductIdentity } from '@/lib/pricing/matching'
import { musiclandAdapter as adapter } from '@/lib/pricing/merchants/musicland'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), 'utf8')
const naturalHtml = fixture('musicland-f370-natural'), blackHtml = fixture('musicland-f370-black')
const identity = (title: string) => getProductIdentity({ title, description: 'Used', mainCategory: 'Items', subCategory: 'Sell', coordinates: null })!
const natural = identity('Yamaha F370 Natural'), black = identity('Yamaha F370 Black')
const naturalUrl = 'https://www.musicland.gr/akoustikes-kithares/yamaha-f-370-natural'
const blackUrl = 'https://www.musicland.gr/akoustikes-kithares/yamaha-f-370-akoustiki-kithara-mayro'

describe('Musicland public catalogue', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-27T12:00:00Z')) })
  afterEach(() => vi.useRealTimers())

  it('uses the observed search form with a generic canonical model query', () => {
    const url = new URL(adapter.searchUrl(natural)!)
    expect(url.origin + url.pathname).toBe('https://www.musicland.gr/search')
    expect(url.searchParams.get('q')).toBe('yamaha f370')
    expect(new URL(adapter.searchUrl(identity('Roland FP30X Black'))!).searchParams.get('q')).toBe('roland fp30x')
  })

  it('selects each exact colour from live search markup, excluding recommendations', () => {
    const search = fixture('musicland-search-canonical')
    expect(adapter.productLinks(search, adapter.searchUrl(natural)!, natural)).toEqual([naturalUrl])
    expect(adapter.productLinks(search, adapter.searchUrl(black)!, black)).toEqual([blackUrl])
    expect(adapter.productLinks(search, adapter.searchUrl(natural)!, identity('Yamaha F310 Natural'))).toEqual([])
  })

  it('reads two real whole-item prices with explicit new-condition evidence', () => {
    expect(adapter.parseOffer(naturalHtml, naturalUrl, natural)).toEqual({ shop: 'Musicland', price: 189, url: naturalUrl })
    expect(adapter.parseOffer(blackHtml, blackUrl, black)).toEqual({ shop: 'Musicland', price: 172, url: blackUrl })
    expect(adapter.parseOffer(blackHtml, blackUrl, natural)).toBeNull()
  })

  it('rejects the actual out-of-stock F310 and contradicting availability', () => {
    expect(adapter.parseOffer(fixture('musicland-f310'), 'https://www.musicland.gr/akoustikes-kithares/yamaha-f-310-akoustiki-kithara-natural', identity('Yamaha F310 Natural'))).toBeNull()
    expect(adapter.parseOffer(naturalHtml.replace('schema.org/InStock', 'schema.org/OutOfStock'), naturalUrl, natural)).toBeNull()
    expect(adapter.parseOffer(naturalHtml.replaceAll('Διαθέσιμο', 'Μη Διαθέσιμο'), naturalUrl, natural)).toBeNull()
  })

  it('requires agreeing visible and structured price plus EUR and explicit new condition', () => {
    for (const changed of [naturalHtml.replace('"price":"189.00"', '"price":"18.90"'), naturalHtml.replace('<strong>189', '<strong>18,90'), naturalHtml.replace('NewCondition', 'UsedCondition'), naturalHtml.replaceAll('EUR', 'USD'), naturalHtml.replace('"itemCondition":"https://schema.org/NewCondition",', '')]) {
      expect(adapter.parseOffer(changed, naturalUrl, natural)).toBeNull()
    }
  })

  it.each(['billingDuration', 'billingIncrement', 'unitCode', 'unitText', 'referenceQuantity', 'eligibleQuantity', 'eligibleTransactionVolume', 'validForMemberTier', 'priceType'])('rejects conditional %s on the offer or its price specification', key => {
    for (const addition of [`"${key}":"conditional",`, `"priceSpecification":{"${key}":"conditional"},`]) {
      expect(adapter.parseOffer(naturalHtml.replace('"offers":{', `"offers":{${addition}`), naturalUrl, natural)).toBeNull()
    }
  })

  it('never borrows related prices, installments or list prices', () => {
    const other = '<section><h1>Yamaha F370 Natural</h1><div class="prices"><strong>9,90€ / μήνα</strong></div></section>'
    expect(adapter.parseOffer(other + naturalHtml, naturalUrl, natural)?.price).toBe(189)
    expect(adapter.parseOffer(naturalHtml.replace('id="pinfo"', 'id="related"') + other, naturalUrl, natural)).toBeNull()
    expect(adapter.parseOffer(naturalHtml.replace('<strong>189', '<strong>9,90 / μήνα '), naturalUrl, natural)).toBeNull()
    expect(adapter.parseOffer(naturalHtml.replace('class="prices"', 'class="prices" hidden'), naturalUrl, natural)).toBeNull()
  })

  it('requires the same canonical product and rejects open-box, unsafe hosts and oversize pages', () => {
    expect(adapter.parseOffer(naturalHtml, blackUrl, natural)).toBeNull()
    expect(adapter.parseOffer(naturalHtml.replace('Yamaha F-370 Natural <span', 'Used Yamaha F-370 Natural <span'), naturalUrl, natural)).toBeNull()
    expect(adapter.parseOffer(naturalHtml, naturalUrl.replace('www.musicland.gr', '127.0.0.1'), natural)).toBeNull()
    expect(adapter.productLinks(fixture('musicland-search-canonical').replaceAll('href="/akoustikes', 'href="https://evil.example/akoustikes'), adapter.searchUrl(natural)!, natural)).toEqual([])
    expect(adapter.parseOffer('x'.repeat(1024 * 1024 + 1), naturalUrl, natural)).toBeNull()
  })
})
