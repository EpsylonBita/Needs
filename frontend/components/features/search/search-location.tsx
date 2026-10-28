'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { LocateFixed, MapPin, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/contexts/i18n-context';
import { getSearchResetGeneration, useSearchState } from '@/hooks/use-search-state';
import { getCurrentLocation } from '@/lib/services/location-service';
import { searchLocationSuggestions, type LocationSuggestion } from '@/lib/services/location-suggestions';
import { searchCenter } from '@/lib/search/location';

/** Geocoding works independently of WebGL and the map lifecycle. */
export function SearchLocation() {
  const state = useSearchState();
  const { t, locale } = useI18n();
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [places, setPlaces] = useState<LocationSuggestion[]>([]);
  const [busy, setBusy] = useState<'area' | 'location' | null>(null);
  const [message, setMessage] = useState('');
  const revision = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const area = draft ?? state.locationLabel.value;
  useEffect(() => () => { ++revision.current; controller.current?.abort(); }, []);
  // Back/Forward and reset must also invalidate an outstanding geolocation/geocoder request.
  useEffect(() => {
    // URL navigation is an external state change: discard the previous location editor atomically.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    ++revision.current; controller.current?.abort(); setDraft(null); setPlaces([]); setMessage(''); setBusy(null);
  }, [state.coordinates.value, state.locationLabel.value]);

  function cancel() {
    ++revision.current; controller.current?.abort(); setBusy(null); setMessage(''); setPlaces([]);
  }
  async function findArea(event: FormEvent) {
    event.preventDefault();
    if (busy || area.trim().length < 3) return;
    const current = ++revision.current;
    const generation = getSearchResetGeneration();
    const abort = new AbortController(); controller.current = abort;
    const isCurrent = () => current === revision.current && generation === getSearchResetGeneration();
    setBusy('area'); setMessage(''); setPlaces([]);
    const timeout = setTimeout(() => abort.abort(), 10000);
    try {
      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      if (!token) throw new Error('Location provider unavailable');
      const result = await searchLocationSuggestions(area, locale === 'el' ? 'el' : 'en', token, abort.signal);
      if (isCurrent()) { setPlaces(result); if (!result.length) setMessage(t('searchModern.areaEmpty')); }
    } catch { if (isCurrent()) setMessage(t('searchModern.areaError')); }
    finally { clearTimeout(timeout); if (current === revision.current) setBusy(null); }
  }
  async function locate() {
    cancel(); const current = revision.current; const generation = getSearchResetGeneration();
    const isCurrent = () => current === revision.current && generation === getSearchResetGeneration();
    setBusy('location');
    try {
      const point = await getCurrentLocation();
      const coordinates = `${point.lng},${point.lat}`;
      if (!searchCenter(coordinates)) throw new Error('Invalid location');
      if (isCurrent()) { setDraft(null); await state.location.set(coordinates); }
    } catch { if (isCurrent()) setMessage(t('searchModern.locationError')); }
    finally { if (current === revision.current) setBusy(null); }
  }
  return <section className="space-y-2 rounded-xl border border-border bg-card p-4" aria-label={t('searchModern.where')}>
    <form onSubmit={findArea} className="space-y-2">
      <Label htmlFor={id}>{t('searchModern.where')}</Label>
      <div className="flex flex-wrap gap-2">
        <Input id={id} value={area} maxLength={256} autoComplete="off" placeholder={t('searchModern.areaPlaceholder')} aria-describedby={`${id}-help`}
          onChange={event => { cancel(); setDraft(event.target.value); }} className="h-12 min-w-0 flex-1 basis-48" />
        <Button type="submit" variant="outline" disabled={!!busy || area.trim().length < 3} className="h-12"><Search size={16} aria-hidden="true" />{t(busy === 'area' ? 'search.searching' : 'searchModern.findArea')}</Button>
        <Button type="button" variant="outline" onClick={() => { void locate(); }} disabled={!!busy} className="h-auto min-h-12 whitespace-normal"><LocateFixed size={16} className="shrink-0" aria-hidden="true" />{t(busy === 'location' ? 'searchModern.locating' : 'searchModern.useLocation')}</Button>
      </div>
      <p id={`${id}-help`} className="text-xs leading-relaxed text-muted-foreground">{t('searchModern.areaHint')}</p>
    </form>
    {places.length > 0 && <ul aria-label={t('searchModern.chooseArea')} className="divide-y rounded-lg border border-border">{places.map(place => <li key={place.id}>
      <button type="button" onClick={() => { cancel(); setDraft(null); void state.location.set(`${place.coordinates.lng},${place.coordinates.lat}`, place.name); }} className="flex min-h-12 w-full items-center gap-2 rounded-lg p-3 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><MapPin size={16} className="shrink-0" aria-hidden="true" />{place.name}</button>
    </li>)}</ul>}
    {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    {(state.coordinates.value || busy) && <Button type="button" variant="ghost" className="h-auto min-h-11 whitespace-normal" onClick={() => { cancel(); setDraft(null); void state.location.set(null); }}>{t('searchModern.allLocationsAction')}</Button>}
  </section>;
}
