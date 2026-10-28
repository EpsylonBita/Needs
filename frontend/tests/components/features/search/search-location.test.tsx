import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ find: vi.fn(), locate: vi.fn() }));
vi.mock('@/lib/services/location-suggestions', () => ({ searchLocationSuggestions: mocks.find }));
vi.mock('@/lib/services/location-service', () => ({ getCurrentLocation: mocks.locate }));
vi.mock('@/contexts/i18n-context', async () => {
  const { searchModernMessages } = await import('@/locales/search-modern-en');
  return { useI18n: () => ({ locale: 'en', t: (key: string, fallback?: string) => searchModernMessages[key as keyof typeof searchModernMessages] ?? fallback ?? key }) };
});
import { SearchLocation } from '@/components/features/search/search-location';
import SearchFilters from '@/components/features/search/search-filters';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', 'public-fixture');
  mocks.find.mockResolvedValue([{ id: 'athens', name: 'Athens, Greece', coordinates: { lng: 23.72, lat: 37.98 } }]);
});

describe('manual search area', () => {
  it('requires selecting a geocoded area, preserves query/tags and enables radius', async () => {
    const update = vi.fn();
    render(<NuqsTestingAdapter hasMemory searchParams="?q=guitar&tags=wood&page=3" onUrlUpdate={update}><SearchLocation /><SearchFilters /></NuqsTestingAdapter>);
    expect(screen.getByRole('slider')).toBeDisabled();
    expect(mocks.locate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Where are you looking?' }), { target: { value: 'Athens' } });
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Find area' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Athens, Greece' }));
    await waitFor(() => expect(screen.getByRole('slider')).toBeEnabled());
    const params = update.mock.calls.at(-1)![0].searchParams;
    expect(Object.fromEntries(params)).toEqual({ q: 'guitar', tags: 'wood', coordinates: '23.72,37.98', location: 'Athens, Greece' });
    expect(screen.getByRole('textbox', { name: 'Where are you looking?' })).toHaveValue('Athens, Greece');
    fireEvent.change(screen.getByRole('slider'), { target: { value: '12' } });
    await waitFor(() => expect(update.mock.calls.at(-1)![0].searchParams.get('distance')).toBe('12'));
  });

  it('allows manual selection after geolocation denial and clears the selected label with its coordinates', async () => {
    mocks.locate.mockRejectedValue(new Error('Permission denied'));
    const update = vi.fn();
    render(<NuqsTestingAdapter hasMemory onUrlUpdate={update}><SearchLocation /></NuqsTestingAdapter>);
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Choose a city manually');
    fireEvent.change(screen.getByRole('textbox', { name: 'Where are you looking?' }), { target: { value: 'Athens' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find area' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Athens, Greece' }));
    await waitFor(() => expect(update.mock.calls.at(-1)![0].searchParams.get('location')).toBe('Athens, Greece'));
    fireEvent.click(screen.getByRole('button', { name: 'Search all locations' }));
    await waitFor(() => expect(update.mock.calls.at(-1)![0].searchParams.toString()).toBe(''));
  });

  it('ignores a late geolocation when the user starts manual entry', async () => {
    let resolve!: (point: { lng: number; lat: number }) => void;
    mocks.locate.mockImplementation(() => new Promise(accept => { resolve = accept; }));
    const update = vi.fn();
    render(<NuqsTestingAdapter hasMemory onUrlUpdate={update}><SearchLocation /></NuqsTestingAdapter>);
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Where are you looking?' }), { target: { value: 'Patras' } });
    await act(async () => resolve({ lng: 23.7, lat: 37.9 }));
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Find area' })).toBeEnabled();
  });

  it('does not enable radius for invalid deep link coordinates', () => {
    render(<NuqsTestingAdapter searchParams="?coordinates=200,100"><SearchFilters /></NuqsTestingAdapter>);
    expect(screen.getByRole('slider')).toBeDisabled();
  });
});
