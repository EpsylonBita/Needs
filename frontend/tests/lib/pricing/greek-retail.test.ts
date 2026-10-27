// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MerchantAdapter } from '@/lib/pricing/merchants/types'
import { getProductIdentity } from '@/lib/pricing/matching'

const network = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@/lib/pricing/merchant-verifier', async original => ({
  ...await original<typeof import('@/lib/pricing/merchant-verifier')>(), readRetailPage: network.read,
}))
import { GREEK_RETAILERS, scrapeGreekRetail, scrapeMerchant } from '@/lib/pricing/greek-retail'

const identity = getProductIdentity({ title: 'Sony WH-1000XM5 Black', description: '', mainCategory: 'Items', subCategory: 'Sell', coordinates: null })!
const productUrl = 'https://retailer.gr/product/sony'
const result = { shop: 'Retailer', price: 249, url: productUrl }
const adapter = (): MerchantAdapter => ({
  id: 'fixture', name: 'Retailer', origin: 'https://retailer.gr',
  searchUrl: () => 'https://retailer.gr/search?q=sony',
  productLinks: () => [productUrl], parseOffer: () => result,
})
beforeEach(() => { network.read.mockReset().mockImplementation(async (url: string) => ({ html: '<html>public catalogue</html>', url })) })

describe('audited merchant orchestration', () => {
  it('reads search and the specific product before returning a quote', async () => {
    expect(await scrapeMerchant(adapter(), identity)).toEqual({ offer: result, checked: true })
    expect(network.read.mock.calls.map(call => call[0])).toEqual(['https://retailer.gr/search?q=sony', productUrl])
  })
  it('never publishes prices from a search result', async () => {
    const store = adapter()
    store.parseOffer = vi.fn().mockReturnValue(null)
    expect(await scrapeMerchant(store, identity)).toEqual({ offer: null, checked: true })
    expect(store.parseOffer).toHaveBeenCalledWith('<html>public catalogue</html>', productUrl, identity)
  })
  it('rejects off-store and unsafe search origins before making a request', async () => {
    for (const url of ['https://evil.gr/search', 'https://127.0.0.1/', 'http://retailer.gr/search', 'https://retailer.gr:8443/']) {
      expect(await scrapeMerchant({ ...adapter(), searchUrl: () => url }, identity)).toEqual({ offer: null, checked: false })
    }
    expect(network.read).not.toHaveBeenCalled()
  })
  it('bounds and deduplicates candidate reads and omits third-party links', async () => {
    const store = { ...adapter(), productLinks: () => [
      'https://evil.gr/product', 'https://retailer.gr/a', 'https://retailer.gr/a#details',
      'https://retailer.gr/b', 'https://retailer.gr/c', 'https://retailer.gr/d',
    ], parseOffer: () => null }
    await scrapeMerchant(store, identity)
    expect(network.read.mock.calls.map(call => call[0])).toEqual([
      'https://retailer.gr/search?q=sony', 'https://retailer.gr/a', 'https://retailer.gr/b', 'https://retailer.gr/c',
    ])
  })
  it('does not follow a product URL emitted by a compromised parser', async () => {
    expect(await scrapeMerchant({ ...adapter(), parseOffer: () => ({ ...result, url: 'https://evil.gr/product' }) }, identity))
      .toEqual({ offer: null, checked: true })
  })
  it.each([0, -1, NaN, Infinity, 10000001])('rejects invalid whole prices: %s', async price => {
    expect((await scrapeMerchant({ ...adapter(), parseOffer: () => ({ ...result, price }) }, identity)).offer).toBeNull()
  })
  it('stops at a failed search without retries', async () => {
    network.read.mockResolvedValue(null)
    expect(await scrapeMerchant(adapter(), identity)).toEqual({ offer: null, checked: false })
    expect(network.read).toHaveBeenCalledOnce()
  })
  it('contains parser and network failures within that merchant', async () => {
    expect(await scrapeMerchant({ ...adapter(), productLinks: () => { throw new Error('Changed markup') } }, identity))
      .toEqual({ offer: null, checked: false })
    network.read.mockRejectedValue(new Error('Network failure'))
    expect(await scrapeMerchant(adapter(), identity)).toEqual({ offer: null, checked: false })
  })
  it('isolates one unavailable catalogue and keeps the others sorted by actual price', async () => {
    const spies: ReturnType<typeof vi.spyOn>[] = []
    try {
      GREEK_RETAILERS.forEach((store, index) => {
        spies.push(vi.spyOn(store, 'searchUrl').mockReturnValue(index < 3 ? store.origin + '/search' : null))
        spies.push(vi.spyOn(store, 'productLinks').mockReturnValue([store.origin + '/product']))
        spies.push(vi.spyOn(store, 'parseOffer').mockImplementation(() => {
          if (index === 0) throw new Error('Changed page')
          return { shop: store.name, price: index === 1 ? 300 : 250, url: store.origin + '/product' }
        }))
      })
      const result = await scrapeGreekRetail(identity)
      expect(result.offers.map(offer => offer.price)).toEqual([250, 300])
      expect(result.checked).toBe(2)
    } finally { spies.forEach(spy => spy.mockRestore()) }
  })
  it('keeps the expanded catalogue bounded to three simultaneous page reads', async () => {
    let active = 0, maximum = 0
    network.read.mockImplementation(async (url: string) => {
      active++
      maximum = Math.max(maximum, active)
      await new Promise(resolve => setTimeout(resolve, 1))
      active--
      return { html: '<html>catalogue</html>', url }
    })
    const spies: ReturnType<typeof vi.spyOn>[] = []
    try {
      GREEK_RETAILERS.forEach(store => {
        spies.push(vi.spyOn(store, 'searchUrl').mockReturnValue(store.origin + '/search'))
        spies.push(vi.spyOn(store, 'productLinks').mockReturnValue([store.origin + '/product']))
        spies.push(vi.spyOn(store, 'parseOffer').mockReturnValue({ shop: store.name, price: 50, url: store.origin + '/product' }))
      })
      expect((await scrapeGreekRetail(identity)).offers.length).toBe(Math.min(GREEK_RETAILERS.length, 12))
      expect(maximum).toBeLessThanOrEqual(3)
      expect(active).toBe(0)
    } finally { spies.forEach(spy => spy.mockRestore()) }
  })
  it('does not start a page request after the overall lookup deadline', async () => {
    expect(await scrapeMerchant(adapter(), identity, Date.now() - 1)).toEqual({ offer: null, checked: false })
    expect(network.read).not.toHaveBeenCalled()
  })
})
