'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { CalendarDays, Camera, ExternalLink, ImagePlus, Link2, Loader2, Mail, MapPin } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { useProfile } from '@/contexts/profile-context'
import { useI18n } from '@/contexts/i18n-context'
import { EditProfileDialog } from './edit-profile-dialog'
import { UploadPhotoDialog } from './upload-photo-dialog'
import { profileUiCopy } from './profile-ui-copy'
import styles from './profile.module.css'

export function ProfileHeader() {
  const { profile, isLoading, refreshProfile, updateProfile } = useProfile()
  const { locale } = useI18n()
  const { toast } = useToast()
  const copy = profileUiCopy[locale === 'el' ? 'el' : 'en']
  const [photo, setPhoto] = useState<'avatar' | 'cover' | null>(null)

  // Keep the dialogs mounted while an existing profile is being saved.
  if (!profile) return isLoading ? <div role="status" className="flex justify-center py-12"><Loader2 className="animate-spin" aria-label={locale === 'el' ? 'Φόρτωση προφίλ' : 'Loading profile'} /></div> : null

  const publicPath = `/profile/${encodeURIComponent(profile.id)}`
  const joined = profile.createdAt && !Number.isNaN(new Date(profile.createdAt).getTime())
    ? new Intl.DateTimeFormat(locale === 'el' ? 'el-GR' : 'en-GB', { month: 'long', year: 'numeric' }).format(new Date(profile.createdAt)) : null
  const initials = (profile.fullName || copy.member).trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('')

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(new URL(publicPath, window.location.origin).href)
      toast({ title: copy.copied })
    } catch { toast({ title: copy.copyFailed, variant: 'destructive' }) }
  }

  return <section className={styles.identity} aria-label={profile.fullName || copy.member}>
    {profile.coverImage && <div className={styles.cover}>
      <Image src={profile.coverImage} alt={locale === 'el' ? 'Εξώφυλλο προφίλ' : 'Profile cover'} fill sizes="(max-width: 700px) 100vw, 1180px" />
    </div>}
    <div className={styles.identityBody}>
      <button type="button" className={styles.avatarButton} onClick={() => setPhoto('avatar')} aria-label={copy.avatar}>
        <Avatar className={styles.avatar}>
          <AvatarImage src={profile.avatar || undefined} alt={profile.fullName || copy.member} className="object-cover" />
          <AvatarFallback className="bg-primary/10 text-xl font-semibold text-primary">{initials}</AvatarFallback>
        </Avatar>
        <span className={styles.avatarBadge}><Camera size={13} aria-hidden="true" /></span>
      </button>
      <div className={styles.identityText}>
        <h1 className={styles.name}>{profile.fullName || copy.member}</h1>
        {profile.title && <p className={styles.professionalTitle}>{profile.title}</p>}
        <div className={styles.metadata}>
          {profile.location && <span><MapPin aria-hidden="true" />{profile.location}</span>}
          {joined && <span><CalendarDays aria-hidden="true" />{copy.joined} {joined}</span>}
          {profile.email && <span><Mail aria-hidden="true" />{profile.email}</span>}
        </div>
      </div>
      <div className={styles.actions}>
        <EditProfileDialog defaultValues={profile} currentAvatar={profile.avatar || undefined} onUpdate={async () => { await refreshProfile() }} />
        <Button asChild variant="outline"><Link href={publicPath}><ExternalLink size={15} aria-hidden="true" />{copy.publicProfile}</Link></Button>
      </div>
    </div>
    {profile.bio && <p className={styles.bio}>{profile.bio}</p>}
    <div className={styles.photoActions}>
      <Button variant="ghost" size="sm" onClick={() => setPhoto('avatar')}><Camera size={15} aria-hidden="true" />{copy.avatar}</Button>
      <Button variant="ghost" size="sm" onClick={() => setPhoto('cover')}><ImagePlus size={15} aria-hidden="true" />{profile.coverImage ? copy.cover : copy.addCover}</Button>
      <Button variant="ghost" size="sm" onClick={() => { void copyLink() }}><Link2 size={15} aria-hidden="true" />{copy.copyLink}</Button>
    </div>
    <UploadPhotoDialog open={photo === 'avatar'} onOpenChange={open => setPhoto(open ? 'avatar' : null)} type="avatar" currentImage={profile.avatar}
      onUpload={async url => { await updateProfile({ avatar: url }) }} />
    <UploadPhotoDialog open={photo === 'cover'} onOpenChange={open => setPhoto(open ? 'cover' : null)} type="cover" currentImage={profile.coverImage}
      onUpload={async url => { await updateProfile({ coverImage: url }) }} />
  </section>
}
