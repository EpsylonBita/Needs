'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { useTheme } from 'next-themes'
import { useAuth } from '@/contexts/auth-context'
import { useI18n } from '@/contexts/i18n-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CATEGORY_STRUCTURE } from '@/lib/constants/categories'
import { getMyListing, updateListing, parseListingPrice, type CreateListingInput, type OwnedListing } from '@/lib/services/listing-service'
import { getListingPriceUnit, listingPriceUnitLabel, listingRequiresAgreedTotal } from '@/lib/listings/price-display'
import { listingPriceNeedsConfirmation } from '@/lib/listings/price-policy'

const copyByLanguage = {
  en: {
    heading: 'Edit listing', intro: 'Keep the details of your listing up to date.', back: 'My listings', preview: 'View listing', photos: 'Manage photos',
    loading: 'Loading your listing…', unavailable: 'Your listing could not be loaded. It may be unavailable or belong to another account.', retry: 'Try again', signIn: 'Sign in to edit your listing.',
    title: 'Title', description: 'Description', category: 'Category', direction: 'Listing type', items: 'Items', services: 'Services', choose: 'Choose a listing type',
    Buy: 'I am looking for an item', Sell: 'I am selling an item', Free: 'I am giving an item away', 'I want': 'I need a service', 'I will': 'I offer a service', 'I can': 'I can help',
    price: 'Price (€)', free: 'Free listings always have a price of €0.', contact: 'Contact number (optional)', tags: 'Tags (optional)', addTag: 'Add tag', removeTag: 'Remove tag',
    location: 'Location', locationHint: 'Enter a place or choose a point on the map. Changing the place updates the map location when you save.', map: 'Choose on map', hideMap: 'Hide map', currentLocation: 'Use my location',
    mapPoint: 'Selected location', locating: 'Finding location…', mapUnavailable: 'The map could not be loaded. You can enter a place above.', locationError: 'The location could not be verified. Enter a place or select a point on the map.',
    save: 'Save changes', saving: 'Saving…', cancel: 'Cancel', saveError: 'The listing could not be saved. Your changes are still here; try again.',
    titleError: 'Enter a title of 3–200 characters.', descriptionError: 'Enter a description of 10–10,000 characters.', categoryError: 'Choose a valid category and listing type.',
    priceError: 'Enter a non-negative price with up to two decimal places.', contactError: 'The contact number must be at most 50 characters.', tagError: 'Use up to 20 tags, each at most 50 characters.', locationLength: 'Enter a location of 3–300 characters.',
    categoryLocked: 'The category, listing type and free/paid status are fixed because this listing has payment, order or review history.', priceLocked: 'The price is fixed while this listing has an active payment or agreed payment milestone.', freePaidLocked: 'This listing has transaction or review history. Keep its existing free or paid status, or create a new listing.',
    moderation: 'This listing is under review. Editing its details does not remove the review or make it public.', cannotEdit: 'This listing cannot currently be edited. You can still view its details.',
  },
  el: {
    heading: 'Επεξεργασία αγγελίας', intro: 'Διατήρησε ενημερωμένα τα στοιχεία της αγγελίας σου.', back: 'Οι αγγελίες μου', preview: 'Προβολή αγγελίας', photos: 'Διαχείριση φωτογραφιών',
    loading: 'Φόρτωση αγγελίας…', unavailable: 'Η αγγελία σου δεν φορτώθηκε. Ίσως δεν είναι διαθέσιμη ή ανήκει σε άλλον λογαριασμό.', retry: 'Δοκίμασε ξανά', signIn: 'Συνδέσου για να επεξεργαστείς την αγγελία σου.',
    title: 'Τίτλος', description: 'Περιγραφή', category: 'Κατηγορία', direction: 'Τύπος αγγελίας', items: 'Αντικείμενα', services: 'Υπηρεσίες', choose: 'Επίλεξε τύπο αγγελίας',
    Buy: 'Ζητάω αντικείμενο', Sell: 'Πουλάω αντικείμενο', Free: 'Χαρίζω αντικείμενο', 'I want': 'Ζητάω υπηρεσία', 'I will': 'Προσφέρω υπηρεσία', 'I can': 'Μπορώ να βοηθήσω',
    price: 'Τιμή (€)', free: 'Οι δωρεάν αγγελίες έχουν πάντα τιμή 0 €.', contact: 'Τηλέφωνο επικοινωνίας (προαιρετικό)', tags: 'Ετικέτες (προαιρετικές)', addTag: 'Προσθήκη ετικέτας', removeTag: 'Αφαίρεση ετικέτας',
    location: 'Τοποθεσία', locationHint: 'Γράψε μια περιοχή ή επίλεξε σημείο στον χάρτη. Η αλλαγή περιοχής ενημερώνει την τοποθεσία κατά την αποθήκευση.', map: 'Επιλογή στον χάρτη', hideMap: 'Απόκρυψη χάρτη', currentLocation: 'Η τοποθεσία μου',
    mapPoint: 'Επιλεγμένη τοποθεσία', locating: 'Εύρεση τοποθεσίας…', mapUnavailable: 'Ο χάρτης δεν φορτώθηκε. Μπορείς να γράψεις την περιοχή παραπάνω.', locationError: 'Η τοποθεσία δεν επαληθεύτηκε. Γράψε μια περιοχή ή επίλεξε σημείο στον χάρτη.',
    save: 'Αποθήκευση αλλαγών', saving: 'Αποθήκευση…', cancel: 'Ακύρωση', saveError: 'Η αγγελία δεν αποθηκεύτηκε. Οι αλλαγές σου παραμένουν εδώ· δοκίμασε ξανά.',
    titleError: 'Συμπλήρωσε τίτλο από 3 έως 200 χαρακτήρες.', descriptionError: 'Συμπλήρωσε περιγραφή από 10 έως 10.000 χαρακτήρες.', categoryError: 'Επίλεξε έγκυρη κατηγορία και τύπο αγγελίας.',
    priceError: 'Συμπλήρωσε μη αρνητική τιμή με έως δύο δεκαδικά ψηφία.', contactError: 'Το τηλέφωνο πρέπει να έχει έως 50 χαρακτήρες.', tagError: 'Πρόσθεσε έως 20 ετικέτες, με έως 50 χαρακτήρες η καθεμία.', locationLength: 'Συμπλήρωσε τοποθεσία από 3 έως 300 χαρακτήρες.',
    categoryLocked: 'Η κατηγορία, ο τύπος και το αν η αγγελία είναι δωρεάν παραμένουν σταθερά επειδή έχει ιστορικό πληρωμών, παραγγελιών ή αξιολογήσεων.', priceLocked: 'Η τιμή παραμένει σταθερή όσο υπάρχει ενεργή πληρωμή ή συμφωνημένο στάδιο πληρωμής.', freePaidLocked: 'Η αγγελία έχει ιστορικό συναλλαγών ή αξιολογήσεων. Διατήρησε το αν είναι δωρεάν ή με χρέωση, ή δημιούργησε νέα αγγελία.',
    moderation: 'Η αγγελία βρίσκεται υπό έλεγχο. Η επεξεργασία δεν καταργεί τον έλεγχο ούτε τη δημοσιεύει.', cannotEdit: 'Η αγγελία δεν μπορεί να τροποποιηθεί αυτή τη στιγμή. Μπορείς να δεις τα στοιχεία της.',
  },
}

const addressLabel = (value: OwnedListing['address']) => typeof value === 'string' ? value : typeof value?.label === 'string' ? value.label : ''
const validPoint = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90

export function ListingEditor({ id }: { id: string }) {
  const { user, isInitialized } = useAuth()
  const { locale } = useI18n()
  const copy = copyByLanguage[locale === 'el' ? 'el' : 'en']
  const query = useQuery({ queryKey: ['my-listing', user?.id, id], queryFn: ({ signal }) => getMyListing(id, user!.id, signal), enabled: isInitialized && !!user?.id, retry: false })
  return <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-7 sm:px-6">
    <Link href="/dashboard/listings" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">← {copy.back}</Link>
    <header className="mb-6 mt-3"><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{copy.heading}</h1><p className="mt-2 text-sm text-muted-foreground">{copy.intro}</p></header>
    {!isInitialized || (user && query.isPending) ? <p role="status">{copy.loading}</p> : !user ? <p>{copy.signIn}</p>
      : query.isError || !query.data ? <div role="alert" className="space-y-3 rounded-xl border p-5"><p>{copy.unavailable}</p><Button variant="outline" onClick={() => { void query.refetch() }}>{copy.retry}</Button></div>
        : <ListingForm key={`${user.id}:${id}`} listing={query.data} userId={user.id} />}
  </main>
}

function ListingForm({ listing, userId }: { listing: OwnedListing; userId: string }) {
  const { locale } = useI18n()
  const copy = copyByLanguage[locale === 'el' ? 'el' : 'en']
  const router = useRouter()
  const client = useQueryClient()
  const [title, setTitle] = useState(listing.title)
  const [description, setDescription] = useState(listing.description)
  const [category, setCategory] = useState(listing.main_category)
  const [direction, setDirection] = useState<string>(listing.sub_category)
  const [price, setPrice] = useState(String(listing.price))
  const [contact, setContact] = useState(listing.contact_number || '')
  const [tags, setTags] = useState(listing.tags)
  const [tagDraft, setTagDraft] = useState('')
  const [address, setAddress] = useState(addressLabel(listing.address))
  const [point, setPoint] = useState<[number, number] | null>(listing.coordinates)
  const [showMap, setShowMap] = useState(false)
  const [busy, setBusy] = useState(false)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState('')
  const [locationError, setLocationError] = useState('')
  const current = useRef(false)
  const locationRevision = useRef(0)
  const locationRequest = useRef<AbortController | null>(null)
  useLayoutEffect(() => {
    const revision = locationRevision
    current.current = true
    return () => { current.current = false; ++revision.current; locationRequest.current?.abort() }
  }, [])
  const previewPath = `/dashboard/listings/${encodeURIComponent(listing.id)}`
  const priceUnit = direction === 'Free' ? undefined : getListingPriceUnit(description)
  const hasRate = direction !== 'Free' && listingRequiresAgreedTotal(description)

  function changeAddress(value: string) {
    ++locationRevision.current
    locationRequest.current?.abort()
    setLocating(false)
    setAddress(value)
    setPoint(null)
    setLocationError('')
  }

  async function selectPoint(selected: [number, number]) {
    if (busy || !validPoint(selected)) return
    const revision = ++locationRevision.current
    locationRequest.current?.abort()
    const controller = new AbortController()
    locationRequest.current = controller
    setPoint(selected)
    setAddress(copy.mapPoint)
    setLocationError('')
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
    if (!token) return
    setLocating(true)
    try {
      const response = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${selected.join(',')}.json?limit=1&access_token=${token}`, { signal: controller.signal })
      if (!response.ok) throw new Error(copy.locationError)
      const data = await response.json()
      if (current.current && revision === locationRevision.current && typeof data.features?.[0]?.place_name === 'string') setAddress(data.features[0].place_name)
    } catch { if (current.current && revision === locationRevision.current) setLocationError(copy.locationError) }
    finally { if (current.current && revision === locationRevision.current) setLocating(false) }
  }

  function locate() {
    if (!navigator.geolocation) { setLocationError(copy.locationError); return }
    const revision = ++locationRevision.current
    locationRequest.current?.abort()
    setLocating(true)
    setLocationError('')
    navigator.geolocation.getCurrentPosition(position => {
      if (!current.current || revision !== locationRevision.current) return
      setLocating(false)
      setShowMap(true)
      void selectPoint([position.coords.longitude, position.coords.latitude])
    }, () => { if (current.current && revision === locationRevision.current) { setLocating(false); setLocationError(copy.locationError) } }, { timeout: 10_000 })
  }

  function addTag() {
    const next = tagDraft.trim()
    if (!next) return
    if (next.length > 50 || (tags.length >= 20 && !tags.includes(next))) { setError(copy.tagError); return }
    setTags(previous => [...new Set([...previous, next])])
    setTagDraft('')
    setError('')
  }

  async function save() {
    if (busy || locating || !listing.can_edit) return
    setError('')
    const cleanTitle = title.trim(), cleanDescription = description.trim(), cleanAddress = address.trim()
    const unchangedLocation = cleanAddress === addressLabel(listing.address).trim()
    const submittedTags = [...new Set([...tags, tagDraft.trim()].filter(Boolean))]
    if (cleanTitle.length < 3 || cleanTitle.length > 200) { setError(copy.titleError); return }
    if (cleanDescription.length < 10 || cleanDescription.length > 10000) { setError(copy.descriptionError); return }
    if (!CATEGORY_STRUCTURE[category]?.subcategories.includes(direction)) { setError(copy.categoryError); return }
    if (contact.trim().length > 50) { setError(copy.contactError); return }
    if (submittedTags.length > 20 || submittedTags.some(tag => tag.length > 50)) { setError(copy.tagError); return }
    if ((!unchangedLocation && cleanAddress.length < 3) || cleanAddress.length > 300) { setError(copy.locationLength); return }
    let amount: number
    try { amount = direction === 'Free' ? 0 : parseListingPrice(price) } catch { setError(copy.priceError); return }
    if (listingPriceNeedsConfirmation(amount, cleanDescription, category, direction)) { setError(locale === 'el' ? 'Συμπλήρωσε τιμή μεγαλύτερη από 0 για τη χρέωση ανά μονάδα.' : 'Enter a price greater than 0 for this rate.'); return }
    if (listing.category_locked && (amount === 0) !== (listing.price === 0)) { setError(copy.freePaidLocked); return }
    setBusy(true)
    try {
      let coordinates = point
      if (!coordinates && !unchangedLocation) {
        const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
        if (!token) throw new Error(copy.locationError)
        const controller = new AbortController()
        locationRequest.current = controller
        const response = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(cleanAddress)}.json?limit=1&access_token=${token}`, { signal: controller.signal })
        if (!response.ok) throw new Error(copy.locationError)
        const data = await response.json()
        if (!validPoint(data.features?.[0]?.center)) throw new Error(copy.locationError)
        coordinates = data.features[0].center
      }
      if (!current.current) return
      const saved = await updateListing(listing.id, {
        title: cleanTitle, description: cleanDescription, main_category: category,
        sub_category: direction as CreateListingInput['sub_category'], price: amount, tags: submittedTags,
        coordinates, address: unchangedLocation ? listing.address : { ...(listing.address && typeof listing.address === 'object' ? listing.address : {}), label: cleanAddress }, contact_number: contact.trim(),
      }, userId)
      if (!current.current) return
      client.setQueryData(['my-listing', userId, listing.id], saved)
      await Promise.all([
        client.invalidateQueries({ queryKey: ['my-listings', userId] }),
        client.invalidateQueries({ queryKey: ['my-listing', userId, listing.id] }),
        client.invalidateQueries({ queryKey: ['profile-overview', userId] }),
      ])
      if (current.current) router.push(previewPath)
    } catch (failure) {
      if (current.current) setError(failure instanceof Error && failure.message === copy.locationError ? copy.locationError : copy.saveError)
    } finally { if (current.current) setBusy(false) }
  }

  if (!listing.can_edit) return <div className="space-y-3 rounded-xl border p-5"><p>{copy.cannotEdit}</p><Button asChild variant="outline"><Link href={previewPath}>{copy.preview}</Link></Button></div>
  return <form noValidate onSubmit={event => { event.preventDefault(); void save() }} className="space-y-6" aria-busy={busy}>
    {listing.moderation_suspended && <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm leading-6">{copy.moderation}</p>}
    <fieldset disabled={busy} className="space-y-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="space-y-2"><Label htmlFor="listing-title">{copy.title}</Label><Input id="listing-title" required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} className="min-h-11" /></div>
      <div className="space-y-2"><Label htmlFor="listing-description">{copy.description}</Label><Textarea id="listing-description" required maxLength={10000} value={description} onChange={event => setDescription(event.target.value)} className="min-h-36" /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="listing-category">{copy.category}</Label><select id="listing-category" disabled={listing.category_locked} value={category} onChange={event => { setCategory(event.target.value as CreateListingInput['main_category']); setDirection('') }} className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"><option value="Items">{copy.items}</option><option value="Services">{copy.services}</option></select></div>
        <div className="space-y-2"><Label htmlFor="listing-direction">{copy.direction}</Label><select id="listing-direction" disabled={listing.category_locked} value={direction} onChange={event => { setDirection(event.target.value); if (event.target.value === 'Free') setPrice('0') }} className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"><option value="">{copy.choose}</option>{CATEGORY_STRUCTURE[category].subcategories.map(value => <option value={value} key={value}>{copy[value as CreateListingInput['sub_category']]}</option>)}</select></div>
      </div>
      {listing.category_locked && <p className="text-sm text-muted-foreground">{copy.categoryLocked}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="listing-price">{copy.price}{priceUnit && ` / ${listingPriceUnitLabel(priceUnit, locale)}`}</Label><Input id="listing-price" inputMode="decimal" disabled={direction === 'Free' || listing.price_locked} value={direction === 'Free' ? '0' : price} onChange={event => setPrice(event.target.value)} aria-describedby={hasRate ? 'listing-price-basis' : undefined} className="min-h-11" />{direction === 'Free' && <p className="text-xs text-muted-foreground">{copy.free}</p>}{hasRate && <p id="listing-price-basis" className="text-xs text-muted-foreground">{locale === 'el' ? 'Χρέωση ανά μονάδα, όπως αναφέρεται στην περιγραφή. Συμφωνήστε συνολικό κόστος στη συνομιλία πριν από online πληρωμή.' : 'Rate per unit, as stated in the description. Agree on a total in chat before online payment.'}</p>}{listing.price_locked && <p className="text-xs text-muted-foreground">{copy.priceLocked}</p>}</div>
        <div className="space-y-2"><Label htmlFor="listing-contact">{copy.contact}</Label><Input id="listing-contact" type="tel" maxLength={50} value={contact} onChange={event => setContact(event.target.value)} className="min-h-11" /></div>
      </div>
      <div className="space-y-3"><Label htmlFor="listing-tag">{copy.tags}</Label><div className="flex flex-col gap-2 sm:flex-row"><Input id="listing-tag" maxLength={50} value={tagDraft} onChange={event => setTagDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addTag() } }} className="min-h-11 w-full min-w-0" /><Button variant="outline" type="button" onClick={addTag} className="sm:shrink-0">{copy.addTag}</Button></div><div className="flex flex-wrap gap-2">{tags.map(tag => <button key={tag} type="button" onClick={() => setTags(previous => previous.filter(value => value !== tag))} aria-label={`${copy.removeTag}: ${tag}`} className="min-h-9 rounded-full bg-muted px-3 text-xs">{tag} ×</button>)}</div></div>
      <div className="space-y-3"><Label htmlFor="listing-location">{copy.location}</Label><Input id="listing-location" required maxLength={300} value={address} onChange={event => changeAddress(event.target.value)} className="min-h-11" /><p className="text-xs leading-5 text-muted-foreground">{copy.locationHint}</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => setShowMap(value => !value)}>{showMap ? copy.hideMap : copy.map}</Button><Button type="button" variant="outline" disabled={locating} onClick={locate}>{locating ? copy.locating : copy.currentLocation}</Button></div>
        {showMap && <ListingLocationMap point={point} onSelect={selectPoint} disabled={busy} unavailable={copy.mapUnavailable} />}
        {locationError && <p role="alert" className="text-sm text-destructive">{locationError}</p>}
      </div>
    </fieldset>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><p className="text-sm text-muted-foreground">{listing.images.length} {locale === 'el' ? 'φωτογραφίες' : 'photos'}</p><Button asChild variant="outline"><Link href={`${previewPath}/images`}>{copy.photos}</Link></Button></div>
    {error && <p role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive">{error}</p>}
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button asChild variant="outline" disabled={busy}><Link href={previewPath} aria-disabled={busy} onClick={event => { if (busy) event.preventDefault() }}>{copy.cancel}</Link></Button><Button type="submit" disabled={busy || locating}>{busy ? copy.saving : copy.save}</Button></div>
  </form>
}

function ListingLocationMap({ point, onSelect, disabled, unavailable }: { point: [number, number] | null; onSelect: (point: [number, number]) => void; disabled: boolean; unavailable: string }) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const marker = useRef<mapboxgl.Marker | null>(null)
  const current = useRef({ point, onSelect, disabled })
  const [failed, setFailed] = useState(false)
  const { resolvedTheme } = useTheme()
  const style = resolvedTheme === 'dark' ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/streets-v12'
  useLayoutEffect(() => { current.current = { point, onSelect, disabled } }, [point, onSelect, disabled])
  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
    if (!container.current || !token) return
    let active = true
    const fail = () => { if (active) setFailed(true) }
    try {
      const instance = new mapboxgl.Map({ container: container.current, accessToken: token, style, center: current.current.point || [23.7275, 37.9838], zoom: 12 })
      const pin = new mapboxgl.Marker({ draggable: !current.current.disabled })
      map.current = instance; marker.current = pin
      if (current.current.point) pin.setLngLat(current.current.point).addTo(instance)
      instance.addControl(new mapboxgl.NavigationControl(), 'top-right')
      instance.on('error', fail)
      instance.on('click', event => { if (!current.current.disabled) current.current.onSelect([event.lngLat.lng, event.lngLat.lat]) })
      pin.on('dragend', () => { if (!current.current.disabled) { const position = pin.getLngLat(); current.current.onSelect([position.lng, position.lat]) } })
      return () => { active = false; pin.remove(); instance.remove(); marker.current = null; map.current = null }
    } catch {
      // Report an external map initialization failure after its setup has unwound.
      queueMicrotask(fail)
      return () => { active = false; marker.current?.remove(); map.current?.remove(); marker.current = null; map.current = null }
    }
  }, [style])
  useEffect(() => {
    marker.current?.setDraggable(!disabled)
    if (!point) { marker.current?.remove(); return }
    if (map.current) { marker.current?.setLngLat(point).addTo(map.current); map.current.flyTo({ center: point }) }
  }, [point, disabled])
  if (failed || !process.env.NEXT_PUBLIC_MAPBOX_TOKEN) return <p role="alert" className="text-sm text-muted-foreground">{unavailable}</p>
  return <div ref={container} className="h-64 w-full overflow-hidden rounded-xl border" />
}
