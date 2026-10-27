"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, Loader2, Sparkles } from 'lucide-react';
import type mapboxgl from 'mapbox-gl';
import { useForm, useWatch } from 'react-hook-form';
import { motion, useReducedMotion } from 'framer-motion';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/contexts/i18n-context';
import { useAuth } from '@/contexts/auth-context';
import { useMap } from '@/hooks/use-map';
import { CATEGORY_STRUCTURE } from '@/lib/constants/categories';
import { createListing, deleteListing, parseListingPrice } from '@/lib/services/listing-service';
import { uploadListingImages, validateListingImages } from '@/lib/services/storage-service';
import { getLocationAreaTag } from '@/lib/services/location-suggestions';
import { witService } from '@/lib/services/wit-service';
import { listingPriceNeedsConfirmation } from '@/lib/listings/price-policy';
import { CategoryTagsPicker } from './category-tags-picker';
import { ImageUploader } from './image-uploader';
import { LocationPicker } from './location-picker';
import { ListingPublished } from './listing-published';
import { PriceGuidance } from './price-guidance';

type FormValues = { title: string; description: string; category: string; subcategory: string; price: string; contactNumber: string; location: string };
type DraftField = 'title' | 'category' | 'subcategory' | 'price' | 'contactNumber' | 'location';
const defaults: FormValues = { title: '', description: '', category: '', subcategory: '', price: '', contactNumber: '', location: '' };
const priceUnits = {
  hour: { el: 'ώρα', en: 'hour', hintEl: 'Ανά ώρα, όπως γράφεις στην περιγραφή. Συμφωνήστε το συνολικό ποσό πριν την πληρωμή.', hintEn: 'Per hour, as stated in your description. Agree the total before payment.' },
  day: { el: 'ημέρα', en: 'day', hintEl: 'Ανά ημέρα, όπως γράφεις στην περιγραφή. Συμφωνήστε το συνολικό ποσό πριν την πληρωμή.', hintEn: 'Per day, as stated in your description. Agree the total before payment.' },
  month: { el: 'μήνα', en: 'month', hintEl: 'Ανά μήνα, όπως γράφεις στην περιγραφή. Συμφωνήστε το συνολικό ποσό πριν την πληρωμή.', hintEn: 'Per month, as stated in your description. Agree the total before payment.' },
};

export function CreateAdDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return open ? <CreateAdForm onOpenChange={onOpenChange} /> : null;
}

function CreateAdForm({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const open = true;
  const { locale } = useI18n();
  const el = locale === 'el';
  const { user } = useAuth();
  const profilePhone = user?.phoneNumber?.trim() ?? '';
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2>(1);
  const reduceMotion = useReducedMotion();
  const photosSection = useRef<HTMLElement>(null);
  const [publishedListing, setPublishedListing] = useState<{ id: string; title: string } | null>(null);
  const [photos, setPhotos] = useState<{ file: File; preview: string }[]>([]);
  const [isReadingPhotos, setIsReadingPhotos] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [analyzedDescription, setAnalyzedDescription] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [savedListingId, setSavedListingId] = useState<string | null>(null);
  const [onboardRequired, setOnboardRequired] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [coordinates, setCoordinates] = useState<[number, number] | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [extracted, setExtracted] = useState<{ tags: string[]; smartTags: string[]; price?: string; priceUnit?: keyof typeof priceUnits; category?: string }>({ tags: [], smartTags: [] });
  const [locationArea, setLocationArea] = useState<string | undefined>();
  const manual = useRef(new Set<DraftField>());
  const [tagEdits, setTagEdits] = useState<{ added: string[]; removed: string[] }>({ added: [], removed: [] });
  const revision = useRef(0);
  const photoRevision = useRef(0);
  const photoBusy = useRef(false);
  const submitting = useRef(false);
  const mapClick = useRef<(event: mapboxgl.MapMouseEvent) => void>(() => {});
  const { map, marker, initializeMap, updateMarker } = useMap();
  const schema = z.object({
    title: z.string().trim().min(3, el ? 'Γράψε έναν τίτλο με τουλάχιστον 3 χαρακτήρες.' : 'Enter a title with at least 3 characters.').max(200),
    description: z.string().trim().min(10, el ? 'Πρόσθεσε λίγες λεπτομέρειες (τουλάχιστον 10 χαρακτήρες).' : 'Add a few details (at least 10 characters).').max(10000),
    category: z.string().min(1, el ? 'Διάλεξε κατηγορία.' : 'Choose a category.'),
    subcategory: z.string().min(1, el ? 'Διάλεξε είδος αγγελίας.' : 'Choose a listing type.'),
    price: z.string().refine(value => { try { parseListingPrice(value); return true; } catch { return false; } }, el ? 'Βάλε έγκυρη τιμή σε ευρώ, π.χ. 25,50.' : 'Enter a valid price in euros, e.g. 25.50.'),
    contactNumber: z.string().trim().max(50).refine(value => !value || /^\+?[\d ()-]{7,25}$/.test(value), el ? 'Έλεγξε τον αριθμό τηλεφώνου.' : 'Check the phone number.'),
    location: z.string().trim().min(3, el ? 'Γράψε την περιοχή σου.' : 'Enter your area.'),
  }).refine(data => !!CATEGORY_STRUCTURE[data.category as keyof typeof CATEGORY_STRUCTURE]?.subcategories.includes(data.subcategory), { path: ['subcategory'], message: el ? 'Διάλεξε έγκυρο είδος για αυτήν την κατηγορία.' : 'Choose a valid type for this category.' })
    .refine(data => { try { return !listingPriceNeedsConfirmation(parseListingPrice(data.price), data.description, data.category, data.subcategory); } catch { return true; } }, { path: ['price'], message: el ? 'Συμπλήρωσε τιμή μεγαλύτερη από 0 για τη χρέωση ανά μονάδα.' : 'Enter a price greater than 0 for this rate.' });
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { ...defaults, contactNumber: profilePhone } });
  const { register, handleSubmit, setValue, getValues, formState: { errors } } = form;
  const description = useWatch({ control: form.control, name: 'description' });
  const title = useWatch({ control: form.control, name: 'title' });
  const isAnalyzing = analyzedDescription !== description;
  const selectedCategory = useWatch({ control: form.control, name: 'category' });
  const selectedSubcategory = useWatch({ control: form.control, name: 'subcategory' });
  const price = useWatch({ control: form.control, name: 'price' });
  const contactNumber = useWatch({ control: form.control, name: 'contactNumber' });
  const locationName = useWatch({ control: form.control, name: 'location' });
  const priceUnit = selectedSubcategory === 'Free' ? undefined : extracted.priceUnit;
  const priceHelp = selectedSubcategory === 'Free' ? (el ? 'Η αγγελία είναι δωρεάν.' : 'This listing is free.')
    : priceUnit ? priceUnits[priceUnit][el ? 'hintEl' : 'hintEn']
      : (el ? 'Προαιρετικό. Συμπλήρωσε τη συνολική τιμή, εφόσον υπάρχει.' : 'Optional. Enter the total price, if applicable.');
  const analysis = useMemo(() => {
    const tags = [...extracted.tags, ...extracted.smartTags].filter(tag => tag !== extracted.price && tag !== extracted.category && !/^\d+(?:[.,]\d+)?€(?:\/.+)?$/u.test(tag));
    if (selectedCategory) tags.push(el ? (selectedCategory === 'Items' ? 'Αντικείμενα' : 'Υπηρεσίες') : selectedCategory);
    if (price.trim()) {
      try { tags.push(`${parseListingPrice(price)}€${priceUnit ? `/${priceUnits[priceUnit][el ? 'el' : 'en']}` : ''}`); } catch { /* An invalid price is never advertised as a tag. */ }
    }
    if (locationArea) tags.push(locationArea);
    return { tags: [], smartTags: [...new Map(tags.filter(tag => tag.trim() && tag.length <= 50).map(tag => [tag.toLocaleLowerCase(), tag])).values()].slice(0, 20) };
  }, [extracted, selectedCategory, price, priceUnit, locationArea, el]);
  const selectedTags = useMemo(() => [...new Map([...tagEdits.added, ...analysis.smartTags.filter(tag => !tagEdits.removed.includes(tag))].map(tag => [tag.toLocaleLowerCase(), tag])).values()].slice(0, 20), [analysis, tagEdits]);
  useEffect(() => { if (open && step === 2 && !publishedListing) form.setFocus('description'); }, [open, step, form, publishedListing]);

  useEffect(() => () => { ++photoRevision.current; ++revision.current; }, []);

  // Inferred values follow the description; explicit edits always win.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await witService.analyzeText(description);
        if (cancelled) return;
        for (const field of ['title', 'price'] as const) {
          if (!manual.current.has(field)) setValue(field, result[field] ?? '');
        }
        if (!manual.current.has('contactNumber')) setValue('contactNumber', result.contactNumber || profilePhone);
        const category = manual.current.has('category') ? getValues('category') : result.category ?? '';
        if (!manual.current.has('category')) setValue('category', category);
        if (!manual.current.has('subcategory')) {
          const valid = category && result.category === category && result.subcategory && CATEGORY_STRUCTURE[category as keyof typeof CATEGORY_STRUCTURE]?.subcategories.includes(result.subcategory);
          setValue('subcategory', valid ? result.subcategory! : '');
        }
        if (getValues('subcategory') === 'Free') setValue('price', '0');
        if (!manual.current.has('location') && getValues('location') !== (result.location ?? '')) {
          ++revision.current; setCoordinates(null); setLocationArea(undefined); setValue('location', result.location ?? '');
        }
        setExtracted({ tags: result.tags, smartTags: result.smartTags, price: result.price, priceUnit: result.priceUnit, category: result.category });
      } catch {
        if (!cancelled) setError(el ? 'Η αυτόματη συμπλήρωση δεν είναι διαθέσιμη. Συμπλήρωσε τα πεδία.' : 'Automatic suggestions are unavailable. You can fill in the fields.');
      } finally { if (!cancelled) setAnalyzedDescription(description); }
    }, description.trim() ? 450 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [description, open, setValue, getValues, el, profilePhone]);

  const changeLocation = (name: string) => {
    manual.current.add('location'); ++revision.current; setIsLocating(false); setCoordinates(null); setLocationArea(undefined);
    setValue('location', name, { shouldDirty: true, shouldValidate: true });
  };
  const selectLocation = (name: string, point: { lat: number; lng: number }, areaTag?: string) => {
    manual.current.add('location'); ++revision.current; setIsLocating(false);
    const selected: [number, number] = [point.lng, point.lat];
    setCoordinates(selected); setLocationArea(areaTag); updateMarker(selected);
    setValue('location', name, { shouldDirty: true, shouldValidate: true });
    map?.flyTo({ center: selected, zoom: 13 });
  };
  const locate = useCallback(async (point: [number, number]) => {
    const current = ++revision.current;
    manual.current.add('location'); setLocationArea(undefined); setCoordinates(point); updateMarker(point); setIsLocating(true);
    try {
      const response = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${point.join(',')}.json?access_token=${process.env.NEXT_PUBLIC_MAPBOX_TOKEN}`);
      if (!response.ok) throw new Error('location');
      const result = await response.json();
      if (current !== revision.current) return;
      if (!result.features?.[0]?.place_name) throw new Error('location');
      setLocationArea(getLocationAreaTag(result.features[0]));
      setValue('location', result.features[0].place_name, { shouldValidate: true });
    } catch {
      if (current === revision.current) setError(el ? 'Δεν βρέθηκε διεύθυνση. Γράψε την περιοχή σου.' : 'Address not found. Enter your area instead.');
    } finally { if (current === revision.current) setIsLocating(false); }
  }, [updateMarker, setValue, el]);
  useEffect(() => { mapClick.current = event => { void locate(event.lngLat.toArray() as [number, number]); }; }, [locate]);
  useEffect(() => {
    if (!showMap || step !== 2) return;
    if (!process.env.NEXT_PUBLIC_MAPBOX_TOKEN) return;
    if (!map) initializeMap('location-map', { center: coordinates ?? [23.7275, 37.9838], zoom: 12, onClick: event => mapClick.current(event) });
    else map.resize();
  }, [showMap, step, map, initializeMap, coordinates, el]);
  useEffect(() => {
    if (!map) return;
    if (coordinates) updateMarker(coordinates);
    else marker?.remove();
  }, [map, marker, coordinates, updateMarker]);
  const geolocate = () => {
    if (!navigator.geolocation) { setError(el ? 'Η συσκευή δεν υποστηρίζει εντοπισμό.' : 'Location is unavailable on this device.'); return; }
    const current = ++revision.current;
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(position => {
      if (current !== revision.current) return;
      void locate([position.coords.longitude, position.coords.latitude]);
    }, () => { if (current !== revision.current) return; setIsLocating(false); setError(el ? 'Δεν ήταν δυνατός ο εντοπισμός. Γράψε την περιοχή σου.' : 'Could not find your location. Enter your area instead.'); }, { timeout: 10000 });
  };

  const addPhotos = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length || photoBusy.current) return;
    setPhotoError(null);
    if (photos.length + files.length > 6) { setPhotoError(el ? 'Μπορείς να προσθέσεις έως 6 φωτογραφίες.' : 'You can add up to 6 photos.'); return; }
    const current = ++photoRevision.current;
    photoBusy.current = true; setIsReadingPhotos(true);
    try {
      await validateListingImages(files);
      const additions = await Promise.all(files.map(file => new Promise<{ file: File; preview: string }>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ file, preview: String(reader.result) });
        reader.onerror = () => reject(new Error('read'));
        reader.readAsDataURL(file);
      })));
      if (current === photoRevision.current) setPhotos(previous => [...previous, ...additions]);
    } catch {
      if (current === photoRevision.current) setPhotoError(el ? 'Διάλεξε έγκυρες εικόνες JPG, PNG, WebP ή GIF έως 5 MB.' : 'Choose valid JPG, PNG, WebP or GIF images up to 5 MB each.');
    } finally { photoBusy.current = false; setIsReadingPhotos(false); }
  };
  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) setTagEdits(previous => ({ added: previous.added.filter(value => value !== tag), removed: [...previous.removed, tag] }));
    else if (selectedTags.length < 20) setTagEdits(previous => ({ added: analysis.smartTags.includes(tag) ? previous.added : [...previous.added, tag], removed: previous.removed.filter(value => value !== tag) }));
  };

  const onSubmit = async (data: FormValues) => {
    if (step !== 2 || submitting.current || isAnalyzing || isLocating || photoBusy.current || savedListingId || publishedListing) return;
    submitting.current = true; setIsSubmitting(true); setError(null); setOnboardRequired(false);
    let createdId: string | undefined;
    const creatingUserId = user?.id;
    try {
      let point = coordinates;
      if (!point) {
        if (!process.env.NEXT_PUBLIC_MAPBOX_TOKEN) throw new Error(el ? 'Η επαλήθευση τοποθεσίας δεν είναι διαθέσιμη.' : 'Location verification is unavailable.');
        const response = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(data.location)}.json?limit=1&access_token=${process.env.NEXT_PUBLIC_MAPBOX_TOKEN}`);
        if (!response.ok) throw new Error(el ? 'Δεν βρέθηκε η περιοχή. Έλεγξε την ονομασία.' : 'Area not found. Check the name.');
        const result = await response.json();
        point = result.features?.[0]?.center ?? null;
        if (!point) throw new Error(el ? 'Δεν βρέθηκε η περιοχή.' : 'Area not found.');
        setCoordinates(point);
      }
      const created = await createListing({ title: data.title, description: data.description, main_category: data.category as 'Items' | 'Services', sub_category: data.subcategory as 'Buy' | 'Sell' | 'Free' | 'I want' | 'I will' | 'I can', price: data.subcategory === 'Free' ? '0' : data.price, tags: selectedTags, coordinates: point, address: { label: data.location }, contact_number: data.contactNumber });
      createdId = created.id;
      if (photos.length) await uploadListingImages(created.id, photos.map(photo => photo.file));
      setPublishedListing({ id: created.id, title: data.title });
    } catch (failure) {
      if (createdId) {
        const failedListingId = createdId;
        try { await deleteListing(createdId); createdId = undefined; }
        catch {
          setSavedListingId(failedListingId);
          setError(el ? 'Η αγγελία αποθηκεύτηκε, αλλά οι φωτογραφίες δεν ολοκληρώθηκαν. Συνέχισε από τις αγγελίες σου.' : `Your listing ${createdId} is saved in My Listings, but photo upload did not complete. Manage its images there.`);
          return;
        }
      }
      const message = failure instanceof Error ? failure.message : String(failure);
      if (message.includes('Seller not onboarded')) {
        setOnboardRequired(true);
        setError(el ? 'Για αγγελίες με πληρωμή χρειάζεται πρώτα ρύθμιση πληρωμών. Η φόρμα σου παραμένει ανοιχτή.' : 'Set up payments before publishing a paid offer. Your draft stays open.');
      } else setError(`${el ? 'Δεν δημιουργήθηκε η αγγελία' : 'Failed to create ad'}: ${message}`);
    } finally {
      if (createdId && creatingUserId) {
        void queryClient.invalidateQueries({ queryKey: ['profile-overview', creatingUserId] });
        void queryClient.invalidateQueries({ queryKey: ['my-listings', creatingUserId] });
      }
      submitting.current = false; setIsSubmitting(false);
    }
  };
  const fieldError = (field: keyof FormValues) => errors[field] ? <p id={`create-${field}-error`} role="alert" className="mt-1 text-sm text-destructive">{errors[field]?.message}</p> : null;
  const fieldA11y = (field: keyof FormValues) => ({ 'aria-invalid': !!errors[field], 'aria-describedby': errors[field] ? `create-${field}-error` : undefined });

  return <Dialog open={open} onOpenChange={value => { if (!submitting.current && !photoBusy.current) onOpenChange(value); }}>
    <DialogContent closeLabel={el ? 'Κλείσιμο' : 'Close'} closeDisabled={isSubmitting || isReadingPhotos} className="flex max-h-[92dvh] w-[calc(100%-1rem)] flex-col gap-3 overflow-hidden rounded-3xl bg-card p-4 text-card-foreground sm:max-w-[640px] sm:gap-4 sm:rounded-3xl sm:p-6" onInteractOutside={event => event.preventDefault()}>
      {publishedListing ? <ListingPublished listing={publishedListing} isGreek={el} onDone={() => onOpenChange(false)} /> : <>
      <DialogHeader className="shrink-0 pr-9 text-left">
        <DialogTitle className="text-xl font-semibold tracking-tight sm:text-2xl">{el ? 'Νέα αγγελία' : 'New listing'}</DialogTitle>
        <DialogDescription className="text-sm leading-5">{el ? 'Λίγα βήματα, και είσαι έτοιμος.' : 'A few details and you’re ready.'}</DialogDescription>
      </DialogHeader>
      <ol aria-label={el ? 'Βήματα αγγελίας' : 'Listing steps'} className="flex shrink-0 items-center border-b border-border pb-3 text-sm sm:pb-4">
        {[el ? 'Φωτογραφίες' : 'Photos', el ? 'Πληροφορίες' : 'Details'].map((label, index) => <li key={label} aria-current={step === index + 1 ? 'step' : undefined} className={`flex min-w-0 items-center gap-2 ${index === 0 ? 'flex-1' : 'shrink-0'} ${step >= index + 1 ? 'text-primary' : 'text-muted-foreground'}`}>
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-200 ${step >= index + 1 ? 'bg-primary text-primary-foreground' : 'border border-border bg-background'}`}>{step > index + 1 ? <motion.span initial={reduceMotion ? false : { scale: 0.7 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 460, damping: 26 }}><Check className="h-3.5 w-3.5" aria-hidden="true" /></motion.span> : index + 1}</span>
          <span className={step === index + 1 ? 'font-semibold' : 'font-medium'}>{label}</span>
          {index === 0 && <span aria-hidden="true" className="mx-3 h-px flex-1 overflow-hidden bg-border sm:mx-5"><motion.span className="block h-full origin-left bg-primary" initial={false} animate={{ scaleX: step === 2 ? 1 : 0 }} transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }} /></span>}
        </li>)}
      </ol>
      <form noValidate onSubmit={event => { void handleSubmit(onSubmit)(event); }} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-2"><fieldset disabled={isSubmitting || !!savedListingId} className="min-w-0">
          {step === 1 && <section ref={photosSection} tabIndex={-1} aria-label={el ? 'Φωτογραφίες αγγελίας' : 'Listing photos'} className="space-y-3 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-200">
            <ImageUploader imagePreviews={photos.map(photo => photo.preview)} onRemove={index => setPhotos(previous => previous.filter((_, i) => i !== index))} onChange={addPhotos} disabled={isReadingPhotos} />
            {isReadingPhotos && <p role="status" className="text-sm text-muted-foreground">{el ? 'Προετοιμασία φωτογραφιών…' : 'Preparing photos…'}</p>}
            {photoError && <p role="alert" className="text-sm text-destructive">{photoError}</p>}
          </section>}
          <section hidden={step !== 2} className="space-y-4 pt-1 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
            <div className="space-y-2">
              <Label htmlFor="create-description" className="text-sm font-semibold">{el ? 'Τι θέλεις να ανεβάσεις;' : 'What would you like to list?'}</Label>
              <Textarea id="create-description" {...register('description')} {...fieldA11y('description')} maxLength={10000} placeholder={el ? 'Π.χ. Πωλώ μεταχειρισμένο ποδήλατο σε καλή κατάσταση, 120€.' : 'E.g. Selling a used bicycle in good condition for 120€.'} className="min-h-24 resize-y rounded-xl bg-background text-base shadow-none" />
              {fieldError('description')}
              <p role="status" aria-live="polite" className="flex items-start gap-1.5 text-xs leading-5 text-muted-foreground"><Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{isAnalyzing ? (el ? 'Συμπληρώνουμε όσα αναγνωρίζουμε…' : 'Filling in recognized details…') : (el ? 'Κατηγορία, είδος, τίτλος, τιμή και tags συμπληρώνονται από το κείμενό σου. Έλεγξέ τα και άλλαξε ό,τι θέλεις.' : 'Category, type, title, price and tags fill from your text. Review them and change anything.')}</p>
            </div>
            <CategoryTagsPicker selectedCategory={selectedCategory} selectedSubcategory={selectedSubcategory} selectedTags={selectedTags} analysis={analysis} isLoadingTags={isAnalyzing} onCategorySelect={value => { manual.current.add('category'); manual.current.add('subcategory'); setValue('category', value, { shouldValidate: true }); setValue('subcategory', ''); }} onSubcategorySelect={value => { manual.current.add('category'); manual.current.add('subcategory'); setValue('subcategory', value, { shouldValidate: true }); if (value === 'Free') { manual.current.add('price'); setValue('price', '0'); } }} onToggleTag={toggleTag} onAddTag={tag => { if (!selectedTags.includes(tag)) toggleTag(tag); }} categoryError={errors.category?.message} subcategoryError={errors.subcategory?.message}>
            <div><Label htmlFor="create-title">{el ? 'Τίτλος' : 'Title'}</Label><Input id="create-title" {...register('title')} onChange={event => { manual.current.add('title'); void register('title').onChange(event); }} {...fieldA11y('title')} maxLength={200} className="mt-1.5 h-11 rounded-xl bg-background text-base shadow-none" />{fieldError('title')}</div>
            <div className="grid gap-4 sm:grid-cols-2">
            <div><Label htmlFor="create-price">{el ? 'Τιμή (€)' : 'Price (€)'}</Label><Input id="create-price" {...register('price')} onChange={event => { manual.current.add('price'); void register('price').onChange(event); }} {...fieldA11y('price')} aria-describedby={`create-price-help${errors.price ? ' create-price-error' : ''}`} disabled={selectedSubcategory === 'Free'} inputMode="decimal" placeholder="0" className="mt-1.5 h-11 rounded-xl bg-background text-base shadow-none" /><p id="create-price-help" className="mt-1 text-xs text-muted-foreground">{priceHelp}</p>{fieldError('price')}{(selectedCategory === 'Items' || selectedCategory === 'Services') && (selectedSubcategory === 'Sell' || selectedSubcategory === 'I will' || selectedSubcategory === 'I can') && <PriceGuidance subject={{ title, description, mainCategory: selectedCategory, subCategory: selectedSubcategory, coordinates }} price={price} />}</div>
            <div><Label htmlFor="create-contact">{el ? 'Τηλέφωνο (προαιρετικό)' : 'Phone (optional)'}</Label><Input id="create-contact" {...register('contactNumber')} onChange={event => { manual.current.add('contactNumber'); void register('contactNumber').onChange(event); }} {...fieldA11y('contactNumber')} type="tel" autoComplete="tel" maxLength={50} className="mt-1.5 h-11 rounded-xl bg-background text-base shadow-none" /><p className="mt-1 text-xs text-muted-foreground">{profilePhone && contactNumber === profilePhone ? (el ? 'Συμπληρώθηκε από το προφίλ σου. Θα εμφανίζεται στην αγγελία· μπορείς να το αλλάξεις ή να το αφαιρέσεις.' : 'Filled from your profile. Visible on your listing; you can change or remove it.') : (el ? 'Θα εμφανίζεται στην αγγελία σου. Μπορείς να επικοινωνείς μόνο με μηνύματα.' : 'Visible on your listing. You can use messages only instead.')}</p>{fieldError('contactNumber')}</div>
            </div>
            </CategoryTagsPicker>
            <LocationPicker locationName={locationName} showMap={showMap} coordinates={coordinates} isLocating={isLocating} errorMessage={errors.location?.message} onLocationNameChange={changeLocation} onLocationSelect={selectLocation} onToggleMap={() => { if (!process.env.NEXT_PUBLIC_MAPBOX_TOKEN) setError(el ? 'Ο χάρτης δεν είναι διαθέσιμος.' : 'The map is unavailable.'); else setShowMap(value => !value); }} onUseCurrentLocation={geolocate} />
          </section>
        </fieldset></div>
        {error && <div role="alert" className="mt-3 max-h-32 shrink-0 overflow-y-auto rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm"><p>{error}</p>{onboardRequired && <a className="mt-2 inline-flex min-h-11 items-center font-medium text-primary underline" href="/payments/onboarding" target="_blank" rel="noopener noreferrer">{el ? 'Ρύθμιση πληρωμών (νέα καρτέλα)' : 'Set up payments (new tab)'}</a>}{savedListingId && <a className="mt-2 inline-flex min-h-11 items-center font-medium text-primary underline" href={`/dashboard/listings/${savedListingId}/images`}>{el ? 'Διαχείριση φωτογραφιών' : 'Manage photos'}</a>}</div>}
        <div className="mt-3 flex shrink-0 items-center justify-between gap-3 border-t border-border pt-3 sm:mt-4 sm:pt-4">
          {step === 1 ? <><span className="text-xs text-muted-foreground">{el ? 'Οι φωτογραφίες είναι προαιρετικές' : 'Photos are optional'}</span><Button type="button" disabled={isReadingPhotos} onClick={event => { event.preventDefault(); setStep(2); }} className="min-h-11 shrink-0 rounded-xl">{photos.length ? (el ? 'Συνέχεια' : 'Continue') : (el ? 'Χωρίς φωτογραφία' : 'Skip photos')}<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></Button></> : <><Button type="button" variant="ghost" disabled={isSubmitting || !!savedListingId} onClick={() => { setStep(1); requestAnimationFrame(() => photosSection.current?.focus()); }} className="min-h-11 rounded-xl"><ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />{el ? 'Πίσω' : 'Photos'}{photos.length > 0 && ` (${photos.length})`}</Button><Button key="publish-listing" type="submit" disabled={isSubmitting || isAnalyzing || isLocating || !!savedListingId} className="min-h-11 rounded-xl">{isSubmitting && <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />}{isSubmitting ? (el ? 'Δημοσίευση…' : 'Publishing…') : (el ? 'Δημοσίευση' : 'Publish listing')}</Button></>}
        </div>
      </form>
      </>}
    </DialogContent>
  </Dialog>;
}
