import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ locale: 'en', find: vi.fn(), setCoordinates: vi.fn(), getPosition: vi.fn() }));
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ locale: state.locale }) }));
vi.mock('@/lib/services/location-suggestions', () => ({ searchLocationSuggestions: state.find }));
vi.mock('@/hooks/use-search-state', async () => {
  const React = await import('react');
  return { useSearchState: () => {
    const [coordinates, setCoordinates] = React.useState('');
    const [query, setQuery] = React.useState('');
    const [category, setCategory] = React.useState('');
    const [distance, setDistance] = React.useState(50);
    return { coordinates: { value: coordinates, set: (value: string | null) => { state.setCoordinates(value); setCoordinates(value || ''); } }, query: { value: query, set: setQuery }, category: { value: category, set: setCategory }, distance: { value: distance, set: setDistance } };
  } };
});
vi.mock('@/components/features/search/search-results', () => ({ SearchResults: () => <section aria-label="Nearby listing results and map" /> }));
import { NearbyDiscovery } from '@/components/features/nearby/nearby-discovery';

beforeEach(() => {
  vi.clearAllMocks(); state.locale = 'en';
  vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', 'public-test-token');
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: state.getPosition } });
  state.find.mockResolvedValue([{ id: 'athens', name: 'Athens, Greece', coordinates: { lat: 37.98, lng: 23.72 } }]);
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('Nearby discovery', () => {
  it('requests location only after an explicit click and opens nearby results', async () => {
    state.getPosition.mockImplementation(success => success({ coords: { longitude: 23.7, latitude: 37.9 } }));
    render(<NearbyDiscovery />);
    expect(state.getPosition).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Nearby listing results and map' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(state.setCoordinates).toHaveBeenLastCalledWith('23.7,37.9');
    expect(screen.getByRole('region', { name: 'Nearby listing results and map' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Search radius' })).toHaveValue('50');
    fireEvent.change(screen.getByRole('slider'), { target: { value: '10' } });
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '10 km');
  });

  it('uses manual area coordinates with the existing listing search', async () => {
    render(<NearbyDiscovery />);
    fireEvent.change(screen.getByLabelText('City or area'), { target: { value: 'Athens' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find area' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Athens, Greece' }));
    expect(state.setCoordinates).toHaveBeenLastCalledWith('23.72,37.98');
    expect(screen.getByRole('region', { name: 'Nearby listing results and map' })).toBeInTheDocument();
    expect(state.getPosition).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'Services' } });
    expect(screen.getByRole('combobox')).toHaveValue('Services');
  });

  it('keeps manual fallback available when location permission is denied', () => {
    state.getPosition.mockImplementation((_success, failure) => failure({ code: 1 }));
    render(<NearbyDiscovery />);
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Search for your area');
    expect(screen.getByLabelText('City or area')).toBeEnabled();
  });

  it('ignores late geolocation after the user starts entering a different area', async () => {
    let complete!: (position: unknown) => void;
    state.getPosition.mockImplementation(success => { complete = success; });
    render(<NearbyDiscovery />);
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    fireEvent.change(screen.getByLabelText('City or area'), { target: { value: 'Patras' } });
    await act(async () => complete({ coords: { longitude: 23.7, latitude: 37.9 } }));
    expect(state.setCoordinates).toHaveBeenLastCalledWith(null);
    expect(screen.getByLabelText('City or area')).toHaveValue('Patras');
    expect(screen.queryByRole('region', { name: 'Nearby listing results and map' })).not.toBeInTheDocument();
  });

  it('ignores a stale area response and shows localized retry feedback on failure', async () => {
    state.locale = 'el';
    let complete!: (places: unknown[]) => void;
    state.find.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    render(<NearbyDiscovery />);
    fireEvent.change(screen.getByLabelText('Πόλη ή περιοχή'), { target: { value: 'Athens' } });
    fireEvent.click(screen.getByRole('button', { name: 'Εύρεση περιοχής' }));
    await waitFor(() => expect(state.find).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Πόλη ή περιοχή'), { target: { value: 'Patras' } });
    await act(async () => complete([{ id: 'old', name: 'Old location', coordinates: { lat: 1, lng: 1 } }]));
    expect(screen.queryByText('Old location')).not.toBeInTheDocument();
    state.find.mockRejectedValueOnce(new Error('Offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Εύρεση περιοχής' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Δοκίμασε ξανά');
    expect(screen.getByRole('button', { name: 'Εύρεση περιοχής' })).toBeEnabled();
  });
});
