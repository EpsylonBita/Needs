'use client'

import Link from 'next/link'
import { ArrowRight, Bell, CreditCard, Flag, MessageSquare, Package, ReceiptText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NewListingButton } from '@/components/features/ads/new-listing-button'
import { useI18n } from '@/contexts/i18n-context'
import type { ProfileOverview } from '@/lib/services/profile-overview-service'
import { profileOverviewCopy } from './profile-overview-copy'
import { profileUiCopy } from './profile-ui-copy'
import styles from './profile.module.css'

export function RecentListings({ data }: { data: ProfileOverview }) {
  const { locale, formatCurrency } = useI18n()
  const copy = profileOverviewCopy[locale === 'el' ? 'el' : 'en']
  const ui = profileUiCopy[locale === 'el' ? 'el' : 'en']
  return <section className={styles.panel}>
    <div className={styles.sectionHeading}><div><h2>{copy.recentListings}</h2><p>{copy.listingsHint}</p></div></div>
    {data.listings.length === 0 ? <div className={styles.empty}>
      <Package aria-hidden="true" /><h3>{ui.firstListing}</h3><p>{copy.noListings} {ui.firstListingHint}</p>
      <div className={styles.emptyActions}><NewListingButton /><Link href="/search">{ui.browse}<ArrowRight size={15} aria-hidden="true" /></Link></div>
    </div> : <ul>{data.listings.map(listing => <li key={listing.id} className={styles.listingRow}>
      <div><Link href={`/dashboard/listings/${encodeURIComponent(listing.id)}`}>{listing.title}</Link>
        <small>{listing.moderation_suspended ? copy.held : listing.status === 'active' ? copy.active : listing.status === 'sold' ? copy.sold : copy.paused}</small></div>
      <span>{formatCurrency(Number(listing.price), 'EUR')}</span>
    </li>)}</ul>}
    <Button asChild variant="outline" className="mt-5 min-h-11"><Link href="/dashboard/listings">{copy.manageListings}<ArrowRight size={15} aria-hidden="true" /></Link></Button>
  </section>
}

export function DashboardOverview({ data }: { data: ProfileOverview }) {
  const { locale } = useI18n()
  const copy = profileOverviewCopy[locale === 'el' ? 'el' : 'en']
  const ui = profileUiCopy[locale === 'el' ? 'el' : 'en']
  const links = [
    { href: '/chat', label: copy.openChats, hint: ui.chatsHint, icon: MessageSquare },
    { href: '/dashboard/orders', label: copy.orders, hint: ui.ordersHint, icon: ReceiptText },
    { href: '/dashboard/payments', label: copy.payments, hint: ui.paymentsHint, icon: CreditCard },
    { href: '/dashboard/milestones', label: copy.milestones, hint: ui.milestonesHint, icon: Flag },
    { href: '/dashboard/notifications', label: copy.notifications, hint: ui.notificationsHint, icon: Bell },
  ]
  return <div>
    <div className={styles.sectionHeading}><div><h2>{copy.overview}</h2><p>{copy.overviewHint}</p></div></div>
    <div className={styles.dashboardGrid}>
      <RecentListings data={data} />
      <section className={styles.panel}><div className={styles.sectionHeading}><h2>{ui.quickAccess}</h2></div>
        <nav className={styles.quickLinks} aria-label={ui.quickAccess}>{links.map(item => <Link key={item.href} href={item.href} className={styles.quickLink} aria-label={item.label}>
          <item.icon aria-hidden="true" /><span><strong>{item.label}</strong><small>{item.hint}</small></span><ArrowRight aria-hidden="true" />
        </Link>)}</nav>
      </section>
    </div>
  </div>
}
