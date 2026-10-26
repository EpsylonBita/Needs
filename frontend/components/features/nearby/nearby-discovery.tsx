'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { LocateFixed, MapPin, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/contexts/i18n-context';
import { useSearchState } from '@/hooks/use-search-state';
import { searchLocationSuggestions, type LocationSuggestion } from '@/lib/services/location-suggestions';
import { SearchResults } from '@/components/features/search/search-results';

export function NearbyDiscovery() {
  const { locale } = useI18n();
  const language = locale === 'el' ? 'el' : 'en';
  const search = useSearchState();
  const [area, setArea] = useState('');
  const [places, setPlaces] = useState<LocationSuggestion[]>([]);
  const [busy, setBusy] = useState<'area' | 'location' | null>(null);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const pending = useRef(false);
  const revision = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { ++revision.current; controller.current?.abort(); }, []);
  const copy = language === 'el' ? {
    title: 'Κοντά σου', intro: 'Βρες αντικείμενα και υπηρεσίες στη γειτονιά που επιλέγεις.', location: 'Η τοποθεσία μου', locating: 'Εύρεση τοποθεσίας…',
    privacy: 'Η τοποθεσία ζητείται μόνο όταν πατήσεις το κουμπί. Μπορείς επίσης να αναζητήσεις μια περιοχή.', area: 'Πόλη ή περιοχή', find: 'Εύρεση περιοχής', searching: 'Αναζήτηση…',
    choose: 'Επίλεξε περιοχή', empty: 'Δεν βρέθηκε περιοχή. Δοκίμασε άλλη ονομασία.', geoError: 'Δεν ήταν δυνατός ο εντοπισμός. Αναζήτησε την περιοχή σου παρακάτω.',
    areaError: 'Η περιοχή δεν βρέθηκε αυτή τη στιγμή. Δοκίμασε ξανά ή χρησιμοποίησε την τοποθεσία σου.', query: 'Τι ψάχνεις;', category: 'Κατηγορία', all: 'Όλα', items: 'Αντικείμενα', services: 'Υπηρεσίες',
    distance: 'Ακτίνα αναζήτησης', ready: 'Οι αγγελίες εμφανίζονται γύρω από την επιλεγμένη τοποθεσία.', start: 'Επίλεξε μια τοποθεσία για να εμφανιστούν κοντινές αγγελίες και ο χάρτης.', browse: 'Αναζήτηση σε όλες τις περιοχές',
  } : {
    title: 'Nearby', intro: 'Find items and services in the neighbourhood you choose.', location: 'Use my location', locating: 'Finding your location…',
    privacy: 'We request location only when you choose the button. You can also search for an area.', area: 'City or area', find: 'Find area', searching: 'Searching…',
    choose: 'Choose an area', empty: 'No area found. Try another name.', geoError: 'Your location is unavailable. Search for your area below.',
    areaError: 'The area could not be found right now. Try again or use your location.', query: 'What are you looking for?', category: 'Category', all: 'All', items: 'Items', services: 'Services',
    distance: 'Search radius', ready: 'Listings are shown around your selected location.', start: 'Choose a location to see nearby listings and their map.', browse: 'Search all locations',
  };

  function cancel() {
    ++revision.current; controller.current?.abort(); pending.current = false; setBusy(null); setError('');
  }
  async function findArea(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current || area.trim().length < 3) return;
    const current = ++revision.current;
    const abort = new AbortController(); controller.current = abort;
    pending.current = true; setBusy('area'); setError(''); setPlaces([]); setSearched(false);
    const timeout = setTimeout(() => abort.abort(), 10000);
    try {
      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      if (!token) throw new Error('Location search unavailable');
      const result = await searchLocationSuggestions(area, language, token, abort.signal);
      if (current === revision.current) { setPlaces(result); setSearched(true); }
    } catch { if (current === revision.current) setError(copy.areaError); }
    finally { clearTimeout(timeout); if (current === revision.current) { pending.current = false; setBusy(null); } }
  }
  function useLocation() {
    if (pending.current) return;
    if (!navigator.geolocation) { setError(copy.geoError); return; }
    const current = ++revision.current;
    pending.current = true; setBusy('location'); setError(''); setPlaces([]); setSearched(false);
    navigator.geolocation.getCurrentPosition(position => {
      if (current !== revision.current) return;
      const { longitude, latitude } = position.coords;
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) {
        setError(copy.geoError);
      } else { setArea(''); void search.coordinates.set(`${longitude},${latitude}`); }
      pending.current = false; setBusy(null);
    }, () => { if (current === revision.current) { pending.current = false; setBusy(null); setError(copy.geoError); } }, { timeout: 10000, maximumAge: 60000 });
  }
  function selectPlace(place: LocationSuggestion) {
    cancel(); setArea(place.name); setPlaces([]); setSearched(false);
    void search.coordinates.set(`${place.coordinates.lng},${place.coordinates.lat}`);
  }

  return <div className="space-y-7">
    <header><h1 className="text-3xl font-semibold tracking-tight">{copy.title}</h1><p className="mt-2 text-muted-foreground">{copy.intro}</p></header>
    <section className="space-y-4 rounded-2xl border border-border bg-card p-5" aria-label={copy.choose}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center"><Button type="button" onClick={useLocation} disabled={!!busy}><LocateFixed size={18} aria-hidden="true" />{busy === 'location' ? copy.locating : copy.location}</Button><p className="max-w-xl text-xs leading-relaxed text-muted-foreground">{copy.privacy}</p></div>
      <form onSubmit={findArea} className="space-y-2"><Label htmlFor="nearby-area">{copy.area}</Label><div className="flex flex-col gap-2 sm:flex-row">
        <Input id="nearby-area" value={area} maxLength={256} placeholder={language === 'el' ? 'π.χ. Αθήνα, Παγκράτι' : 'e.g. Athens, Pangrati'} onChange={event => { cancel(); setArea(event.target.value); setPlaces([]); setSearched(false); void search.coordinates.set(null); }} className="h-11 min-w-0 flex-1" />
        <Button type="submit" variant="outline" disabled={!!busy || area.trim().length < 3}><Search size={16} aria-hidden="true" />{busy === 'area' ? copy.searching : copy.find}</Button></div>
      </form>
      {places.length > 0 && <div className="space-y-2"><p className="text-sm font-medium">{copy.choose}</p><ul className="divide-y rounded-xl border border-border">{places.map(place => <li key={place.id}><button type="button" onClick={() => selectPlace(place)} className="flex min-h-11 w-full items-start gap-2 rounded-xl p-3 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><MapPin size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{place.name}</button></li>)}</ul></div>}
      {searched && !places.length && <p role="status" className="text-sm text-muted-foreground">{copy.empty}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {search.coordinates.value && <p role="status" className="text-sm text-muted-foreground">{copy.ready}</p>}
    </section>
    {search.coordinates.value ? <>
      <div className="grid gap-4 sm:grid-cols-3"><div className="space-y-2"><Label htmlFor="nearby-query">{copy.query}</Label><Input id="nearby-query" value={search.query.value} onChange={event => { void search.query.set(event.target.value); }} className="h-11" /></div>
        <div className="space-y-2"><Label htmlFor="nearby-category">{copy.category}</Label><select id="nearby-category" value={search.category.value} onChange={event => { void search.category.set(event.target.value); }} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"><option value="">{copy.all}</option><option value="Items">{copy.items}</option><option value="Services">{copy.services}</option></select></div>
        <div className="space-y-2"><Label htmlFor="nearby-distance">{copy.distance}</Label><input id="nearby-distance" type="range" min={1} max={500} value={search.distance.value} onChange={event => { void search.distance.set(Number(event.target.value)); }} aria-valuetext={`${search.distance.value} km`} className="h-11 w-full accent-primary" /><p className="text-xs text-muted-foreground">{search.distance.value} km</p></div>
      </div><SearchResults />
    </> : <div className="rounded-2xl border border-dashed border-border px-5 py-10 text-center"><MapPin className="mx-auto mb-3 text-primary" aria-hidden="true" /><p className="text-muted-foreground">{copy.start}</p><Link href="/search" className="mt-3 inline-flex min-h-11 items-center font-medium text-primary">{copy.browse}</Link></div>}
  </div>;
}
