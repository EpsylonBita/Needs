'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/auth-context'
import { useI18n } from '@/contexts/i18n-context'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getMyListing, type OwnedListing } from '@/lib/services/listing-service'
import { setMainListingImage, deleteListingImage, uploadListingImages, LISTING_IMAGE_TYPES, LISTING_IMAGE_MAX_BYTES, LISTING_IMAGE_BATCH_LIMIT } from '@/lib/services/storage-service'

const copies = {
  en: {
    title: 'Listing photos', back: 'View listing', edit: 'Edit details', intro: 'Add photos and choose the main image shown on your listing.',
    loading: 'Loading photos…', unavailable: 'Your listing could not be loaded. It may be unavailable or belong to another account.', retry: 'Try again', signIn: 'Sign in to manage your photos.',
    empty: 'No photos yet', hint: 'Choose up to 20 photos at a time: JPG, PNG, WebP or GIF, up to 5 MB each.', select: 'Choose photos', upload: 'Upload photos', uploading: 'Saving…', clear: 'Clear selection',
    main: 'Main photo', makeMain: 'Set as main', remove: 'Delete photo', photo: 'Listing photo', preview: 'Selected photo', invalid: 'Choose JPG, PNG, WebP or GIF files up to 5 MB each.',
    batchError: 'Choose up to 20 photos at a time.', loadError: 'The latest photos could not be loaded. Refresh before making more changes.', actionError: 'The photo change could not be saved. Check the latest photos before trying again.', saved: 'Photos updated.',
    deleteTitle: 'Delete this photo?', deleteHint: 'This removes the photo from your listing.', cancel: 'Cancel', deleting: 'Deleting…',
    hold: 'Photo changes are unavailable while this listing is under review. Its existing photos remain visible here.', locked: 'Photos cannot be changed for this listing right now.',
  },
  el: {
    title: 'Φωτογραφίες αγγελίας', back: 'Προβολή αγγελίας', edit: 'Επεξεργασία στοιχείων', intro: 'Πρόσθεσε φωτογραφίες και επίλεξε την κύρια εικόνα της αγγελίας σου.',
    loading: 'Φόρτωση φωτογραφιών…', unavailable: 'Η αγγελία σου δεν φορτώθηκε. Ίσως δεν είναι διαθέσιμη ή ανήκει σε άλλον λογαριασμό.', retry: 'Δοκίμασε ξανά', signIn: 'Συνδέσου για να διαχειριστείς τις φωτογραφίες σου.',
    empty: 'Δεν υπάρχουν φωτογραφίες ακόμη', hint: 'Επίλεξε έως 20 φωτογραφίες κάθε φορά: JPG, PNG, WebP ή GIF, έως 5 MB η καθεμία.', select: 'Επιλογή φωτογραφιών', upload: 'Ανέβασμα φωτογραφιών', uploading: 'Αποθήκευση…', clear: 'Καθαρισμός επιλογής',
    main: 'Κύρια φωτογραφία', makeMain: 'Ορισμός ως κύρια', remove: 'Διαγραφή φωτογραφίας', photo: 'Φωτογραφία αγγελίας', preview: 'Επιλεγμένη φωτογραφία', invalid: 'Επίλεξε αρχεία JPG, PNG, WebP ή GIF έως 5 MB το καθένα.',
    batchError: 'Επίλεξε έως 20 φωτογραφίες κάθε φορά.', loadError: 'Οι νεότερες φωτογραφίες δεν φορτώθηκαν. Ανανέωσε πριν κάνεις άλλες αλλαγές.', actionError: 'Η αλλαγή φωτογραφίας δεν αποθηκεύτηκε. Έλεγξε τις νεότερες φωτογραφίες πριν δοκιμάσεις ξανά.', saved: 'Οι φωτογραφίες ενημερώθηκαν.',
    deleteTitle: 'Διαγραφή αυτής της φωτογραφίας;', deleteHint: 'Η φωτογραφία θα αφαιρεθεί από την αγγελία σου.', cancel: 'Ακύρωση', deleting: 'Διαγραφή…',
    hold: 'Οι αλλαγές φωτογραφιών δεν είναι διαθέσιμες όσο η αγγελία βρίσκεται υπό έλεγχο. Οι υπάρχουσες φωτογραφίες εμφανίζονται εδώ.', locked: 'Οι φωτογραφίες αυτής της αγγελίας δεν μπορούν να αλλάξουν αυτή τη στιγμή.',
  },
}
type Selection = { file: File; preview: string }

export default function ListingImagesPage() {
  const params = useParams<{ id: string | string[] }>()
  const id = Array.isArray(params.id) ? params.id[0] : params.id
  const { user, isInitialized } = useAuth()
  const { locale } = useI18n()
  const copy = copies[locale === 'el' ? 'el' : 'en']
  const query = useQuery({ queryKey: ['my-listing', user?.id, id], queryFn: ({ signal }) => getMyListing(id, user!.id, signal), enabled: isInitialized && !!user?.id && !!id, retry: false })
  return <main className="mx-auto w-full max-w-4xl px-4 pb-16 pt-7 sm:px-6">
    <Link href={`/dashboard/listings/${encodeURIComponent(id)}`} className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">← {copy.back}</Link>
    <header className="mb-6 mt-3"><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{copy.title}</h1><p className="mt-2 text-sm text-muted-foreground">{copy.intro}</p></header>
    {!isInitialized || (user && query.isPending) ? <p role="status">{copy.loading}</p> : !user ? <p>{copy.signIn}</p>
      : !query.data ? <div role="alert" className="space-y-3 rounded-xl border p-5"><p>{copy.unavailable}</p><Button variant="outline" onClick={() => { void query.refetch() }}>{copy.retry}</Button></div>
        : <ImageManager key={`${user.id}:${id}`} listing={query.data} userId={user.id} />}
  </main>
}

function ImageManager({ listing, userId }: { listing: OwnedListing; userId: string }) {
  const { locale } = useI18n()
  const copy = copies[locale === 'el' ? 'el' : 'en']
  const client = useQueryClient()
  const [selection, setSelection] = useState<Selection[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [deleting, setDeleting] = useState<OwnedListing['images'][number] | null>(null)
  const current = useRef(false)
  const selected = useRef<Selection[]>([])
  const input = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => { current.current = true; return () => { current.current = false } }, [])
  useEffect(() => () => { selected.current.forEach(value => URL.revokeObjectURL(value.preview)) }, [])

  function clear() {
    selected.current.forEach(value => URL.revokeObjectURL(value.preview))
    selected.current = []
    setSelection([])
    if (input.current) input.current.value = ''
  }
  function choose(files: FileList | null) {
    if (busy || !listing.can_edit_images) return
    const next = Array.from(files || [])
    clear()
    setNotice('')
    if (next.length > LISTING_IMAGE_BATCH_LIMIT) { setError(copy.batchError); return }
    if (next.some(file => !LISTING_IMAGE_TYPES.some(type => type === file.type) || file.size <= 0 || file.size > LISTING_IMAGE_MAX_BYTES)) { setError(copy.invalid); return }
    selected.current = next.map(file => ({ file, preview: URL.createObjectURL(file) }))
    setSelection(selected.current)
    setError('')
  }
  async function persist(action: () => Promise<unknown>, uploaded = false) {
    if (busy || !listing.can_edit_images) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      if (!current.current) return
      if (uploaded) clear()
      setDeleting(null)
      await Promise.all([
        client.invalidateQueries({ queryKey: ['my-listing', userId, listing.id] }),
        client.invalidateQueries({ queryKey: ['my-listings', userId] }),
        client.invalidateQueries({ queryKey: ['profile-overview', userId] }),
      ])
      if (current.current) setNotice(copy.saved)
    } catch {
      if (current.current) {
        setError(copy.actionError)
        // A response can be lost after persistence; refresh the gallery without losing the selected files.
        await client.invalidateQueries({ queryKey: ['my-listing', userId, listing.id] })
      }
    } finally { if (current.current) setBusy(false) }
  }

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-medium">{listing.title}</h2><Button asChild variant="outline"><Link href={`/dashboard/listings/${encodeURIComponent(listing.id)}/edit`}>{copy.edit}</Link></Button></div>
    {!listing.can_edit_images && <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm leading-6">{listing.moderation_suspended ? copy.hold : copy.locked}</p>}
    {listing.can_edit_images && <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <label htmlFor="listing-photos" className="block text-sm font-medium">{copy.select}</label>
      <p id="listing-photos-hint" className="text-xs text-muted-foreground">{copy.hint}</p>
      <input ref={input} id="listing-photos" type="file" multiple accept={LISTING_IMAGE_TYPES.join(',')} aria-describedby="listing-photos-hint" disabled={busy} onChange={event => choose(event.target.files)} className="block w-full min-w-0 rounded-lg border border-input p-3 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2 file:text-foreground" />
      {selection.length > 0 && <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{selection.map((value, index) => <div key={value.preview} className="min-w-0"><div className="relative aspect-square"><Image src={value.preview} alt={`${copy.preview} ${index + 1}`} fill unoptimized sizes="(max-width: 640px) 40vw, 160px" className="rounded-lg object-cover" /></div><p className="mt-1 truncate text-xs text-muted-foreground">{value.file.name}</p></div>)}</div>}
      <div className="flex flex-wrap gap-2"><Button disabled={busy || !selection.length} onClick={() => { void persist(() => uploadListingImages(listing.id, selection.map(value => value.file), userId), true) }}>{busy ? copy.uploading : copy.upload}</Button>{selection.length > 0 && <Button variant="outline" disabled={busy} onClick={clear}>{copy.clear}</Button>}</div>
    </section>}
    {error && !deleting && <p role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    {listing.images.length === 0 ? <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{copy.empty}</p> : <div className="grid grid-cols-1 gap-4 min-[400px]:grid-cols-2 md:grid-cols-3">
      {listing.images.map((image, index) => <article key={image.id} className="min-w-0 space-y-3 rounded-xl border bg-card p-3">
        <div className="relative aspect-[4/3]"><Image src={image.url} alt={`${copy.photo} ${index + 1}`} fill unoptimized sizes="(max-width: 640px) 80vw, 260px" className="rounded-lg object-cover" /></div>
        {image.main && <p className="text-xs font-medium text-primary">{copy.main}</p>}
        {listing.can_edit_images && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy || image.main} onClick={() => { void persist(() => setMainListingImage(listing.id, image.id, userId)) }}>{copy.makeMain}</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => { setError(''); setDeleting(image) }}>{copy.remove}</Button></div>}
      </article>)}
    </div>}
    <Dialog open={!!deleting && listing.can_edit_images} onOpenChange={open => { if (!open && !busy) setDeleting(null) }}>
      <DialogContent closeLabel={copy.cancel} closeDisabled={busy} className="w-[calc(100%-2rem)] max-w-md rounded-2xl p-6 sm:rounded-2xl">
        <DialogHeader className="pr-8 text-left"><DialogTitle>{copy.deleteTitle}</DialogTitle><DialogDescription>{copy.deleteHint}</DialogDescription></DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setDeleting(null)}>{copy.cancel}</Button><Button disabled={busy} onClick={() => { if (deleting) void persist(() => deleteListingImage(listing.id, deleting.id, undefined, userId)) }}>{busy ? copy.deleting : copy.remove}</Button></div>
      </DialogContent>
    </Dialog>
  </div>
}
