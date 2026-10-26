'use client'

import { useId, useLayoutEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { zodResolver } from '@hookform/resolvers/zod'
import { Camera, Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import * as z from 'zod'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import { useI18n } from '@/contexts/i18n-context'
import { useAuth } from '@/contexts/auth-context'
import { profileService, type ProfileData, type UpdateProfileData } from '@/lib/services/profile-service'
import { profileFormCopy, profileFormError, profilePhotoTypes } from './profile-form-copy'

type ProfileFormData = { fullName: string; email: string; title: string; location: string; bio: string }
interface EditProfileDialogProps {
  defaultValues: Pick<ProfileData, 'fullName' | 'title' | 'email' | 'location' | 'bio' | 'avatar'>
  onUpdate?: (data: ProfileData) => Promise<void> | void
  currentAvatar?: string
}

export function EditProfileDialog({ defaultValues, onUpdate, currentAvatar }: EditProfileDialogProps) {
  const { locale } = useI18n()
  const { user } = useAuth()
  const copy = profileFormCopy[locale === 'el' ? 'el' : 'en']
  const { toast } = useToast()
  const id = useId()
  const photoVersion = useRef(0)
  const editingUserId = useRef<string | undefined>(undefined)
  const currentUserId = useRef(user?.id)
  useLayoutEffect(() => {
    currentUserId.current = user?.id
    return () => { currentUserId.current = undefined }
  }, [user?.id])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(currentAvatar || null)
  const schema = z.object({
    fullName: z.string().trim().min(2, copy.nameError).max(100, copy.nameError),
    email: z.string().trim().email(copy.emailError).max(254, copy.emailError),
    title: z.string().trim().max(100, copy.titleError),
    location: z.string().trim().max(160, copy.locationError),
    bio: z.string().trim().max(1000, copy.bioError),
  })
  const values = (): ProfileFormData => ({
    fullName: defaultValues.fullName || '', email: defaultValues.email || '', title: defaultValues.title || '',
    location: defaultValues.location || '', bio: defaultValues.bio || '',
  })
  const form = useForm<ProfileFormData>({ resolver: zodResolver(schema), defaultValues: values() })

  function changeOpen(next: boolean) {
    if (busy) return
    ++photoVersion.current
    if (next) {
      editingUserId.current = user?.id
      form.reset(values())
      setError('')
      setPhotoFile(null)
      setPhotoPreview(currentAvatar || null)
    }
    setOpen(next)
  }

  function selectPhoto(file?: File) {
    if (!file || busy) return
    const version = ++photoVersion.current
    setError('')
    setPhotoFile(null)
    setPhotoPreview(currentAvatar || null)
    if (!profilePhotoTypes.includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError(copy.invalidImage)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (version !== photoVersion.current) return
      setPhotoPreview(String(reader.result))
      setPhotoFile(file)
    }
    reader.onerror = () => { if (version === photoVersion.current) setError(copy.imageReadError) }
    reader.readAsDataURL(file)
  }

  async function submit(data: ProfileFormData) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const expectedUserId = editingUserId.current
      if (!expectedUserId || currentUserId.current !== expectedUserId) throw new Error('Your session changed. Please try again.')
      const update: UpdateProfileData = { ...data, ...(photoFile ? { avatar: photoFile } : {}) }
      const saved = await profileService.updateProfile(update, expectedUserId)
      if (currentUserId.current !== expectedUserId) throw new Error('Your session changed. Please try again.')
      await onUpdate?.(saved)
      if (currentUserId.current !== expectedUserId) throw new Error('Your session changed. Please try again.')
      toast({ title: copy.saved, description: saved.emailChangePending ? copy.pendingEmail : copy.savedDescription })
      setOpen(false)
    } catch (failure) {
      setError(profileFormError(failure, locale, copy.saveError))
    } finally { setBusy(false) }
  }

  const fields = [
    { name: 'fullName', label: copy.fullName, max: 100, required: true, autoComplete: 'name' },
    { name: 'email', label: copy.email, max: 254, required: true, autoComplete: 'email' },
    { name: 'title', label: copy.title, max: 100, required: false, autoComplete: 'organization-title' },
    { name: 'location', label: copy.location, max: 160, required: false, autoComplete: 'address-level2' },
  ] as const

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button variant="outline" className="min-h-11 rounded-xl">{copy.edit}</Button></DialogTrigger>
    <DialogContent closeLabel={copy.close} closeDisabled={busy} className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[560px] overflow-y-auto rounded-2xl p-5 sm:rounded-2xl sm:p-6">
      <DialogHeader className="pr-8 text-left"><DialogTitle className="text-xl">{copy.edit}</DialogTitle><DialogDescription className="leading-relaxed">{copy.description}</DialogDescription></DialogHeader>
      <form noValidate onSubmit={event => { void form.handleSubmit(submit)(event) }} aria-busy={busy} className="space-y-5">
        <label onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); selectPhoto(event.dataTransfer.files[0]) }} className="relative flex cursor-pointer items-center gap-4 rounded-xl border border-dashed border-border bg-muted/30 p-3 focus-within:ring-2 focus-within:ring-ring">
          <input type="file" accept={profilePhotoTypes.join(',')} disabled={busy} aria-label={copy.uploadAvatar} onChange={event => selectPhoto(event.target.files?.[0])} className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-wait" />
          <span className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-primary">
            {photoPreview ? <Image src={photoPreview} alt={copy.preview} fill sizes="64px" className="object-cover" /> : <Camera className="h-6 w-6" aria-hidden="true" />}
          </span>
          <span className="min-w-0 space-y-1"><span className="block text-sm font-medium">{copy.photo}</span><span className="block text-xs leading-relaxed text-muted-foreground">{copy.chooseImage}<br />{copy.imageHint}</span></span>
        </label>
        <fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-2">
          {fields.map(field => <div key={field.name} className="min-w-0 space-y-2">
            <Label htmlFor={`${id}-${field.name}`}>{field.label}{!field.required && <span className="ml-1 text-xs font-normal text-muted-foreground">({copy.optional})</span>}</Label>
            <Input id={`${id}-${field.name}`} type={field.name === 'email' ? 'email' : 'text'} required={field.required} maxLength={field.max} autoComplete={field.autoComplete}
              aria-invalid={!!form.formState.errors[field.name]} aria-describedby={form.formState.errors[field.name] ? `${id}-${field.name}-error` : field.name === 'email' ? `${id}-email-hint` : undefined}
              className="h-11 rounded-xl" {...form.register(field.name)} />
            {form.formState.errors[field.name] && <p id={`${id}-${field.name}-error`} role="alert" className="text-xs text-destructive">{form.formState.errors[field.name]?.message}</p>}
            {field.name === 'email' && <p id={`${id}-email-hint`} className="text-xs leading-relaxed text-muted-foreground">{copy.emailHint}</p>}
          </div>)}
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`${id}-bio`}>{copy.bio}<span className="ml-1 text-xs font-normal text-muted-foreground">({copy.optional})</span></Label>
            <Textarea id={`${id}-bio`} maxLength={1000} aria-invalid={!!form.formState.errors.bio} aria-describedby={form.formState.errors.bio ? `${id}-bio-error` : undefined} className="min-h-24 resize-y rounded-xl" {...form.register('bio')} />
            {form.formState.errors.bio && <p id={`${id}-bio-error`} role="alert" className="text-xs text-destructive">{form.formState.errors.bio.message}</p>}
          </div>
        </fieldset>
        {error && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm leading-relaxed text-destructive">{error}</p>}
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" disabled={busy} onClick={() => changeOpen(false)} className="min-h-11 rounded-xl">{copy.cancel}</Button>
          <Button type="submit" disabled={busy} className="min-h-11 rounded-xl">{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}{busy ? copy.saving : copy.save}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>
}
