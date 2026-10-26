import { extractListingPrice, hasListingPriceRate } from '@/lib/services/wit-service';

export type ListingPriceUnit = 'hour' | 'day' | 'month';
export const RATE_PRICE_PAYMENT_ERROR = 'This listing uses a rate per unit. Agree on a total in chat before online payment.';

export function getListingPriceUnit(description: string | null | undefined): ListingPriceUnit | undefined {
  return extractListingPrice(description || '').priceUnit;
}

export function listingRequiresAgreedTotal(description: string | null | undefined): boolean {
  return hasListingPriceRate(description || '');
}

export function listingPriceUnitLabel(unit: ListingPriceUnit, locale?: string): string {
  return { en: { hour: 'hour', day: 'day', month: 'month' }, el: { hour: 'ώρα', day: 'ημέρα', month: 'μήνα' } }[locale === 'el' ? 'el' : 'en'][unit];
}

export function formatListingPriceUnit(price: number, unit: ListingPriceUnit | undefined, locale?: string, options?: Intl.NumberFormatOptions): string {
  const language = locale === 'el' ? 'el' : 'en';
  const amount = new Intl.NumberFormat(language, { style: 'currency', currency: 'EUR', ...options }).format(price);
  return unit ? `${amount}/${listingPriceUnitLabel(unit, language)}` : amount;
}

/** The stored description remains the source of rate terms; editable tags do not affect billing. */
export function formatListingPrice(price: number, description: string | null | undefined, locale?: string, options?: Intl.NumberFormatOptions): string {
  const unit = getListingPriceUnit(description);
  const amount = formatListingPriceUnit(price, unit, locale, options);
  return !unit && listingRequiresAgreedTotal(description)
    ? `${amount} · ${locale === 'el' ? 'τιμή ανά μονάδα' : 'rate per unit'}`
    : amount;
}
