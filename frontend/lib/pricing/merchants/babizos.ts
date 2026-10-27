import { createPrestaShopAdapter } from './mpakas-diy'

/** Observed public form and primary-product markup at Euronics Βαβίζος, Λάρισα. */
export const babizosAdapter = createPrestaShopAdapter({
  id: 'babizos', name: 'Βαβίζος', origin: 'https://babizos.eu', searchPath: '/search',
  searchParameters: { orderby: 'position', orderway: 'desc', search_category: 'all' },
  productPath: /^\/[^/]+\/[^/]+$/, priceClass: 'current-price-value',
})
