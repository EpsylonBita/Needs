'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ImageIcon, MapPin, X } from 'lucide-react';

import { useI18n } from '@/contexts/i18n-context';
import { formatPublishedListingPrice, listingPriceNeedsConfirmation } from '@/lib/listings/price-policy';

export interface MapListing {
  id: string;
  title: string;
  description: string;
  price?: number;
  imageUrl?: string;
  category?: string;
  subcategory?: string;
  location: { coordinates: [number, number]; address: string };
}

export function MapListingPreview({ listing, onClose }: { listing: MapListing; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const imageUrl = listing.imageUrl;
  const safeImage = imageUrl && imageUrl !== failedImage && (/^https?:\/\//i.test(imageUrl) || (imageUrl.startsWith('/') && !imageUrl.startsWith('//'))) ? imageUrl : null;
  const categories: Record<string, string> = {
    Items: t('searchModern.items', 'Items'), Services: t('searchModern.services', 'Services'),
    Sell: t('searchModern.sell', 'Sell'), Buy: t('searchModern.buy', 'Buy'), Free: t('searchModern.free', 'Free'),
    'I want': t('searchModern.want', 'I want'), 'I will': t('searchModern.will', 'I will'), 'I can': t('searchModern.can', 'I can'),
  };
  const price = listing.price === 0 && !listingPriceNeedsConfirmation(listing.price, listing.description, listing.category, listing.subcategory) ? t('map.free', 'Free') : typeof listing.price === 'number' && Number.isFinite(listing.price) ? formatPublishedListingPrice(listing.price, listing.description, locale, listing.category, listing.subcategory) : t('map.priceOnRequest', 'Ask for price');

  return <section className="needs-map-preview" role="dialog" aria-label={listing.title} aria-modal="false">
    <button type="button" className="needs-map-preview-close" aria-label={t('map.close', 'Close')} onClick={onClose}><X aria-hidden="true" className="h-4 w-4" /></button>
    <div className="needs-map-preview-main">
      <div className="needs-map-preview-image">
        {safeImage
          // Listing photos retain their original public storage URLs.
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={safeImage} alt="" onError={() => setFailedImage(safeImage)} />
          : <span><ImageIcon aria-hidden="true" className="h-6 w-6" /><span>{t('map.noPhoto', 'No photo')}</span></span>}
      </div>
      <div className="needs-map-preview-copy">
        {(listing.category || listing.subcategory) && <p className="needs-map-preview-category">{[listing.category, listing.subcategory].filter(Boolean).map(value => categories[value!] || value).join(' · ')}</p>}
        <h3>{listing.title}</h3>
        {listing.location.address && <p className="needs-map-preview-location"><MapPin aria-hidden="true" className="h-3 w-3 shrink-0" /><span>{listing.location.address}</span></p>}
        {listing.description && <p className="needs-map-preview-description">{listing.description}</p>}
      </div>
    </div>
    <div className="needs-map-preview-footer"><strong>{price}</strong><Link href={`/listings/${encodeURIComponent(listing.id)}`}>{t('map.viewListing', 'View listing')}<ArrowUpRight aria-hidden="true" className="h-4 w-4" /></Link></div>
  </section>;
}
