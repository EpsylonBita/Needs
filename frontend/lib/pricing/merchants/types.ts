import type { ProductIdentity } from '../matching'
import type { RetailOffer } from '../types'

/** An audited public shop catalogue. Parsers never perform network requests. */
export type MerchantAdapter = {
  id: string
  name: string
  origin: string
  searchUrl(identity: ProductIdentity): string | null
  productLinks(html: string, searchUrl: string, identity: ProductIdentity): string[]
  parseOffer(html: string, url: string, identity: ProductIdentity): RetailOffer | null
}
