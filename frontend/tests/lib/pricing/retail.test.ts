// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PricingSubject } from '@/lib/pricing/types'

const mocks = vi.hoisted(() => ({ limit: vi.fn(), scrape: vi.fn() }))
vi.mock('@/lib/utils/rate-limit-enhanced', () => ({ rateLimitEnhanced: mocks.limit }))
vi.mock('@/lib/pricing/greek-retail', () => ({ scrapeGreekRetail: mocks.scrape }))
const subject: PricingSubject = {
  title: 'Sony WH-1000XM5 Black', description: 'Used headphones.',
  mainCategory: 'Items', subCategory: 'Sell', coordinates: null,
}
const offer = { shop: 'Sony Centers', price: 299, url: 'https://sonycenters.gr/wh-1000xm5b' }
const unavailable = { status: 'unavailable', offers: [], reason: 'provider_unavailable' }
const insufficient = { status: 'insufficient_data', offers: [], reason: 'not_enough_comparables' }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
beforeEach(() => {
  vi.resetModules()
  mocks.limit.mockReset().mockResolvedValue({ allowed: true })
  mocks.scrape.mockReset().mockResolvedValue({ offers: [offer], checked: 1 })
  vi.stubEnv('PRICING_RETAIL_ENABLED', 'true')
  vi.stubEnv('PRICING_SEARCH_DAILY_LIMIT', '')
  vi.stubEnv('NEEDS_E2E', '0')
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected external API') }))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('free direct Greek retail integration', () => {
  it.each(['', 'legacy-secret-not-to-be-used'])('does not need or send a paid API key: %s', async key => {
    vi.stubEnv('SERPAPI_API_KEY', key)
    const { getRetailComparison } = await import('@/lib/pricing/retail')
    expect(await getRetailComparison(subject)).toEqual({ status: 'ready', offers: [offer] })
    expect(mocks.scrape).toHaveBeenCalledWith(expect.objectContaining({ model: 'sony wh1000xm5', variantTokens: ['black'] }))
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.limit).toHaveBeenNthCalledWith(1, 'pricing:discovery:minute', 3, 60000, { failClosed: true })
    expect(mocks.limit).toHaveBeenNthCalledWith(2, 'pricing:discovery:daily', 100, 86400000, { failClosed: true })
  })
  it('shares in-flight work and cached prices across equivalent listings', async () => {
    const gate = deferred<{ offers: typeof offer[]; checked: number }>()
    mocks.scrape.mockReturnValue(gate.promise)
    const { getRetailComparison } = await import('@/lib/pricing/retail')
    const first = getRetailComparison(subject)
    const second = getRetailComparison({ ...subject, description: 'Good condition' })
    await vi.waitFor(() => expect(mocks.scrape).toHaveBeenCalledOnce())
    gate.resolve({ offers: [offer], checked: 1 })
    expect(await first).toEqual(await second)
    expect(await getRetailComparison(subject)).toEqual(await first)
    expect(mocks.scrape).toHaveBeenCalledOnce()
    expect(mocks.limit).toHaveBeenCalledTimes(2)
  })
  it('refreshes successful prices after six hours', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const { getRetailComparison } = await import('@/lib/pricing/retail')
    await getRetailComparison(subject)
    now.mockReturnValue(1000 + 6 * 3600000)
    mocks.scrape.mockResolvedValue({ offers: [{ ...offer, price: 279 }], checked: 1 })
    expect((await getRetailComparison(subject)).offers[0].price).toBe(279)
    expect(mocks.scrape).toHaveBeenCalledTimes(2)
  })
  it('bounds active product lookups without dropping the two existing ones', async () => {
    const gate = deferred<{ offers: typeof offer[]; checked: number }>()
    mocks.scrape.mockReturnValue(gate.promise)
    const { getRetailComparison } = await import('@/lib/pricing/retail')
    const first = getRetailComparison(subject)
    const second = getRetailComparison({ ...subject, title: 'Sony WH-1000XM4 Black' })
    expect(await getRetailComparison({ ...subject, title: 'Sony WH-1000XM6 Black' })).toEqual(unavailable)
    gate.resolve({ offers: [offer], checked: 1 })
    expect((await first).status).toBe('ready')
    expect((await second).status).toBe('ready')
    expect(mocks.scrape).toHaveBeenCalledTimes(2)
  })
  it.each(['PRICING_RETAIL_ENABLED', 'NEEDS_E2E'])('respects %s even after a successful cache entry', async setting => {
    const { getRetailComparison } = await import('@/lib/pricing/retail')
    await getRetailComparison(subject)
    vi.stubEnv(setting, setting === 'NEEDS_E2E' ? '1' : 'false')
    expect(await getRetailComparison(subject)).toEqual(unavailable)
    expect(mocks.scrape).toHaveBeenCalledOnce()
  })
  it.each([
    [{ offers: [], checked: 2 }, insufficient],
    [{ offers: [], checked: 0 }, unavailable],
  ])('distinguishes missing exact products from failed sources', async (result, expected) => {
    mocks.scrape.mockResolvedValue(result)
    const { getRetailComparison } = await import('@/lib/pricing/retail')
    expect(await getRetailComparison(subject)).toEqual(expected)
  })
  it('briefly caches failure and retries after ten minutes', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
    mocks.scrape.mockRejectedValue(new Error('private upstream details'))
    const { getRetailComparison } = await import('@/lib/pricing/retail')
    expect(await getRetailComparison(subject)).toEqual(unavailable)
    expect(await getRetailComparison(subject)).toEqual(unavailable)
    now.mockReturnValue(1000 + 10 * 60000)
    mocks.scrape.mockResolvedValue({ offers: [offer], checked: 1 })
    expect((await getRetailComparison(subject)).status).toBe('ready')
    expect(mocks.scrape).toHaveBeenCalledTimes(2)
  })
  it.each(['daily', 'minute'])('does not crawl when the shared %s allowance is exhausted', async quota => {
    mocks.limit.mockImplementation(async (key: string) => ({ allowed: !key.endsWith(quota) }))
    const { getRetailComparison } = await import('@/lib/pricing/retail')
    expect(await getRetailComparison(subject)).toEqual(unavailable)
    expect(mocks.limit).toHaveBeenCalledTimes(quota === 'minute' ? 1 : 2)
    expect(mocks.scrape).not.toHaveBeenCalled()
  })
  it('fails closed if quota storage is unavailable', async () => {
    mocks.limit.mockRejectedValue(new Error('storage diagnostic'))
    const { getRetailComparison } = await import('@/lib/pricing/retail')
    expect(await getRetailComparison(subject)).toEqual(unavailable)
    expect(mocks.scrape).not.toHaveBeenCalled()
  })
  it.each(['0', '-1', '1001', '1.5', 'invalid'])('keeps an invalid traffic allowance bounded: %s', async value => {
    vi.stubEnv('PRICING_SEARCH_DAILY_LIMIT', value)
    const { getRetailComparison } = await import('@/lib/pricing/retail')
    await getRetailComparison(subject)
    expect(mocks.limit).toHaveBeenCalledWith('pricing:discovery:daily', 100, 86400000, { failClosed: true })
  })
  it('honors a valid configured daily allowance', async () => {
    vi.stubEnv('PRICING_SEARCH_DAILY_LIMIT', '12')
    const { getRetailComparison } = await import('@/lib/pricing/retail')
    await getRetailComparison(subject)
    expect(mocks.limit).toHaveBeenCalledWith('pricing:discovery:daily', 12, 86400000, { failClosed: true })
  })
  it('does not query shops for unsupported or unidentified products', async () => {
    const { getRetailComparison } = await import('@/lib/pricing/retail')
    expect(await getRetailComparison({ ...subject, subCategory: 'Buy' })).toMatchObject({ reason: 'unsupported' })
    expect(await getRetailComparison({ ...subject, title: 'Headphones' })).toMatchObject({ reason: 'missing_details' })
    expect(mocks.scrape).not.toHaveBeenCalled()
    expect(mocks.limit).not.toHaveBeenCalled()
  })
})
