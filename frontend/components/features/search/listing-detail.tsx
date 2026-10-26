'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/auth-context';
import { useProfile } from '@/contexts/profile-context';
import { useI18n } from '@/contexts/i18n-context';
import { useListingSearch } from './use-listing-search';
import { formatPublishedListingPrice } from '@/lib/listings/price-policy';

export function ListingDetail({ id }: { id: string }) {
  const { data, isLoading, error, retry } = useListingSearch(new URLSearchParams({ listingId: id }).toString());
  const { user } = useAuth();
  const { profile, isLoading: profileLoading } = useProfile();
  const { t, locale } = useI18n();
  const listing = data?.listings[0];

  if (isLoading) return <p role="status" className="text-center text-muted-foreground">{t('common.loading', 'Loading...')}</p>;
  if (error) return <div role="alert" className="space-y-4"><p>{error}</p><Button variant="outline" onClick={retry}>{t('common.retry', 'Try again')}</Button></div>;
  if (!listing) return <div className="space-y-4"><h1 className="text-2xl font-bold">{t('listing.unavailable', 'This listing is no longer available.')}</h1><Link href="/search" className="text-primary">{t('search.header', 'Search')}</Link></div>;

  const isOwner = !!profile?.id && profile.id === listing.seller_id;
  const chatPath = isOwner ? '/chat' : `/chat?listing=${encodeURIComponent(listing.id)}`;
  const images = [...(listing.listing_images || [])].sort((a, b) => Number(b.main) - Number(a.main));
  return (
    <div className="p-4 rounded-md bg-card text-card-foreground ring-1 ring-border space-y-4">
      <h1 className="text-2xl font-bold">{listing.title}</h1>
      {images.length > 0 && <div className="grid gap-4 md:grid-cols-2">{images.map((image, index) => (
        <Image key={`${image.url}-${index}`} src={image.url} alt={`${listing.title} ${index + 1}`} width={640} height={480} unoptimized className="w-full rounded-md object-contain" />
      ))}</div>}
      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{listing.description}</p>
      <div className="mt-2 space-y-2">
        <div className="text-sm font-medium">{formatPublishedListingPrice(listing.price, listing.description, locale, listing.main_category, listing.sub_category)}</div>
        {listing.sellerRating !== undefined && <div className="text-xs text-muted-foreground">{t('listing.sellerRating', 'Seller rating:')} {listing.sellerRating.toFixed(2)}</div>}
        <div className="text-xs text-muted-foreground">{listing.main_category} • {listing.sub_category}</div>
        <div className="text-sm text-muted-foreground">{typeof listing.address === 'string' ? listing.address : listing.address?.label}</div>
        {!user && <p className="text-sm text-muted-foreground">{t('listing.loginToChat', 'Please log in to start a chat.')}</p>}
        {user && !profile?.id && <p role="status" className="text-sm text-muted-foreground">{profileLoading
          ? t('listing.profileLoading', locale === 'el' ? 'Φόρτωση προφίλ…' : 'Loading your profile…')
          : t('listing.profileUnavailable', locale === 'el' ? 'Το προφίλ δεν φορτώθηκε. Ανανέωσε τη σελίδα για να συνεχίσεις.' : 'Your profile could not be loaded. Refresh to continue.')}</p>}
        <div className="flex gap-2 pt-2">
          {user && !profile?.id ? <Button disabled>{t('listing.chat', 'Chat')}</Button> : <Button asChild className="inline-flex items-center rounded-md px-3 py-2">
            <Link href={user ? chatPath : `/login?redirectTo=${encodeURIComponent(chatPath)}`}>{isOwner
              ? t('listing.viewConversations', locale === 'el' ? 'Προβολή συνομιλιών' : 'View conversations')
              : t('listing.chat', 'Chat')}</Link>
          </Button>}
          {listing.seller_id && <Button asChild variant="secondary" className="inline-flex items-center rounded-md px-3 py-2">
            <Link href={`/profile/${encodeURIComponent(listing.seller_id)}`}>{t('listing.viewProfile', 'View Profile')}</Link>
          </Button>}
        </div>
      </div>
    </div>
  );
}
