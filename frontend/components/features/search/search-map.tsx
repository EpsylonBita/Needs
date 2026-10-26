'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { MapPin } from 'lucide-react';

import { useI18n } from '@/contexts/i18n-context';
import type { SearchListing } from './use-listing-search';

function MapLoading() {
  const { t } = useI18n();
  return <div role="status" className="flex h-full items-center justify-center bg-muted/50 text-sm text-muted-foreground">{t('searchModern.mapLoading', 'Loading map…')}</div>;
}

const Map = dynamic(() => import('@/components/features/map/map-component').then(module => module.Map), {
  ssr: false,
  loading: MapLoading,
});

export function SearchMap({ listings, isLoading }: { listings: SearchListing[]; isLoading: boolean }) {
  const { t } = useI18n();
  const results = useMemo(() => listings.flatMap(listing => {
    const coordinates: unknown = listing.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length !== 2) return [];
    const [longitude, latitude] = coordinates;
    if (typeof longitude !== 'number' || typeof latitude !== 'number' || !Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return [];
    return [{
      id: listing.id,
      title: listing.title,
      description: listing.description,
      price: listing.price,
      sellerId: listing.seller_id,
      sellerRating: listing.sellerRating,
      imageUrl: listing.listing_images?.find(image => image.main)?.url || listing.listing_images?.[0]?.url,
      category: listing.main_category,
      subcategory: listing.sub_category,
      location: {
        coordinates: [longitude, latitude] as [number, number],
        address: typeof listing.address === 'string' ? listing.address : listing.address?.label || '',
      },
    }];
  }), [listings]);

  return <aside className="needs-search-map-panel" aria-label={t('searchModern.mapTitle', 'On the map')}>
    <div className="needs-search-map-heading">
      <MapPin className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <h2 className="font-semibold">{t('searchModern.mapTitle', 'On the map')}</h2>
    </div>
    <div className="needs-search-map-canvas" aria-busy={isLoading}>
      <Map results={results} live={false} />
      {isLoading && <p role="status" className="pointer-events-none absolute bottom-8 left-3 right-3 rounded-xl border border-border/60 bg-background/95 px-4 py-3 text-sm text-muted-foreground shadow-sm">{t('searchModern.mapUpdating', 'Updating locations…')}</p>}
      {!isLoading && listings.length > 0 && results.length === 0 && <p role="status" className="pointer-events-none absolute bottom-8 left-3 right-3 rounded-xl border border-border/60 bg-background/95 px-4 py-3 text-sm text-muted-foreground shadow-sm">{t('searchModern.mapMissingLocations', 'These listings do not have a map location.')}</p>}
    </div>
    <p>{t('searchModern.mapDescription', 'Locations for the listings on this page.')}</p>
  </aside>;
}
