import { describe, expect, it } from 'vitest';
import { formatListingPrice, getListingPriceUnit, listingRequiresAgreedTotal } from '@/lib/listings/price-display';
import { formatPublishedListingPrice } from '@/lib/listings/price-policy';

describe('Stored listing rate display', () => {
  it('labels only explicitly free items as Free in both languages', () => {
    expect(formatPublishedListingPrice(0, 'Previously rented for 10€/hour', 'en', 'Items', 'Free')).toBe('Free');
    expect(formatPublishedListingPrice(0, '', 'el', 'Items', 'Free')).toBe('Δωρεάν');
    expect(formatPublishedListingPrice(0, '', 'en', 'Items', 'Buy')).toBe('€0.00');
    expect(formatPublishedListingPrice(0, '10€/hour', 'en', 'Services', 'I can')).toBe('Price needs confirmation');
  });
  it.each([
    ['10 ευρω την ωρα', 'hour', /10,00.*€\/ώρα/],
    ['20 euros per day', 'day', /10,00.*€\/ημέρα/],
    ['30€ τον μηνα', 'month', /10,00.*€\/μήνα/],
  ] as const)('keeps the explicit basis from %s when the amount is manually edited', (description, unit, label) => {
    expect(getListingPriceUnit(description)).toBe(unit);
    expect(formatListingPrice(10, description, 'el')).toMatch(label);
    expect(listingRequiresAgreedTotal(description)).toBe(true);
  });
  it.each(['10€/hour or 20€/day', '10€/week'])('does not silently label ambiguous or unsupported rates as totals: %s', description => {
    expect(formatListingPrice(10, description, 'en')).toBe('€10.00 · rate per unit');
    expect(listingRequiresAgreedTotal(description)).toBe(true);
  });
  it('keeps fixed totals and missing legacy descriptions unchanged', () => {
    expect(formatListingPrice(10, '10€ for 2 hours', 'en')).toBe('€10.00');
    expect(listingRequiresAgreedTotal('10€ for 2 hours')).toBe(false);
    expect(formatListingPrice(10, undefined, 'en')).toBe('€10.00');
    expect(listingRequiresAgreedTotal(undefined)).toBe(false);
  });
});
