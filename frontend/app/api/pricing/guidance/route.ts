import { allowPricing, pricingResponse, readSubject } from '@/lib/pricing/http'
import { pricingUser, publicComparables } from '@/lib/pricing/public-data'
import { buildGuidance, getProductIdentity, priceRange } from '@/lib/pricing/matching'
import { getRetailComparison } from '@/lib/pricing/retail'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const authorization = request.headers.get('authorization') || ''
  if (!authorization.startsWith('Bearer ') || authorization.length > 8192) return pricingResponse({ error: 'Authentication required' }, 401)
  const ingress = await allowPricing(request, 'guidance-auth')
  if (!ingress.allowed) return pricingResponse({ error: 'Try again shortly' }, 429)
  const subject = await readSubject(request)
  if (!subject) return pricingResponse({ error: 'Invalid listing details' }, 400)
  try {
    const user = await pricingUser(authorization.slice(7))
    if (!user) return pricingResponse({ error: 'Authentication required' }, 401)
    const allowance = await allowPricing(request, 'guidance', user.id)
    if (!allowance.allowed) return pricingResponse({ error: 'Try again shortly' }, 429)
    if (!['Sell', 'I will', 'I can'].includes(subject.subCategory)) return pricingResponse(buildGuidance(subject, []))
    const [comparableResult, retailResult] = await Promise.allSettled([
      publicComparables(subject, user.sellerIds), getRetailComparison(subject),
    ])
    const retail = retailResult.status === 'fulfilled' ? retailResult.value : { status: 'unavailable', offers: [] }
    const guidance = buildGuidance(subject, comparableResult.status === 'fulfilled' ? comparableResult.value : [])
    if (comparableResult.status === 'rejected') { guidance.status = 'unavailable'; guidance.reason = 'temporary_error' }
    guidance.retailRange = priceRange(retail.offers.map(offer => offer.price))
    // New-store prices may guide a NEW product only; never manufacture used-item depreciation.
    if (guidance.status !== 'ready' && retail.offers.length >= 3 && getProductIdentity(subject)?.condition === 'new' && guidance.retailRange) {
      guidance.status = 'ready'
      guidance.range = guidance.retailRange
      guidance.sampleSize = retail.offers.length
      guidance.basis = 'new_retail'
      delete guidance.reason
    }
    return pricingResponse(guidance)
  } catch { return pricingResponse({ status: 'unavailable', range: null, sampleSize: 0, basis: null, unit: 'item', retailRange: null, reason: 'temporary_error' }, 503) }
}
