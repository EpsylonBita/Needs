'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { LanguageToggle } from '@/components/ui/language-toggle'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { useProfile } from '@/contexts/profile-context'
import { useI18n } from '@/contexts/i18n-context'
import { EditProfileDialog } from './edit-profile-dialog'
import { AccountPrivacySettings } from './account-privacy-settings'
import { profileUiCopy } from './profile-ui-copy'
import styles from './profile.module.css'

export function ProfileSettings() {
  const { profile, isLoading, error, refreshProfile } = useProfile()
  const { locale } = useI18n()
  const copy = profileUiCopy[locale === 'el' ? 'el' : 'en']

  if (!profile) return <section className={styles.panel}>
    {isLoading ? <p role="status" className="text-sm text-muted-foreground">{locale === 'el' ? 'Φόρτωση προφίλ…' : 'Loading your profile…'}</p> : <div className="space-y-3">
      <p role="alert" className="text-sm text-muted-foreground">{copy.profileError}</p>
      <Button variant="outline" onClick={() => { void refreshProfile() }}>{copy.profileRetry}</Button>
    </div>}
  </section>

  const details = [
    [copy.name, profile.fullName], [copy.title, profile.title], [copy.location, profile.location], [copy.bio, profile.bio],
  ]

  return <div className={styles.settings}>
    <section className={styles.panel} aria-labelledby="profile-personal-heading">
      <div className={styles.sectionHeading}>
        <div><h2 id="profile-personal-heading">{copy.personalDetails}</h2><p>{copy.personalHint}</p></div>
        <EditProfileDialog defaultValues={profile} currentAvatar={profile.avatar || undefined} onUpdate={async () => { await refreshProfile() }} />
      </div>
      <dl className={styles.detailGrid}>
        {details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value?.trim() || <span className="text-muted-foreground">{copy.empty}</span>}</dd></div>)}
      </dl>
      {error && <p role="alert" className="mt-4 text-sm text-destructive">{copy.profileError}</p>}
    </section>

    <section className={styles.panel} aria-labelledby="profile-account-heading">
      <div className={styles.sectionHeading}><div><h2 id="profile-account-heading">{copy.account}</h2><p>{copy.accountHint}</p></div></div>
      <div className={styles.settingRow}><div className="min-w-0"><h3>{copy.email}</h3><p className="font-medium text-foreground">{profile.email || copy.empty}</p><p>{copy.emailHint}</p></div></div>
      <div className={styles.settingRow}>
        <div><h3>{copy.password}</h3><p>{copy.passwordHint}</p></div>
        <Button asChild variant="outline" className="min-h-11 rounded-xl"><Link href="/auth/forgot-password">{copy.resetPassword}</Link></Button>
      </div>
    </section>

    <section className={styles.panel} aria-labelledby="profile-preferences-heading">
      <div className={styles.sectionHeading}><h2 id="profile-preferences-heading">{copy.preferences}</h2></div>
      <div className={styles.settingRow}><h3>{copy.language}</h3><LanguageToggle className="min-h-11 rounded-xl border border-border px-4" /></div>
      <div className={styles.settingRow}><h3>{copy.appearance}</h3><ThemeToggle showLabel size="default" className="min-h-11 gap-2 rounded-xl" /></div>
      <div className={styles.settingRow}>
        <div><h3>{copy.notifications}</h3><p>{copy.notificationHint}</p></div>
        <Button asChild variant="outline" className="min-h-11 rounded-xl"><Link href="/dashboard/notifications">{copy.openNotifications}</Link></Button>
      </div>
    </section>
    <AccountPrivacySettings />
  </div>
}
