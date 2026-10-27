import { describe, expect, it } from 'vitest'
import { buildGuidance, getProductIdentity, matchesProduct, priceRange } from '@/lib/pricing/matching'
import type { ComparableListing, PricingSubject } from '@/lib/pricing/types'

const product: PricingSubject = { title: 'Samsung Galaxy S25 Ultra 256GB black', description: 'Used smartphone in good condition.', mainCategory: 'Items', subCategory: 'Sell', coordinates: [23.72, 37.98] }
const service: PricingSubject = { title: 'Apartment cleaning', description: 'Cleaning two bedrooms and kitchen, €15 per hour.', mainCategory: 'Services', subCategory: 'I can', coordinates: [23.72, 37.98] }
const comparable = (subject: PricingSubject, index: number, price: number, changes: Partial<ComparableListing> = {}): ComparableListing => ({ ...subject, id: `listing-${index}`, sellerId: `seller-${index}`, price, ...changes })
const offers = (subject = product, prices = [90, 95, 100, 105, 110]) => prices.map((price, index) => comparable(subject, index, price))

describe('Conservative product identity', () => {
  it.each([
    ['Makita DHP484Z 18V', 'makita dhp484z'],
    ['DeWalt DCD796D2 18V', 'dewalt dcd796d2'],
    ['Logitech G305 Lightspeed 12000 DPI Black', 'logitech g305'],
    ['Logitech MX Master 3S', 'logitech mx master 3s'],
    ['Logitech MX Anywhere 3S', 'logitech mx anywhere 3s'],
    ['Kingston NV3 1TB M.2 PCIe 4.0', 'kingston nv3'],
    ['Kingston 1TB NV3 NVMe M.2 PCIe4.0 SSD', 'kingston nv3'],
    ['Crucial P3 1TB', 'crucial p3'],
    ['TP-Link Archer AX55 AX3000', 'tplink archer ax55'],
    ['Philips HD9252/70', 'philips hd9252/70'],
    ['Tefal EY505D', 'tefal ey505d'],
    ['Yamaha F-370 Natural', 'yamaha f370'],
    ['Roland FP-10', 'roland fp10'],
    ['Canon EOS R5 C', 'canon r5c'],
  ])('recognizes specific models across catalogues: %s', (title, model) => {
    expect(getProductIdentity({ ...product, title, description: '' })?.model).toBe(model)
  })

  it('keeps regional model suffixes, camera editions and M.2 form factors distinct', () => {
    const appliance = getProductIdentity({ ...product, title: 'Philips HD9252/70', description: '' })!
    expect(matchesProduct(appliance, 'Philips HD9252/90')).toBe(false)
    const camera = getProductIdentity({ ...product, title: 'Canon EOS R5', description: '' })!
    expect(matchesProduct(camera, 'Canon EOS R5 C')).toBe(false)
    const storage = getProductIdentity({ ...product, title: 'Kingston NV3 1TB M.2 2230', description: '' })!
    expect(matchesProduct(storage, 'Kingston 1TB NV3 M.2 (2280)')).toBe(false)
    expect(matchesProduct(storage, 'Kingston 1TB NV3 NVMe M.2 (2230) PCIe 4.0')).toBe(true)
    const mouse = getProductIdentity({ ...product, title: 'Logitech MX Master 3S', description: '' })!
    expect(matchesProduct(mouse, 'Logitech MX Anywhere 3S')).toBe(false)
    const g502 = getProductIdentity({ ...product, title: 'Logitech G502 X Black', description: '' })!
    expect(matchesProduct(g502, 'Logitech G G502 X Black')).toBe(true)
    expect(matchesProduct(g502, 'Logitech G502 X Lightspeed Black')).toBe(false)
    expect(matchesProduct(g502, 'Logitech G502 Hero Black')).toBe(false)
    const mac = getProductIdentity({ ...product, title: 'Apple Macbook Air M3 13.6 inch 256GB', description: '' })!
    expect(mac.variantTokens).toContain('13p6inch')
    expect(matchesProduct(mac, 'Apple Macbook Air M3 15.3 inch 256GB')).toBe(false)
  })

  it('accepts explicitly omitted tool accessories but never a charger offered as the product', () => {
    const tool = getProductIdentity({ ...product, title: 'Makita DHP484Z', description: '' })!
    expect(matchesProduct(tool, 'MAKITA DHP484Z Brushless Κρουστικό Δραπ/σάβιδο μπαταρίας 18V LXT (χωρίς μπαταρία και φορτιστή)')).toBe(true)
    expect(matchesProduct(tool, 'Makita DHP484Z drill without battery and charger')).toBe(true)
    expect(matchesProduct(tool, 'Φορτιστής για Makita DHP484Z')).toBe(false)
    expect(matchesProduct(tool, 'Makita DHP484Z replacement charger')).toBe(false)
  })

  it('does not mistake a technical specification or a second model for an exact product', () => {
    for (const title of ['Makita 18V', 'Logitech 12000 DPI', 'TP-Link AX3000', 'Kingston 1TB', 'Logitech G305 and G502', 'Philips HD9252/70 and HD9252/90']) {
      expect(getProductIdentity({ ...product, title, description: '' }), title).toBeNull()
    }
  })
  it('distinguishes musical keyboard sizes and explicit Mac/business mouse editions', () => {
    const keyboard = getProductIdentity({ ...product, title: 'Korg Pa5X-61', description: '' })!
    expect(matchesProduct(keyboard, 'Korg Pa5X 61 keys')).toBe(true)
    expect(matchesProduct(keyboard, 'Korg Pa5X-88')).toBe(false)
    expect(matchesProduct(keyboard, 'Korg Pa5X 76 keys')).toBe(false)
    const mouse = getProductIdentity({ ...product, title: 'Logitech MX Anywhere 3S Pale Gray', description: '' })!
    expect(matchesProduct(mouse, 'Logitech MX Anywhere 3S for Mac Pale Gray')).toBe(false)
    expect(matchesProduct(mouse, 'Logitech MX Anywhere 3S for Business Pale Gray')).toBe(false)
  })
  it('does not treat accessories for newly supported categories as the main product', () => {
    for (const title of ['Χορδές για Yamaha F370', 'Memory card for Canon EOS R5', 'Βάση για Makita DHP484Z']) {
      expect(getProductIdentity({ ...product, title, description: '' }), title).toBeNull()
    }
    expect(getProductIdentity({ ...product, title: 'Yamaha F370 για πώληση', description: '' })?.model).toBe('yamaha f370')
  })

  it('requires a specific model rather than a generic brand, capacity, or product category', () => {
    for (const title of ['Samsung phone', 'Samsung 256GB', 'Wooden chair', 'Apple MacBook', 'A good guitar']) {
      expect(getProductIdentity({ ...product, title })).toBeNull()
    }
    expect(getProductIdentity({ ...product, title: 'Sony WH-1000XM5 black' })?.model).toBe('sony wh1000xm5')
  })

  it('matches the exact model and every known variant, including extra candidate editions', () => {
    const identity = getProductIdentity(product)!
    expect(identity).toMatchObject({ model: 'samsung s25', condition: 'used', variantTokens: ['256gb', 'black', 'ultra'] })
    expect(matchesProduct(identity, 'New Samsung Galaxy S25 Ultra 256 GB Black')).toBe(true)
    for (const title of ['Samsung Galaxy S24 Ultra 256GB Black', 'Samsung Galaxy S25 Ultra 512GB Black', 'Samsung Galaxy S25 256GB Black', 'Samsung Galaxy S25 Ultra 256GB White', 'Samsung Galaxy S25 Ultra 256GB', 'Samsung Galaxy S25 Ultra 256GB Black Plus']) {
      expect(matchesProduct(identity, title), title).toBe(false)
    }
    const base = getProductIdentity({ ...product, title: 'iPhone 15 128GB Blue' })!
    expect(matchesProduct(base, 'Apple iPhone 15 Pro 128GB Blue')).toBe(false)
    expect(matchesProduct(base, 'Apple iPhone15 128 GB Μπλε')).toBe(true)
    const camera = getProductIdentity({ ...product, title: 'Canon EOS R6 Mark II' })!
    expect(matchesProduct(camera, 'Canon EOS R6 Mark I')).toBe(false)
    expect(matchesProduct(camera, 'Canon EOS R6 II')).toBe(true)
  })

  it('rejects accessories, bundles, demo data, and descriptions mentioning multiple models', () => {
    for (const title of ['Case for Samsung Galaxy S25 Ultra 256GB Black', 'Samsung Galaxy S25 Ultra 256GB Black bundle', 'Samsung Galaxy S25 Ultra 256GB Black demo', 'Θήκη Samsung Galaxy S25 Ultra 256GB Black']) {
      expect(getProductIdentity({ ...product, title }), title).toBeNull()
    }
    expect(getProductIdentity({ ...product, description: 'Used Samsung Galaxy S24 and Samsung Galaxy S25' })).toBeNull()
    expect(getProductIdentity({ ...product, title: 'iPhone 15 and Sony WH-1000XM5' })).toBeNull()
    expect(getProductIdentity({ ...product, title: 'Samsung Galaxy S25 and Samsung UE55CU7172' })).toBeNull()
  })

  it('accepts the Sony brand and both names of the PlayStation 5 family', () => {
    const identity = getProductIdentity({ ...product, title: 'Sony PlayStation 5' })!
    expect(identity?.model).toBe('playstation 5')
    expect(getProductIdentity({ ...product, title: 'Sony PS5' })?.model).toBe('playstation 5')
    expect(matchesProduct(identity, 'Sony PS5')).toBe(true)
    expect(getProductIdentity({ ...product, title: 'Sony PS5 and Sony WH-1000XM5' })).toBeNull()
  })

  it.each([
    ['Καινούργιο, σφραγισμένο.', 'new'], ['Σαν καινούργιο.', 'like_new'], ['Μεταχειρισμένο σε καλή κατάσταση.', 'used'],
    ['Broken, for parts.', 'for_parts'], ['Excellent condition.', 'unknown'], ['Not new.', 'unknown'], ['Refurbished.', 'unknown'],
    ['Used, like new.', 'like_new'], ['Used and damaged.', 'for_parts'],
  ])('keeps explicit condition evidence separate: %s', (description, condition) => {
    expect(getProductIdentity({ ...product, description })?.condition).toBe(condition)
  })
})

describe('Price evidence and sample requirements', () => {
  it('reports actual asking prices with a five-seller floor after IQR outlier filtering', () => {
    expect(buildGuidance(product, offers(product, [90, 95, 100, 105, 110, 1000]))).toEqual({
      status: 'ready', range: { low: 90, high: 110, median: 100 }, sampleSize: 5, basis: 'needs_asking', unit: 'item', retailRange: null,
    })
    expect(buildGuidance(product, offers(product, [90, 95, 100, 105, 1000]))).toMatchObject({ status: 'insufficient_data', range: null, reason: 'not_enough_comparables', sampleSize: 4 })
  })

  it('deduplicates listing IDs and gives each seller only one vote', () => {
    const rows = offers()
    expect(buildGuidance(product, [...rows, ...rows])).toMatchObject({ status: 'ready', sampleSize: 5 })
    expect(buildGuidance(product, rows.map(row => ({ ...row, sellerId: 'same-owner' })))).toMatchObject({ status: 'insufficient_data', sampleSize: 1 })
    expect(buildGuidance(product, [...rows, comparable(product, 20, 100, { sellerId: 'seller-0' })])).toMatchObject({ status: 'ready', sampleSize: 5 })
  })

  it('never substitutes new retail prices for used-condition matches', () => {
    expect(buildGuidance({ ...product, description: '' }, offers())).toMatchObject({ status: 'insufficient_data', reason: 'missing_details' })
    expect(buildGuidance(product, offers().map(row => ({ ...row, description: 'Brand new, sealed.' })))).toMatchObject({ status: 'insufficient_data', sampleSize: 0 })
    const invalid = [comparable(product, 10, -1), comparable(product, 11, 0), comparable(product, 12, NaN), comparable(product, 13, Infinity), comparable(product, 14, 95, { subCategory: 'Buy' }), comparable(product, 15, 95, { subCategory: 'Free' }), comparable(product, 16, 95, { title: `${product.title} test` })]
    expect(buildGuidance(product, invalid)).toMatchObject({ status: 'insufficient_data', sampleSize: 0 })
    expect(buildGuidance({ ...product, subCategory: 'Buy' }, offers())).toMatchObject({ reason: 'unsupported' })
  })

  it('handles empty, invalid, repeated and decimal retail price samples without inventing values', () => {
    expect(priceRange([])).toBeNull()
    expect(priceRange([0, -1, NaN, Infinity])).toBeNull()
    expect(priceRange([10, 20])).toEqual({ low: 10, high: 20, median: 15 })
    expect(priceRange([10, 10, 10, 10, 999])).toEqual({ low: 10, high: 10, median: 10 })
    expect(priceRange([10.01, 10.02])).toEqual({ low: 10.01, high: 10.02, median: 10.02 })
  })
})

describe('Comparable service scope', () => {
  it('compares only identical local scope and unit, excluding the stated price expression', () => {
    const rows = offers(service, [12, 14, 15, 16, 18]).map(row => ({ ...row, description: `Cleaning two bedrooms and kitchen, €${row.price} per hour.` }))
    expect(buildGuidance(service, rows)).toMatchObject({ status: 'ready', unit: 'hour', sampleSize: 5, range: { low: 12, high: 18, median: 15 } })
    expect(buildGuidance({ ...service, description: 'Cleaning two bedrooms and kitchen per hour.' }, rows)).toMatchObject({ status: 'ready', unit: 'hour' })
    for (const change of [{ title: 'Office cleaning' }, { description: 'Cleaning three bedrooms and kitchen, €15 per hour.' }, { description: 'Cleaning two bedrooms and kitchen, €15 per day.' }, { coordinates: [22.94, 40.64] as [number, number] }, { coordinates: null }, { subCategory: 'I want' as const }]) {
      expect(buildGuidance(service, rows.map(row => ({ ...row, ...change })))).toMatchObject({ status: 'insufficient_data', sampleSize: 0 })
    }
  })

  it('does not assume a unit or erase additional service charges', () => {
    for (const description of ['Cleaning two bedrooms and kitchen.', 'Available every hour for cleaning two bedrooms and kitchen.', 'Cleaning two bedrooms and kitchen, €15 per hour and €20 travel.', 'Cleaning per hour.']) {
      expect(buildGuidance({ ...service, description }, offers(service))).toMatchObject({ status: 'insufficient_data', reason: 'missing_details' })
    }
  })

  it('accepts an explicit fixed job and explicit Greek hourly scope without guessing from duration', () => {
    const fixed = { ...service, description: 'Fixed price: €100. Clean two bedrooms and kitchen.' }
    expect(buildGuidance(fixed, offers(fixed))).toMatchObject({ status: 'ready', unit: 'job' })
    const greek = { ...service, title: 'Καθαρισμός διαμερίσματος', description: 'Καθαρισμός δύο δωματίων και κουζίνας ανά ώρα.' }
    expect(buildGuidance(greek, offers(greek))).toMatchObject({ status: 'ready', unit: 'hour' })
  })
})
