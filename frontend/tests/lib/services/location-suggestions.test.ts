import { describe, expect, it } from 'vitest';
import { getLocationAreaTag, parseLocationSuggestions } from '@/lib/services/location-suggestions';

describe('location suggestion data contract', () => {
  it('keeps the full address and coordinates while extracting only its city as a tag', () => {
    expect(parseLocationSuggestions({ features: [{ id: 'address.1', text: 'Ermou', place_type: ['address'],
      place_name: 'Ermou 10, Athens, Greece', center: [23.73, 37.98],
      context: [{ id: 'region.1', text: 'Attica' }, { id: 'place.1', text: 'Athens' }],
    }] })).toEqual([{ id: 'address.1', name: 'Ermou 10, Athens, Greece', coordinates: { lat: 37.98, lng: 23.73 }, areaTag: 'Athens' }]);
  });

  it.each(['place', 'locality', 'region'])('uses selected %s text before broader context', kind => {
    expect(getLocationAreaTag({ id: `${kind}.1`, text: ' Athens ', place_type: [kind], context: [{ id: 'region.2', text: 'Attica' }] })).toBe('Athens');
  });

  it('falls back from city to locality and region without ever using street text', () => {
    expect(getLocationAreaTag({ id: 'address.1', text: 'A private street 25', context: [{ id: 'locality.1', text: 'Marousi' }] })).toBe('Marousi');
    expect(getLocationAreaTag({ id: 'address.1', text: 'A private street 25', context: [{ id: 'region.1', text: 'Attica' }] })).toBe('Attica');
    expect(getLocationAreaTag({ id: 'address.1', text: 'A private street 25' })).toBeUndefined();
    expect(getLocationAreaTag(null)).toBeUndefined();
    expect(getLocationAreaTag({ id: 'place.1', text: 'a'.repeat(51) })).toBeUndefined();
  });

  it('ignores malformed coordinates, missing labels, and duplicate provider results', () => {
    const valid = { id: 'place.1', place_name: 'Athens', center: [23.73, 37.98] };
    expect(parseLocationSuggestions({ features: [valid, valid,
      { id: 'place.2', place_name: 'Invalid', center: [0, 91] },
      { id: 'place.3', place_name: 'Invalid', center: ['23', 37] },
      { id: 'place.4', place_name: '', center: [0, 0] },
      { id: 'place.5', place_name: 'Invalid', center: [NaN, 37] }, null,
    ] })).toHaveLength(1);
    expect(parseLocationSuggestions({ features: null })).toEqual([]);
  });
});
