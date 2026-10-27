'use client';

import { useState } from 'react';
import Link from 'next/link';

import { ArrowLeft, ArrowRight, MapPin, Package, Search, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useI18n } from '@/contexts/i18n-context';
import { useSearchState } from '@/hooks/use-search-state';
import { formatPublishedListingPrice, listingPriceNeedsConfirmation } from '@/lib/listings/price-policy';

import { SearchMap } from './search-map';
import { useListingSearch, type SearchListing } from './use-listing-search';

interface SearchResultsProps {
  query?: string;
  radiusMeters?: number;
  fixedCategory?: 'Items' | 'Services';
}

const EMPTY_LISTINGS: SearchListing[] = [];
const subcategories: Record<string, string[]> = {
  Items: ['Buy', 'Sell', 'Free'],
  Services: ['I want', 'I will', 'I can'],
};

function ListingCard({ listing, index }: { listing: SearchListing; index: number }) {
  const { t, locale } = useI18n();
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const imageUrl = listing.listing_images?.find(image => image.main)?.url || listing.listing_images?.[0]?.url;
  const safeImage = imageUrl && (/^https?:\/\//i.test(imageUrl) || (imageUrl.startsWith('/') && !imageUrl.startsWith('//'))) && imageUrl !== failedImage ? imageUrl : null;
  const address = typeof listing.address === 'string' ? listing.address : listing.address?.label;
  const priceNeedsConfirmation = listingPriceNeedsConfirmation(listing.price, listing.description, listing.main_category, listing.sub_category);
  const categories: Record<string, string> = {
    Items: t('searchModern.items', 'Items'), Services: t('searchModern.services', 'Services'),
    Sell: t('searchModern.sell', 'Sell'), Buy: t('searchModern.buy', 'Buy'), Free: t('searchModern.free', 'Free'),
    'I want': t('searchModern.want', 'I want'), 'I will': t('searchModern.will', 'I will'), 'I can': t('searchModern.can', 'I can'),
  };
  return <Link href={`/listings/${encodeURIComponent(listing.id)}`} style={{ animationDelay: `${Math.min(index, 4) * 30}ms` }} className="needs-search-result-card needs-result-arrival group min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
    <div className="needs-search-result-media flex items-center justify-center">
      {safeImage
        // Stored listing images are served directly from their public storage URL.
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={safeImage} alt="" loading="lazy" decoding="async" onError={() => setFailedImage(safeImage)} className="absolute inset-0 h-full w-full object-cover" />
        : <div className="flex flex-col items-center gap-2 px-2 text-center text-muted-foreground"><Package className="h-7 w-7 stroke-[1.25]" aria-hidden="true" /><span className="text-xs">{t('searchModern.noPhoto', 'No photo added')}</span></div>}
    </div>
    <div className="needs-search-result-body">
      <h3 className="line-clamp-2 group-hover:text-primary">{listing.title}</h3>
      {typeof listing.price === 'number' && <span className={`needs-search-result-price${priceNeedsConfirmation ? ' needs-search-result-price--confirmation' : ''}`}>{listing.price === 0 && !priceNeedsConfirmation ? t('searchModern.free', 'Free') : formatPublishedListingPrice(listing.price, listing.description, locale, listing.main_category, listing.sub_category)}</span>}
      <div className="needs-search-result-category">
        <span>{categories[listing.main_category] || listing.main_category}</span><span aria-hidden="true">·</span><span>{categories[listing.sub_category] || listing.sub_category}</span>
      </div>
      <p className="needs-search-result-description line-clamp-2">{listing.description}</p>
      {address && <span className="needs-search-result-location"><MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="line-clamp-2">{address}</span></span>}
    </div>
  </Link>;
}

export function SearchResults({ query, radiusMeters, fixedCategory }: SearchResultsProps) {
  const state = useSearchState();
  const { t, locale } = useI18n();
  const searchQuery = query ?? state.query.value;
  const category = fixedCategory || state.category.value;
  const allowedSubcategories = category ? subcategories[category] || [] : Object.values(subcategories).flat();
  const subcategory = allowedSubcategories.includes(state.subcategory.value) ? state.subcategory.value : '';
  const coordinates = state.coordinates.value;
  const parameters = new URLSearchParams({
    q: searchQuery, category, subcategory, tags: state.tags.value.filter(Boolean).join(','),
    distance: String(radiusMeters ? Math.max(1, Math.round(radiusMeters / 1000)) : state.distance.value),
    page: String(state.page.value),
  });
  if (coordinates) parameters.set('coordinates', coordinates);
  const { data, isLoading, error, retry } = useListingSearch(parameters.toString());
  // The list and map always share one response. Do not leave old pins visible while filters change.
  const results = !isLoading && !error ? data?.listings || EMPTY_LISTINGS : EMPTY_LISTINGS;

  return <div className="needs-search-workspace">
    <section aria-label={t('searchModern.resultsLabel', 'Search results')} className="needs-search-list min-w-0 space-y-5" aria-busy={isLoading}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-lg font-semibold">{searchQuery ? <>{t('searchModern.resultsFor', 'Results for')} <span className="break-words text-primary">“{searchQuery}”</span></> : t('searchModern.browse', 'Explore the listings')}</h2>
        {!isLoading && !error && <p className="text-sm text-muted-foreground" aria-live="polite">{data?.pagination.total === 1 ? t('searchModern.oneResult', '1 listing') : t('searchModern.resultCount', '{count} listings').replace('{count}', String(data?.pagination.total ?? 0))}</p>}
      </div>
      {!coordinates && <p className="flex gap-2 text-sm leading-relaxed text-muted-foreground"><MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t('searchModern.allLocations', 'Showing all locations. Choose “Use my location” in filters to search nearby.')}</p>}

      {isLoading ? <div><p role="status" className="mb-4 text-sm text-muted-foreground">{t('search.searching', 'Searching...')}</p><div className="space-y-3" aria-hidden="true">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-40 rounded-2xl" />)}</div></div>
        : error ? <div role="alert" className="rounded-2xl border border-border bg-card px-5 py-10 text-center">
          <TriangleAlert className="mx-auto mb-4 h-8 w-8 text-primary" aria-hidden="true" /><h3 className="text-xl font-semibold">{t('searchModern.errorTitle', 'We could not load the listings')}</h3>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">{locale === 'el' ? t('searchModern.errorDescription', 'We could not load listings. Try again or clear your search filters.') : error}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3"><Button onClick={retry} className="h-12 rounded-xl">{t('common.retry', 'Try again')}</Button><Button variant="outline" onClick={() => state.reset()} className="h-12 rounded-xl">{t('searchModern.reset', 'Reset filters')}</Button></div>
        </div>
        : results.length === 0 ? <div className="needs-search-empty">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/5 text-primary"><Search className="h-6 w-6" aria-hidden="true" /></div>
          <h3 className="text-xl font-semibold">{t('searchModern.emptyTitle', 'A fresh search could help.')}</h3>
          <p role="status" className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">{t('searchModern.emptyDescription', 'No listings match your search. Try fewer keywords, remove a tag or widen the distance.')}</p>
          <Button variant="outline" className="mt-6 h-12 rounded-xl" onClick={() => state.reset()}>{t('searchModern.clearFilters', 'Clear search and filters')}</Button>
        </div>
        : <div className="needs-search-result-list">{results.map((listing, index) => <ListingCard key={listing.id} listing={listing} index={index} />)}</div>}

      {!isLoading && !error && data && (data.pagination.totalPages > 1 || state.page.value > 1) && <nav aria-label={t('searchModern.pagination', 'Search result pages')} className="needs-search-pagination">
        <Button variant="outline" className="h-11 rounded-xl" disabled={state.page.value <= 1} onClick={() => state.page.set(Math.min(state.page.value - 1, data.pagination.totalPages || 1))}><ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />{t('common.previous', 'Previous')}</Button>
        <span className="px-2 text-sm text-muted-foreground">{t('searchModern.pageCount', 'Page {page} of {pages}').replace('{page}', String(state.page.value)).replace('{pages}', String(Math.max(1, data.pagination.totalPages)))}</span>
        <Button variant="outline" className="h-11 rounded-xl" disabled={state.page.value >= data.pagination.totalPages} onClick={() => state.page.set(state.page.value + 1)}>{t('common.next', 'Next')}<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></Button>
      </nav>}
    </section>
    <SearchMap listings={results} isLoading={isLoading} />
  </div>;
}
