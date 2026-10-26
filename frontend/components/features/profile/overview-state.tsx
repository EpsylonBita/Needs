'use client'

import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/contexts/i18n-context'
import { profileOverviewCopy } from './profile-overview-copy'
import { useProfileOverview } from './use-profile-overview'

export function OverviewState({ overview, children }: { overview: ReturnType<typeof useProfileOverview>; children: ReactNode }) {
  const { locale } = useI18n()
  const copy = profileOverviewCopy[locale === 'el' ? 'el' : 'en']
  if (!overview.authReady) return <p role="status" className="p-4 text-muted-foreground">{copy.loading}</p>
  if (!overview.signedIn) return <p className="p-4 text-muted-foreground">{copy.signIn}</p>
  if (overview.isError) return <div role="alert" className="space-y-3 rounded-lg border p-4"><p>{copy.error}</p><Button variant="outline" onClick={() => { void overview.refetch() }}>{copy.retry}</Button></div>
  if (!overview.data) return <p role="status" className="p-4 text-muted-foreground">{copy.loading}</p>
  return children
}
