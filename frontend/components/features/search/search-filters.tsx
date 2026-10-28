'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { Loader2, LocateFixed, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/contexts/i18n-context';
import { getSearchResetGeneration, useSearchState } from '@/hooks/use-search-state';
import { getCurrentLocation } from '@/lib/services/location-service';
import { searchCenter } from '@/lib/search/location';

export default function SearchFilters({ fixedCategory, showLocationControl = true }: { fixedCategory?: 'Items' | 'Services'; showLocationControl?: boolean }) {
  const { category, subcategory, tags, distance, coordinates, reset } = useSearchState();
  const { t } = useI18n();
  const id = useId();
  const mounted = useRef(false);
  const request = useRef(0);
  const pending = useRef(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current += 1; };
  }, []);

  async function locate() {
    if (pending.current) return;
    const current = ++request.current;
    const resetGeneration = getSearchResetGeneration();
    pending.current = true;
    setLocating(true);
    setLocationError(false);
    try {
      const location = await getCurrentLocation();
      if (!mounted.current || current !== request.current || resetGeneration !== getSearchResetGeneration()) return;
      if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng) || Math.abs(location.lat) > 90 || Math.abs(location.lng) > 180) throw new Error('Invalid location');
      await coordinates.set(`${location.lng},${location.lat}`);
    } catch {
      if (mounted.current && current === request.current && resetGeneration === getSearchResetGeneration()) setLocationError(true);
    } finally {
      if (mounted.current && current === request.current) { pending.current = false; setLocating(false); }
    }
  }

  function cancelLocation() {
    request.current += 1;
    pending.current = false;
    setLocating(false);
    setLocationError(false);
  }
  const selectedCategory = fixedCategory || category.value;
  const subcategories = selectedCategory === 'Items'
    ? [['Sell', t('searchModern.sell', 'Sell')], ['Buy', t('searchModern.buy', 'Buy')], ['Free', t('searchModern.free', 'Free')]]
    : [['I want', t('searchModern.want', 'I want')], ['I will', t('searchModern.will', 'I will')], ['I can', t('searchModern.can', 'I can')]];
  const selectedSubcategory = subcategories.some(([value]) => value === subcategory.value) ? subcategory.value : '';
  const selectClass = 'h-12 w-full rounded-xl border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60';

  return <div className="needs-search-filter-grid">
    <div className="space-y-2">
      <Label htmlFor={`${id}-category`}>{t('searchModern.category', 'Category')}</Label>
      <select id={`${id}-category`} className={selectClass} value={selectedCategory} disabled={Boolean(fixedCategory)} onChange={event => category.set(event.target.value)}>
        <option value="">{t('searchModern.allCategories', 'All categories')}</option><option value="Items">{t('searchModern.items', 'Items')}</option><option value="Services">{t('searchModern.services', 'Services')}</option>
      </select>
    </div>
    {selectedCategory && <div className="space-y-2">
      <Label htmlFor={`${id}-subcategory`}>{t('searchModern.subcategory', 'Subcategory')}</Label>
      <select id={`${id}-subcategory`} className={selectClass} value={selectedSubcategory} onChange={event => subcategory.set(event.target.value)}><option value="">{t('searchModern.allSubcategories', 'All subcategories')}</option>{subcategories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    </div>}
    {showLocationControl && <div className="space-y-2">
      <Button type="button" variant="outline" disabled={locating} onClick={() => { void locate(); }} aria-describedby={`${id}-location-help`} className="min-h-12 h-auto w-full whitespace-normal rounded-xl py-3">
        {locating ? <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : <LocateFixed className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />}
        {locating ? t('searchModern.locating', 'Finding your location...') : t('searchModern.useLocation', 'Use my location')}
      </Button>
      <p id={`${id}-location-help`} className="text-xs leading-relaxed text-muted-foreground">{coordinates.value ? t('searchModern.locationSelected', 'Distance is measured from your selected location.') : t('searchModern.locationOptional', 'Location is optional. We only request it when you choose this button.')}</p>
      {locationError && <p role="alert" className="text-xs leading-relaxed text-destructive">{t('searchModern.locationError', 'Your location is unavailable. You can keep searching or choose all locations.')}</p>}
      {(coordinates.value || locating) && <Button type="button" variant="ghost" onClick={() => { cancelLocation(); void coordinates.set(null); }} className="min-h-11 h-auto w-full whitespace-normal rounded-xl py-2 text-sm">{t('searchModern.allLocationsAction', 'Search all locations')}</Button>}
    </div>}
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2"><Label htmlFor={`${id}-distance`}>{t('searchModern.distance', 'Distance (km)')}</Label><span className="text-sm font-medium tabular-nums text-primary" aria-hidden="true">{distance.value} km</span></div>
      <input id={`${id}-distance`} type="range" min={1} max={500} step={1} value={distance.value} disabled={!searchCenter(coordinates.value)} onChange={event => distance.set(Number(event.target.value))} aria-valuetext={t('searchModern.distanceValue', '{distance} kilometers').replace('{distance}', String(distance.value))} aria-describedby={`${id}-distance-help`} className="h-11 w-full cursor-pointer accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" />
      <p id={`${id}-distance-help`} className="text-xs leading-relaxed text-muted-foreground">{searchCenter(coordinates.value) ? t('searchModern.distanceHint', 'Distance applies around the selected location.') : t('searchModern.distanceDisabled', 'Choose an area or use your location to enable the radius.')}</p>
    </div>
    <div className="space-y-2">
      <Label htmlFor={`${id}-tags`}>{t('searchModern.tags', 'Tags')}</Label>
      <Input id={`${id}-tags`} placeholder={t('searchModern.tagsPlaceholder', 'e.g. furniture, wood')} value={tags.raw} onChange={event => tags.setRaw(event.target.value)} aria-describedby={`${id}-tags-help`} className="h-12 rounded-xl bg-background" />
      <p id={`${id}-tags-help`} className="text-xs leading-relaxed text-muted-foreground">{t('searchModern.tagsHint', 'Separate tags with commas.')}</p>
    </div>
    <Button type="button" variant="outline" className="h-12 w-full rounded-xl" onClick={() => { cancelLocation(); void reset(); }}><RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />{t('searchModern.reset', 'Reset filters')}</Button>
  </div>;
}
