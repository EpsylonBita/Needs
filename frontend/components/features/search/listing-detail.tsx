'use client';

import Link from 'next/link';
import { ArrowLeft, MapPin, MessageCircle, Star, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/auth-context';
import { useProfile } from '@/contexts/profile-context';
import { useI18n } from '@/contexts/i18n-context';
import { useListingSearch } from './use-listing-search';
import { ListingGallery } from './listing-gallery';
import { RetailComparison } from './retail-comparison';
import { formatPublishedListingPrice, listingPriceNeedsConfirmation } from '@/lib/listings/price-policy';

export function ListingDetail({ id }: { id: string }) {
  const { data, isLoading, error, retry } = useListingSearch(new URLSearchParams({ listingId: id }).toString());
  const { user } = useAuth();
  const { profile, isLoading: profileLoading } = useProfile();
  const { t, locale } = useI18n();
  const el = locale === 'el';
  const listing = data?.listings[0];
  const backLink = <Link href="/search" className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-primary">
    <ArrowLeft className="h-4 w-4" aria-hidden="true" />{el ? 'Πίσω στην αναζήτηση' : 'Back to search'}
  </Link>;

  if (isLoading) return <div aria-busy="true">
    {backLink}<p role="status" className="sr-only">{t('common.loading', 'Loading...')}</p>
    <div aria-hidden="true" className="grid gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Skeleton className="aspect-[4/3] w-full rounded-2xl" />
      <div className="space-y-5"><Skeleton className="h-4 w-28" /><Skeleton className="h-20 w-full" /><Skeleton className="h-10 w-40" /><Skeleton className="h-5 w-48" /><div className="space-y-3 border-t border-border pt-6"><Skeleton className="h-12 w-full rounded-xl" /><Skeleton className="h-12 w-full rounded-xl" /></div></div>
    </div>
  </div>;
  if (error) return <div>{backLink}<div role="alert" className="space-y-4 py-8"><h1 className="text-2xl font-semibold tracking-tight">{el ? 'Δεν φορτώθηκε η αγγελία' : 'We could not load this listing'}</h1><p className="text-muted-foreground">{error}</p><Button variant="outline" className="h-12 rounded-xl" onClick={retry}>{t('common.retry', 'Try again')}</Button></div></div>;
  if (!listing) return <div>{backLink}<div className="space-y-4 py-8"><h1 className="text-2xl font-semibold tracking-tight">{t('listing.unavailable', el ? 'Αυτή η αγγελία δεν είναι πλέον διαθέσιμη.' : 'This listing is no longer available.')}</h1><p className="text-muted-foreground">{el ? 'Μπορείς να συνεχίσεις την αναζήτησή σου στις υπόλοιπες αγγελίες.' : 'Continue your search to explore other listings.'}</p></div></div>;

  const isOwner = !!profile?.id && profile.id === listing.seller_id;
  const chatPath = isOwner ? '/chat' : `/chat?listing=${encodeURIComponent(listing.id)}`;
  const images = [...(listing.listing_images || [])].sort((a, b) => Number(b.main) - Number(a.main));
  const address = typeof listing.address === 'string' ? listing.address : listing.address?.label;
  const needsPriceConfirmation = listingPriceNeedsConfirmation(listing.price, listing.description, listing.main_category, listing.sub_category);
  const categories: Record<string, string> = {
    Items: t('searchModern.items', el ? 'Αντικείμενα' : 'Items'), Services: t('searchModern.services', el ? 'Υπηρεσίες' : 'Services'),
    Sell: t('searchModern.sell', el ? 'Πώληση' : 'Sell'), Buy: t('searchModern.buy', el ? 'Αγορά' : 'Buy'), Free: t('searchModern.free', el ? 'Δωρεάν' : 'Free'),
    'I want': t('searchModern.want', el ? 'Ζητάω' : 'I want'), 'I will': t('searchModern.will', el ? 'Προσφέρω' : 'I will'), 'I can': t('searchModern.can', el ? 'Μπορώ' : 'I can'),
  };
  const categoryPath = listing.main_category === 'Items' ? '/items' : listing.main_category === 'Services' ? '/services' : '/search';
  return (
    <article className="min-w-0">
      {backLink}
      <div className="grid min-w-0 gap-x-10 gap-y-6 [grid-template-areas:'title'_'gallery'_'actions'_'description'] lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr_auto] lg:[grid-template-areas:'gallery_title'_'gallery_actions'_'description_.']">
        <header className="min-w-0 [grid-area:title]">
          <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground"><Link href={categoryPath} className="font-medium text-primary underline-offset-4 hover:underline">{categories[listing.main_category] || listing.main_category}</Link><span aria-hidden="true">·</span><span>{categories[listing.sub_category] || listing.sub_category}</span></div>
          <h1 className="break-words text-3xl font-semibold leading-[1.15] tracking-tight sm:text-4xl">{listing.title}</h1>
        </header>
        <div className="min-w-0 [grid-area:gallery]"><ListingGallery title={listing.title} images={images} /></div>
        <div className="min-w-0 self-start [grid-area:actions]">
          <p className={`break-words font-semibold text-foreground ${needsPriceConfirmation ? 'text-lg leading-snug tracking-normal sm:text-xl' : 'text-3xl leading-tight tracking-tight sm:text-4xl'}`}>{formatPublishedListingPrice(listing.price, listing.description, locale, listing.main_category, listing.sub_category)}</p>
          {(address || listing.sellerRating !== undefined) && <div className="mt-5 space-y-3 text-sm text-muted-foreground">
            {address && <p className="flex items-start gap-2.5"><MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span className="break-words">{address}</span></p>}
            {listing.sellerRating !== undefined && <p className="flex items-center gap-2.5"><Star className="h-4 w-4 shrink-0" aria-hidden="true" /><span>{t('listing.sellerRating', el ? 'Αξιολόγηση πωλητή:' : 'Seller rating:')} {listing.sellerRating.toFixed(2)}</span></p>}
          </div>}
          <div className="mt-6 flex flex-col gap-3 border-t border-border pt-6">
            {user && !profile?.id ? <Button disabled className="h-12 w-full rounded-xl">{t('listing.chat', el ? 'Συνομιλία' : 'Chat')}</Button> : <Button asChild className="h-12 w-full rounded-xl">
              <Link href={user ? chatPath : `/login?redirectTo=${encodeURIComponent(chatPath)}`}><MessageCircle className="h-4 w-4" aria-hidden="true" />{isOwner
                ? t('listing.viewConversations', el ? 'Προβολή συνομιλιών' : 'View conversations')
                : t('listing.chat', el ? 'Συνομιλία' : 'Chat')}</Link>
            </Button>}
            {listing.seller_id && <Button asChild variant="outline" className="h-12 w-full rounded-xl">
              <Link href={`/profile/${encodeURIComponent(listing.seller_id)}`}><UserRound className="h-4 w-4" aria-hidden="true" />{t('listing.viewProfile', el ? 'Προβολή προφίλ' : 'View Profile')}</Link>
            </Button>}
          </div>
        {!user && <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{t('listing.loginToChat', el ? 'Συνδέσου για να ξεκινήσεις μια συνομιλία.' : 'Please log in to start a chat.')}</p>}
        {user && !profile?.id && <p role="status" className="text-sm text-muted-foreground">{profileLoading
          ? t('listing.profileLoading', locale === 'el' ? 'Φόρτωση προφίλ…' : 'Loading your profile…')
          : t('listing.profileUnavailable', locale === 'el' ? 'Το προφίλ δεν φορτώθηκε. Ανανέωσε τη σελίδα για να συνεχίσεις.' : 'Your profile could not be loaded. Refresh to continue.')}</p>}
        </div>
        <section aria-labelledby="listing-description-heading" className="min-w-0 border-t border-border pt-6 [grid-area:description] lg:mt-2">
          <h2 id="listing-description-heading" className="mb-3 text-xl font-semibold tracking-tight">{t('ad.description', el ? 'Περιγραφή' : 'Description')}</h2>
          <p className="max-w-[65ch] whitespace-pre-wrap break-words text-base leading-7 text-muted-foreground">{listing.description}</p>
        </section>
      </div>
      {listing.main_category === 'Items' && listing.sub_category === 'Sell' && <RetailComparison listingId={listing.id} />}
    </article>
  );
}
