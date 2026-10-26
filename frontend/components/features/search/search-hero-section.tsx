'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { ArrowRight, House, LoaderCircle } from 'lucide-react';
import { NewListingButton } from '@/components/features/ads/new-listing-button';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/contexts/i18n-context';
import { useListingSearch } from './use-listing-search';
import { formatPublishedListingPrice } from '@/lib/listings/price-policy';
const Map = dynamic(() => import('@/components/features/map/map-component').then(module => module.Map), {
  ssr: false, loading: () => <div className="h-full animate-pulse bg-muted" />,
});
export function SearchHeroSection() {
  const { t, locale } = useI18n();
  const { data, isLoading, error, retry } = useListingSearch('limit=50');
  const listings = data?.listings || [];
  const results = useMemo(() => (data?.listings || []).flatMap(listing => listing.coordinates ? [{
    id: listing.id, title: listing.title, description: listing.description, price: listing.price,
    location: { coordinates: listing.coordinates, address: typeof listing.address === 'string' ? listing.address : listing.address?.label || '' },
    sellerId: listing.seller_id, sellerRating: listing.sellerRating,
    imageUrl: listing.listing_images?.find(image => image.main)?.url || listing.listing_images?.[0]?.url,
    category: listing.main_category, subcategory: listing.sub_category,
  }] : []), [data]);
  return <section className="needs-discovery" aria-labelledby="discovery-title"><div className="needs-shell">
    <div className="needs-section-heading"><h2 id="discovery-title">{t('modern.neighborhood', 'Discover your neighborhood')}</h2>
      <Link href="/search">{t('modern.allListings', 'All listings')}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></div>
    <div className="needs-discovery-grid">
      <div className="needs-discovery-content" aria-busy={isLoading}>
        {isLoading ? <div role="status" className="needs-empty-state"><LoaderCircle className="h-7 w-7 animate-spin text-primary" aria-hidden="true" /><p>{t('search.searching', 'Searching...')}</p></div>
          : error ? <div role="alert" className="needs-empty-state"><House className="h-10 w-10 text-muted-foreground" aria-hidden="true" /><h3>{t('modern.loadError', 'Listings are temporarily unavailable.')}</h3><Button variant="outline" onClick={retry}>{t('common.retry', 'Try again')}</Button></div>
          : listings.length === 0 ? <div className="needs-empty-state" role="status"><House className="h-12 w-12 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
            <h3>{t('modern.empty.title', 'Your neighborhood is waiting for its first listing.')}</h3>
            <p>{t('modern.empty.description', 'Share something you no longer need or find a local service.')}</p>
            <NewListingButton variant="outline" />
          </div> : <div className="needs-latest-list">{listings.slice(0, 4).map(listing => <Link key={listing.id} href={'/listings/' + encodeURIComponent(listing.id)}>
            <div><h3>{listing.title}</h3><p>{listing.main_category === 'Items' ? t('navbar.items', 'Items') : t('navbar.services', 'Services')}</p></div>
            <strong>{formatPublishedListingPrice(listing.price, listing.description, locale, listing.main_category, listing.sub_category)}</strong><ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>)}</div>}
      </div>
      <div className="needs-discovery-map"><Map results={results} live={false} /></div>
    </div>
  </div></section>;
}
