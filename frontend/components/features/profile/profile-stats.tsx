'use client'

import Link from 'next/link'
import { Star, MessageSquare, Package, Bell } from 'lucide-react'
import { useI18n } from '@/contexts/i18n-context'
import { useProfileOverview } from './use-profile-overview'
import { profileOverviewCopy } from './profile-overview-copy'
import { OverviewState } from './overview-state'
import styles from './profile.module.css'

export function ProfileStats() {
  const overview = useProfileOverview()
  const { locale, formatNumber } = useI18n()
  const copy = profileOverviewCopy[locale === 'el' ? 'el' : 'en']
  const stats = overview.data ? [
    { label: copy.activeListings, value: overview.data.activeListings, icon: Package, description: copy.activeHint, href: '/dashboard/listings' },
    { label: copy.conversations, value: overview.data.conversations, icon: MessageSquare, description: copy.chatsHint, href: '/chat' },
    { label: copy.receivedReviews, value: overview.data.receivedReviews, icon: Star, description: copy.reviewsHint, href: '/profile?tab=reviews' },
    { label: copy.unreadNotifications, value: overview.data.unreadNotifications, icon: Bell, description: copy.notificationsHint, href: '/dashboard/notifications' },
  ] : []
  return <OverviewState overview={overview}>
    <div className={styles.metrics}>{stats.map(stat => <Link key={stat.label} href={stat.href} className={styles.metric}>
      <span className={styles.metricLabel}><stat.icon aria-hidden="true" />{stat.label}</span>
      <strong>{formatNumber(stat.value)}</strong>
      <span className={styles.metricHint}>{stat.description}</span>
    </Link>)}</div>
  </OverviewState>
}
