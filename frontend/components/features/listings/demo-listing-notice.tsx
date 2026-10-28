import { demoListingCopy, isDemoListing } from '@/lib/listings/demo-policy'

export function DemoListingNotice({ id, locale }: { id: string; locale: string }) {
  if (!isDemoListing(id)) return null
  const copy = demoListingCopy[locale === 'el' ? 'el' : 'en']
  return <span data-testid="demo-listing-notice" className="inline-flex max-w-full flex-wrap gap-x-1 rounded-md border border-border bg-muted px-2 py-1 text-xs leading-relaxed text-foreground"><strong className="font-semibold">{copy.badge}</strong><span>· {copy.unavailable}</span></span>
}
