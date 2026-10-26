'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { ImageIcon, Loader2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAuth } from '@/contexts/auth-context'
import { useI18n } from '@/contexts/i18n-context'
import { profileService } from '@/lib/services/profile-service'
import { profileFormCopy, profileFormError, profilePhotoTypes } from './profile-form-copy'

interface UploadPhotoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpload: (url: string) => Promise<void> | void
  type: 'avatar' | 'cover'
  currentImage?: string | null
}

export function UploadPhotoDialog(props: UploadPhotoDialogProps) {
  // Each opening starts a fresh selection; a failed save keeps this form mounted.
  return props.open ? <PhotoUploadForm {...props} /> : null
}

function PhotoUploadForm({ onOpenChange, onUpload, type, currentImage }: UploadPhotoDialogProps) {
  const { user } = useAuth()
  const openedUserId = useRef(user?.id)
  const currentUserId = useRef(user?.id)
  useLayoutEffect(() => {
    currentUserId.current = user?.id
    return () => { currentUserId.current = undefined }
  }, [user?.id])
  const { locale } = useI18n()
  const copy = profileFormCopy[locale === 'el' ? 'el' : 'en']
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const readVersion = useRef(0)
  const input = useRef<HTMLInputElement>(null)

  function selectFile(selected?: File) {
    if (!selected || busy) return
    const version = ++readVersion.current
    setError('')
    setFile(null)
    setPreview(null)
    setUploadedUrl(null)
    if (!profilePhotoTypes.includes(selected.type) || selected.size > 5 * 1024 * 1024) {
      setError(copy.invalidImage)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (version !== readVersion.current) return
      setFile(selected)
      setPreview(String(reader.result))
    }
    reader.onerror = () => { if (version === readVersion.current) setError(copy.imageReadError) }
    reader.readAsDataURL(selected)
  }

  async function save() {
    if (!file || busy) return
    if (!user) { setError(copy.signIn); return }
    setBusy(true)
    setError('')
    try {
      const expectedUserId = openedUserId.current
      if (!expectedUserId || currentUserId.current !== expectedUserId) throw new Error('Your session changed. Please try again.')
      // Reuse an uploaded file when only the profile save needs retrying.
      const url = uploadedUrl || (await profileService.uploadPhoto(file, type, expectedUserId)).url
      if (currentUserId.current !== expectedUserId) throw new Error('Your session changed. Please try again.')
      setUploadedUrl(url)
      await onUpload(url)
      if (currentUserId.current !== expectedUserId) throw new Error('Your session changed. Please try again.')
      // The profile persistence owner provides success feedback once.
      onOpenChange(false)
    } catch (failure) {
      setError(profileFormError(failure, locale, copy.photoError))
    } finally { setBusy(false) }
  }

  return <Dialog open onOpenChange={next => { if (!busy) onOpenChange(next) }}>
    <DialogContent closeLabel={copy.close} closeDisabled={busy} className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[440px] overflow-y-auto rounded-2xl p-5 sm:rounded-2xl sm:p-6">
      <DialogHeader className="pr-8 text-left"><DialogTitle className="text-xl">{type === 'avatar' ? copy.avatarTitle : copy.coverTitle}</DialogTitle><DialogDescription>{copy.imageHint}</DialogDescription></DialogHeader>
      <div aria-busy={busy} className="space-y-4">
        <label onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); selectFile(event.dataTransfer.files[0]) }} className="relative flex min-h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-4 focus-within:ring-2 focus-within:ring-ring">
          <input ref={input} type="file" accept={profilePhotoTypes.join(',')} disabled={busy} aria-label={type === 'avatar' ? copy.uploadAvatar : copy.uploadCover} onChange={event => selectFile(event.target.files?.[0])} className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-wait" />
          {preview || currentImage ? <span className={`relative block w-full overflow-hidden ${type === 'avatar' ? 'aspect-square max-w-48 rounded-full' : 'aspect-[3/1] rounded-lg'}`}>
            <Image src={preview || currentImage || ''} alt={copy.preview} fill sizes="(max-width: 480px) 80vw, 380px" className="object-cover" />
          </span> : <ImageIcon className="h-10 w-10 text-primary" aria-hidden="true" />}
          <span className="text-center text-sm text-muted-foreground">{copy.chooseImage}</span>
        </label>
        {file && <Button type="button" variant="ghost" disabled={busy} className="min-h-11 rounded-xl" onClick={() => { ++readVersion.current; setFile(null); setPreview(null); setUploadedUrl(null); setError(''); if (input.current) input.current.value = '' }}><X className="mr-2 h-4 w-4" aria-hidden="true" />{copy.removeSelection}</Button>}
        {error && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm leading-relaxed text-destructive">{error}</p>}
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)} className="min-h-11 rounded-xl">{copy.cancel}</Button>
          <Button disabled={!file || busy} onClick={() => { void save() }} className="min-h-11 rounded-xl">{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}{busy ? copy.saving : copy.save}</Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
}
