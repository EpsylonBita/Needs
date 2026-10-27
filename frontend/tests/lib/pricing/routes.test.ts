// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/pricing/retail/route'
import { POST } from '@/app/api/pricing/guidance/route'
import { readSubject } from '@/lib/pricing/http'
import type { PriceGuidance, PricingSubject } from '@/lib/pricing/types'

const mocks = vi.hoisted(() => ({ limit: vi.fn(), listing: vi.fn(), user: vi.fn(), comparables: vi.fn(), retail: vi.fn(), guidance: vi.fn(), identity: vi.fn() }))
vi.mock('@/lib/utils/rate-limit-enhanced', () => ({ rateLimitEnhanced: mocks.limit }))
vi.mock('@/lib/pricing/public-data', () => ({ publicListing: mocks.listing, pricingUser: mocks.user, publicComparables: mocks.comparables }))
vi.mock('@/lib/pricing/retail', () => ({ getRetailComparison: mocks.retail }))
vi.mock('@/lib/pricing/matching', () => ({ buildGuidance: mocks.guidance, getProductIdentity: mocks.identity, priceRange: (values: number[]) => values.length ? { low: Math.min(...values), high: Math.max(...values), median: values[1] ?? values[0] } : null }))
const subject: PricingSubject = { title: 'Sony WH-1000XM5 Black', description: 'Used headphones', mainCategory: 'Items', subCategory: 'Sell', coordinates: null }
const empty: PriceGuidance = { status: 'insufficient_data', range: null, sampleSize: 0, basis: null, unit: 'item', retailRange: null, reason: 'not_enough_comparables' }
const retail = { status: 'ready', offers: [100, 110, 120].map((price, i) => ({ shop: `Shop ${i}`, price, url: `https://shop${i}.example.com/product` })) }
const request = (body: unknown = subject, token = 'Bearer test-session') => new Request('http://localhost/api/pricing/guidance', { method: 'POST', headers: { authorization: token, 'content-type': 'application/json' }, body: JSON.stringify(body) })
beforeEach(() => {
  vi.clearAllMocks(); mocks.limit.mockResolvedValue({ allowed: true }); mocks.user.mockResolvedValue({ id: 'user-id', sellerIds: ['own-profile'] })
  mocks.listing.mockResolvedValue(subject); mocks.comparables.mockResolvedValue([]); mocks.retail.mockResolvedValue(retail)
  mocks.guidance.mockImplementation(() => ({ ...empty })); mocks.identity.mockReturnValue({ condition: 'used' })
})

describe('pricing routes', () => {
  it('validates listing ID and never accepts a client product URL', async () => {
    expect((await GET(new Request('http://localhost/api/pricing/retail?listingId=https://localhost/secret'))).status).toBe(400)
    expect(mocks.listing).not.toHaveBeenCalled(); expect(mocks.retail).not.toHaveBeenCalled()
  })
  it('does not look up private or missing listings', async () => {
    mocks.listing.mockResolvedValue(null)
    expect((await GET(new Request('http://localhost/api/pricing/retail?listingId=84cb699f-6bcd-46d1-8a48-b011ccb69bb9'))).status).toBe(404)
    expect(mocks.retail).not.toHaveBeenCalled()
  })
  it('uses authoritative public details and returns only the retail contract', async () => {
    const response = await GET(new Request('http://localhost/api/pricing/retail?listingId=84cb699f-6bcd-46d1-8a48-b011ccb69bb9'))
    expect(await response.json()).toEqual(retail)
    expect(mocks.retail).toHaveBeenCalledWith(subject)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
  it('requires a verified user before draft reference queries', async () => {
    expect((await POST(request(subject, ''))).status).toBe(401)
    mocks.user.mockResolvedValue(null)
    expect((await POST(request())).status).toBe(401)
    expect(mocks.comparables).not.toHaveBeenCalled(); expect(mocks.retail).not.toHaveBeenCalled()
  })
  it('keeps used-product guidance neutral when only new-store prices exist, excluding own listings', async () => {
    const response = await POST(request())
    expect(await response.json()).toEqual({ ...empty, retailRange: { low: 100, high: 120, median: 110 } })
    expect(mocks.comparables).toHaveBeenCalledWith(subject, ['own-profile'])
  })
  it('can use three verified store prices for a confirmed new product', async () => {
    mocks.identity.mockReturnValue({ condition: 'new' })
    expect(await (await POST(request())).json()).toMatchObject({ status: 'ready', basis: 'new_retail', sampleSize: 3, range: { low: 100, high: 120, median: 110 } })
  })
  it('keeps marketplace guidance working if retail is unavailable', async () => {
    mocks.retail.mockResolvedValue({ status: 'unavailable', offers: [] })
    mocks.guidance.mockReturnValue({ ...empty, status: 'ready', range: { low: 70, high: 90, median: 80 }, sampleSize: 5, basis: 'needs_asking' })
    expect(await (await POST(request())).json()).toMatchObject({ status: 'ready', basis: 'needs_asking', retailRange: null })
  })
  it('preserves a verified new-retail reference if marketplace evidence fails', async () => {
    mocks.comparables.mockRejectedValue(new Error('Public database unavailable'))
    expect(await (await POST(request())).json()).toMatchObject({ status: 'unavailable', range: null, retailRange: { low: 100, high: 120, median: 110 } })
    mocks.identity.mockReturnValue({ condition: 'new' })
    expect(await (await POST(request())).json()).toMatchObject({ status: 'ready', basis: 'new_retail' })
  })
  it('honors request rate limits before public/provider queries', async () => {
    mocks.limit.mockResolvedValue({ allowed: false })
    expect((await POST(request())).status).toBe(429)
    expect(mocks.user).not.toHaveBeenCalled(); expect(mocks.retail).not.toHaveBeenCalled()
  })
  it('rejects extra fields, impossible coordinates, malformed and oversized bodies', async () => {
    for (const bad of [{ ...subject, url: 'https://localhost' }, { ...subject, coordinates: [999, 38] }, { ...subject, mainCategory: 'Services' }, { ...subject, description: 'a'.repeat(33000) }]) {
      expect(await readSubject(request(bad))).toBeNull()
    }
    expect(await readSubject(new Request('http://localhost', { method: 'POST', body: '{' }))).toBeNull()
  })
})
