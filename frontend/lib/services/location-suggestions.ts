export type LocationSuggestion = {
  id: string;
  name: string;
  coordinates: { lat: number; lng: number };
  areaTag?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
const areaKinds = ['place', 'locality', 'region'];

function areaText(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const text = value.trim().replace(/\s+/g, ' ');
  return text && text.length <= 50 ? text : undefined;
}

/** Keep a city/area tag separate from the full selected street address. */
export function getLocationAreaTag(feature: unknown): string | undefined {
  if (!isRecord(feature)) return;
  const kinds = Array.isArray(feature.place_type) ? feature.place_type : [];
  const ownKind = typeof feature.id === 'string' ? feature.id.split('.')[0] : '';
  if (areaKinds.some(kind => kinds.includes(kind) || ownKind === kind)) {
    const ownName = areaText(feature.text);
    if (ownName) return ownName;
  }
  const context = Array.isArray(feature.context) ? feature.context : [];
  for (const kind of areaKinds) {
    for (const entry of context) {
      if (isRecord(entry) && typeof entry.id === 'string' && entry.id.startsWith(`${kind}.`)) {
        const name = areaText(entry.text);
        if (name) return name;
      }
    }
  }
}

export function parseLocationSuggestions(payload: unknown): LocationSuggestion[] {
  if (!isRecord(payload) || !Array.isArray(payload.features)) return [];
  const suggestions: LocationSuggestion[] = [];
  const seen = new Set<string>();
  for (const feature of payload.features) {
    if (!isRecord(feature) || typeof feature.id !== 'string' || typeof feature.place_name !== 'string'
      || !feature.place_name.trim() || !Array.isArray(feature.center) || feature.center.length !== 2) continue;
    const [lng, lat] = feature.center;
    if (typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat)
      || Math.abs(lng) > 180 || Math.abs(lat) > 90 || seen.has(feature.id)) continue;
    seen.add(feature.id);
    suggestions.push({ id: feature.id, name: feature.place_name.trim(), coordinates: { lat, lng }, areaTag: getLocationAreaTag(feature) });
    if (suggestions.length === 5) break;
  }
  return suggestions;
}

export async function searchLocationSuggestions(query: string, language: 'el' | 'en', token: string, signal: AbortSignal): Promise<LocationSuggestion[]> {
  // Mapbox v5 accepts up to 256 characters / 20 words, with no semicolons.
  const text = query.trim().replace(/;/g, ' ').replace(/\s+/g, ' ');
  if (text.length < 3) return [];
  if (text.length > 256 || text.split(' ').length > 20) throw new Error('Location query is too long');
  const params = new URLSearchParams({ access_token: token, autocomplete: 'true', limit: '5', language,
    types: 'address,place,locality,neighborhood,postcode,district,region' });
  const response = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(text)}.json?${params}`, { signal });
  if (!response.ok) throw new Error('Location suggestions unavailable');
  return parseLocationSuggestions(await response.json());
}
