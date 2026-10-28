import { formatListingPrice, listingRequiresAgreedTotal } from './price-display';

export const RATE_PRICE_REQUIRED_ERROR = 'Enter a positive price for this rate-priced listing.';

export function listingPriceNeedsConfirmation(price: number, description: string | null | undefined, category?: string, subcategory?: string): boolean {
  if (category === 'Items' && subcategory === 'Free') return false;
  return listingRequiresAgreedTotal(description) && (!Number.isFinite(price) || price <= 0);
}

export function formatPublishedListingPrice(price: number, description: string | null | undefined, locale?: string, category?: string, subcategory?: string, options?: Intl.NumberFormatOptions): string {
  if (price === 0 && category === 'Items' && subcategory === 'Free') {
    return locale === 'el' ? 'Δωρεάν' : 'Free';
  }
  if (listingPriceNeedsConfirmation(price, description, category, subcategory)) {
    return locale === 'el' ? 'Η τιμή χρειάζεται επιβεβαίωση' : 'Price needs confirmation';
  }
  return formatListingPrice(price, category === 'Items' && subcategory === 'Free' ? undefined : description, locale, options);
}
