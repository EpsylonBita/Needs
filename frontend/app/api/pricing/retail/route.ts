import { allowPricing, pricingResponse } from '@/lib/pricing/http'
import { publicListing } from '@/lib/pricing/public-data'
import { getRetailComparison } from '@/lib/pricing/retail'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('listingId') || ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return pricingResponse({ error: 'Invalid listing' }, 400)
  const allowance = await allowPricing(request, 'retail')
  if (!allowance.allowed) return pricingResponse({ status: 'unavailable', offers: [], reason: 'temporary_error' }, 429)
  try {
    const listing = await publicListing(id)
    if (!listing) return pricingResponse({ error: 'Listing unavailable' }, 404)
    return pricingResponse(await getRetailComparison(listing))
  } catch { return pricingResponse({ status: 'unavailable', offers: [], reason: 'temporary_error' }, 503) }
}
