"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MapPin, Crosshair, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/contexts/i18n-context";
import { searchLocationSuggestions, type LocationSuggestion } from "@/lib/services/location-suggestions";

interface LocationPickerProps {
  locationName: string;
  showMap: boolean;
  coordinates: [number, number] | null;
  isLocating: boolean;
  errorMessage?: string | null;
  onLocationNameChange: (name: string) => void;
  onLocationSelect?: (name: string, coordinates: { lat: number; lng: number }, areaTag?: string) => void;
  onToggleMap: () => void;
  onUseCurrentLocation: () => void;
}

type SearchState = { query: string; status: 'idle' | 'loading' | 'ready' | 'error'; items: LocationSuggestion[] };

export function LocationPicker({ locationName, showMap, coordinates, isLocating, errorMessage, onLocationNameChange, onLocationSelect, onToggleMap, onUseCurrentLocation }: LocationPickerProps) {
  const { t, locale } = useI18n();
  const id = useId();
  const language = locale === 'el' ? 'el' : 'en';
  const [focused, setFocused] = useState(false);
  const [typedQuery, setTypedQuery] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [search, setSearch] = useState<SearchState>({ query: '', status: 'idle', items: [] });
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const copy = language === 'el' ? {
    label: 'Περιοχή', placeholder: 'Γράψε πόλη, περιοχή ή διεύθυνση', hint: 'Γράψε τουλάχιστον 3 χαρακτήρες και επίλεξε μια πρόταση ή συνέχισε χειροκίνητα.',
    suggestions: 'Προτεινόμενες τοποθεσίες', loading: 'Αναζήτηση τοποθεσιών…', empty: 'Δεν βρέθηκε τοποθεσία. Δοκίμασε μια κοντινή πόλη ή συνέχισε χειροκίνητα.',
    error: 'Οι προτάσεις δεν είναι διαθέσιμες. Μπορείς να γράψεις την περιοχή σου ή να επιλέξεις στον χάρτη.',
    count: 'προτάσεις. Χρησιμοποίησε τα βελάκια και Enter για επιλογή.',
  } : {
    label: 'Location', placeholder: 'Enter a city, area or address', hint: 'Type at least 3 characters, then choose a suggestion or continue manually.',
    suggestions: 'Location suggestions', loading: 'Finding locations…', empty: 'No locations found. Try a nearby city or continue manually.',
    error: 'Suggestions are unavailable. You can type your area or choose it on the map.',
    count: 'suggestions. Use the arrow keys and Enter to select.',
  };

  function cancelSearch() {
    request.current += 1;
    controller.current?.abort();
  }

  useEffect(() => {
    if (!focused || dismissed || typedQuery !== locationName || locationName.trim().length < 3) return;
    const current = ++request.current;
    const abort = new AbortController();
    controller.current = abort;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(async () => {
      setSearch({ query: locationName, status: 'loading', items: [] });
      setActiveIndex(-1);
      try {
        if (!token) throw new Error('No location provider');
        timeout = setTimeout(() => abort.abort(), 10000);
        const items = await searchLocationSuggestions(locationName, language, token, abort.signal);
        if (!cancelled && current === request.current) setSearch({ query: locationName, status: 'ready', items });
      } catch {
        if (!cancelled && current === request.current) setSearch({ query: locationName, status: 'error', items: [] });
      } finally { clearTimeout(timeout); }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); clearTimeout(timeout); abort.abort(); };
  }, [focused, dismissed, typedQuery, locationName, language, token]);

  const visible = focused && !dismissed && typedQuery === locationName && locationName.trim().length >= 3 && search.query === locationName;
  const suggestions = visible ? search.items : [];
  const expanded = suggestions.length > 0;
  const active = expanded && activeIndex >= 0 && activeIndex < suggestions.length ? activeIndex : -1;
  const listId = `${id}-suggestions`;
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  useEffect(() => {
    if (active >= 0) optionRefs.current[active]?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  function select(suggestion: LocationSuggestion) {
    cancelSearch();
    setTypedQuery(null); setDismissed(true); setActiveIndex(-1);
    setSearch({ query: '', status: 'idle', items: [] });
    onLocationNameChange(suggestion.name);
    onLocationSelect?.(suggestion.name, suggestion.coordinates, suggestion.areaTag);
  }

  return (
    <div>
      <Label htmlFor="location" className="text-sm font-medium text-foreground">{copy.label}</Label>
      <div className="mt-1.5 space-y-1.5">
        <div className="relative">
          <Input
            id="location" role="combobox" autoComplete="off" spellCheck={false} maxLength={256}
            value={locationName} aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? listId : undefined}
            aria-activedescendant={active >= 0 ? `${id}-option-${active}` : undefined}
            aria-invalid={!!errorMessage} aria-describedby={[helpId, errorMessage ? errorId : ''].filter(Boolean).join(' ')}
            onChange={event => {
              cancelSearch(); setTypedQuery(event.target.value); setDismissed(false); setActiveIndex(-1);
              setSearch({ query: event.target.value, status: 'idle', items: [] });
              onLocationNameChange(event.target.value);
            }}
            onFocus={() => { setFocused(true); setDismissed(false); }}
            onBlur={() => { cancelSearch(); setFocused(false); setActiveIndex(-1); }}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return;
              if (expanded && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                event.preventDefault();
                setActiveIndex(index => event.key === 'ArrowDown' ? (index + 1) % suggestions.length : (index <= 0 ? suggestions.length - 1 : index - 1));
              } else if (expanded && event.key === 'Enter') {
                event.preventDefault(); event.stopPropagation();
                if (active >= 0) select(suggestions[active]);
              } else if (visible && event.key === 'Escape') {
                event.preventDefault(); event.stopPropagation(); cancelSearch(); setDismissed(true); setActiveIndex(-1);
              }
            }}
            placeholder={copy.placeholder}
            className="h-11 rounded-xl border border-input bg-background pr-24 text-base shadow-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="absolute right-px top-0 flex items-center">
            <Button type="button" variant="ghost" size="sm" aria-expanded={showMap} aria-controls="listing-location-map-panel" className="h-11 w-11 rounded-xl p-0 text-primary hover:bg-primary/5 hover:text-primary" onClick={onToggleMap}>
              <MapPin className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">{t('ad.location.toggleMap','Toggle map')}</span>
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-11 w-11 rounded-xl p-0 text-primary hover:bg-primary/5 hover:text-primary" onClick={onUseCurrentLocation} disabled={isLocating}>
              {isLocating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Crosshair className="h-4 w-4" aria-hidden="true" />}
              <span className="sr-only">{t('ad.location.useCurrent','Use current location')}</span>
            </Button>
          </div>
        </div>
        {expanded && <ul id={listId} role="listbox" aria-label={copy.suggestions} className="max-h-60 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-sm">
          {suggestions.map((suggestion, index) => <li key={suggestion.id} role="presentation">
            <button ref={node => { optionRefs.current[index] = node; }} id={`${id}-option-${index}`} type="button" role="option" tabIndex={-1} aria-selected={active === index}
              onPointerDown={event => event.preventDefault()} onClick={() => select(suggestion)}
              onPointerMove={() => setActiveIndex(index)}
              className={`flex min-h-11 w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left text-sm leading-relaxed ${active === index ? 'bg-accent text-accent-foreground' : 'text-popover-foreground hover:bg-accent'}`}>
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span>{suggestion.name}</span>
            </button>
          </li>)}
        </ul>}
        <p id={helpId} className="text-xs leading-relaxed text-muted-foreground">{copy.hint}</p>
        {visible && <p role="status" aria-live="polite" className="text-xs leading-relaxed text-muted-foreground">
          {search.status === 'loading' ? copy.loading : search.status === 'error' ? copy.error : search.status === 'ready' ? suggestions.length ? `${suggestions.length} ${copy.count}` : copy.empty : ''}
        </p>}
        <div id="listing-location-map-panel" hidden={!showMap} className="relative mt-2 h-[200px] overflow-hidden rounded-xl border border-border">
          <div id="location-map" className="w-full h-full" />
          {coordinates && <div className="absolute bottom-2 left-2 right-2 bg-card/95 text-card-foreground p-2 text-xs rounded-md backdrop-blur-sm">
            <p className="font-medium text-foreground">{t('ad.location.selected','Selected location:')} {locationName}</p>
            <p className="text-muted-foreground">{t('ad.location.coordinates','Coordinates:')} {coordinates[1].toFixed(6)}, {coordinates[0].toFixed(6)}</p>
          </div>}
        </div>
        {errorMessage && <p id={errorId} role="alert" className="mt-2 text-sm text-destructive">{errorMessage}</p>}
      </div>
    </div>
  );
}
