'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Star } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useI18n } from '@/contexts/i18n-context'
import { DashboardOverview, RecentListings } from './dashboard-overview'
import { OverviewState } from './overview-state'
import { ProfileSettings } from './profile-settings'
import { profileOverviewCopy } from './profile-overview-copy'
import { profileUiCopy } from './profile-ui-copy'
import { useProfileOverview } from './use-profile-overview'
import styles from './profile.module.css'

const tabNames = ['dashboard', 'listings', 'reviews', 'settings'] as const

export function ProfileTabs() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const requested = searchParams.get('tab')
  const tab = tabNames.find(value => value === requested) || 'dashboard'
  const overview = useProfileOverview()
  const { locale, formatDate } = useI18n()
  const copy = profileOverviewCopy[locale === 'el' ? 'el' : 'en']
  const ui = profileUiCopy[locale === 'el' ? 'el' : 'en']
  function changeTab(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', value)
    router.replace(`/profile?${params}`, { scroll: false })
  }

  return <Tabs value={tab} onValueChange={changeTab} className="min-w-0 w-full">
    <TabsList className={styles.tabList} aria-label={locale === 'el' ? 'Ενότητες προφίλ' : 'Profile sections'}>
      {tabNames.map(name => <TabsTrigger key={name} value={name} className={styles.tab}>{copy[name]}</TabsTrigger>)}
    </TabsList>
    <TabsContent value="dashboard" className={styles.tabPanel}>
      <OverviewState overview={overview}>{overview.data && <DashboardOverview data={overview.data} />}</OverviewState>
    </TabsContent>
    <TabsContent value="listings" className={styles.tabPanel}>
      <OverviewState overview={overview}>{overview.data && <RecentListings data={overview.data} />}</OverviewState>
    </TabsContent>
    <TabsContent value="reviews" className={styles.tabPanel}>
      <OverviewState overview={overview}>{overview.data && <section className={styles.panel}>
        <div className={styles.sectionHeading}><div><h2>{copy.recentReviews}</h2><p>{copy.reviewsDescription}</p></div></div>
        {overview.data.reviews.length === 0 ? <div className={styles.empty}><Star aria-hidden="true" /><h3>{copy.noReviews}</h3><p>{ui.noReviewsHint}</p></div> : <ul>
          {overview.data.reviews.map(review => <li key={review.id} className={styles.review}>
            <div><span className={styles.reviewRating}><Star aria-hidden="true" />{review.rating}/5</span><time dateTime={review.created_at}>{formatDate(review.created_at)}</time></div>
            <p>{review.comment || copy.noComment}</p>
          </li>)}
        </ul>}
      </section>}</OverviewState>
    </TabsContent>
    <TabsContent value="settings" className={styles.tabPanel}><ProfileSettings /></TabsContent>
  </Tabs>
}
