export type PricingSubject = {
  title: string
  description: string
  mainCategory: 'Items' | 'Services'
  subCategory: 'Buy' | 'Sell' | 'Free' | 'I want' | 'I will' | 'I can'
  coordinates: [number, number] | null
}

export type ComparableListing = PricingSubject & {
  id: string
  sellerId: string
  price: number
}

export type PriceRange = { low: number; high: number; median: number }
export type PricingStatus = 'ready' | 'insufficient_data' | 'unavailable'
export type PricingReason = 'missing_details' | 'not_enough_comparables' | 'provider_unavailable' | 'unsupported' | 'temporary_error'
export type RetailOffer = { shop: string; price: number; url: string }
export const MAX_RETAIL_OFFERS = 12
export type RetailComparison = {
  status: PricingStatus
  offers: RetailOffer[]
  reason?: PricingReason
}

export type PriceGuidance = {
  status: PricingStatus
  range: PriceRange | null
  sampleSize: number
  basis: 'needs_asking' | 'new_retail' | null
  unit: 'item' | 'hour' | 'day' | 'month' | 'job'
  retailRange: PriceRange | null
  reason?: PricingReason
}
