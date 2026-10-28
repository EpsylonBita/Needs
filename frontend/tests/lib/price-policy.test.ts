import { describe, expect, it } from 'vitest';
import { formatPublishedListingPrice, listingPriceNeedsConfirmation } from '@/lib/listings/price-policy';

describe('published listing price policy', () => {
  it.each([0, -1, Number.NaN])('does not describe an invalid rate amount %s as free', price => {
    expect(listingPriceNeedsConfirmation(price, 'Home care 10€/hour', 'Services', 'I can')).toBe(true);
    expect(formatPublishedListingPrice(price, 'Home care 10€/hour', 'en', 'Services', 'I can')).toBe('Price needs confirmation');
    expect(formatPublishedListingPrice(price, 'Home care 10€/hour', 'el', 'Services', 'I can')).toBe('Η τιμή χρειάζεται επιβεβαίωση');
  });

  it('preserves positive rates, fixed totals, and explicit free listings', () => {
    expect(formatPublishedListingPrice(12, 'Home care 10€/hour', 'en', 'Services', 'I can')).toBe('€12.00/hour');
    expect(listingPriceNeedsConfirmation(0, 'Care costs 10€ for two hours', 'Services', 'I can')).toBe(false);
    expect(formatPublishedListingPrice(0, 'Care costs 10€ for two hours', 'en', 'Services', 'I can')).toBe('€0.00');
    expect(listingPriceNeedsConfirmation(0, 'Previously rented at 10€/hour', 'Items', 'Free')).toBe(false);
    expect(formatPublishedListingPrice(0, 'Previously rented at 10€/hour', 'en', 'Items', 'Free')).toBe('Free');
  });
});
