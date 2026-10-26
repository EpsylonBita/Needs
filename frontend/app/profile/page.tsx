'use client'

import { Suspense } from 'react'
import { ErrorBoundary } from '@/components/common/error-boundary'
import { ErrorFallback } from '@/components/common/error-fallbacks'
import { ProtectedRoute } from '@/components/features/auth/protected-route'
import { ProfileHeader } from '@/components/features/profile/profile-header'
import { ProfileShell } from '@/components/features/profile/profile-shell'
import { ProfileStats } from '@/components/features/profile/profile-stats'
import { ProfileTabs } from '@/components/features/profile/profile-tabs'
import { profileUiCopy } from '@/components/features/profile/profile-ui-copy'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useProfile } from '@/contexts/profile-context'
import { useI18n } from '@/contexts/i18n-context'

function ProfilePageContent() {
  const { profile, error, refreshProfile } = useProfile()
  const { locale } = useI18n()
  const copy = profileUiCopy[locale === 'el' ? 'el' : 'en']
  return <ProtectedRoute><ProfileShell>
    <ProfileHeader />
    {error && !profile && <div role="alert" className="rounded-xl border border-destructive/30 p-5 text-sm">
      <p>{copy.profileError}</p><Button variant="outline" className="mt-3" onClick={() => { void refreshProfile() }}>{copy.profileRetry}</Button>
    </div>}
    <ProfileStats />
    <Suspense fallback={<Skeleton className="h-48 w-full rounded-xl" />}><ProfileTabs /></Suspense>
  </ProfileShell></ProtectedRoute>
}

export default function ProfilePage() {
  return <ErrorBoundary fallback={<div className="flex min-h-screen items-center justify-center">
    <ErrorFallback error={new Error('Profile loading error')} resetError={() => window.location.reload()} title="Profile Error" description="There was an error loading your profile. Please refresh the page." />
  </div>}><ProfilePageContent /></ErrorBoundary>
}
