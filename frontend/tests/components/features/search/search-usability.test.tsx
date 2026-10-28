import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/components/features/ads/new-listing-button', () => ({ NewListingButton: ({ children }: { children: React.ReactNode }) => <button>{children}</button> }));

const mocks = vi.hoisted(() => ({ search: vi.fn(), retry: vi.fn(), position: vi.fn(), locale: 'en' }));
vi.mock('@/components/features/search/use-listing-search', () => ({ useListingSearch: mocks.search }));
vi.mock('@/components/features/map/map-component', () => ({ Map: () => <div data-testid="result-map" /> }));
vi.mock('@/contexts/i18n-context', async () => {
  const { searchModernMessages } = await import('@/locales/search-modern-el');
  return { useI18n: () => ({ locale: mocks.locale, t: (key: string, fallback?: string) => mocks.locale === 'el' ? searchModernMessages[key as keyof typeof searchModernMessages] ?? fallback ?? key : fallback ?? key, formatCurrency: (amount: number) => `€${amount}` }) };
});

import { ClientSearchPage } from '@/components/features/search/client-search-page';
import SearchFilters from '@/components/features/search/search-filters';
import SearchHeader from '@/components/features/search/search-header';
import { SearchResults } from '@/components/features/search/search-results';

const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale = 'en';
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: mocks.position } });
  mocks.search.mockReturnValue({ data: { listings: [], pagination: { total: 0, page: 1, totalPages: 0 } }, isLoading: false, error: null, retry: mocks.retry });
});
afterEach(() => {
  if (originalGeolocation) Object.defineProperty(navigator, 'geolocation', originalGeolocation);
  else Reflect.deleteProperty(navigator, 'geolocation');
});

describe('search usability', () => {
  it('never requests location on mount and keeps coordinates supplied in the URL', async () => {
    render(<NuqsTestingAdapter searchParams="?coordinates=23.7,37.9"><SearchFilters /><SearchResults /></NuqsTestingAdapter>);
    await act(async () => {});
    expect(mocks.position).not.toHaveBeenCalled();
    expect(new URLSearchParams(mocks.search.mock.calls.at(-1)?.[0]).get('coordinates')).toBe('23.7,37.9');
  });

  it('requests location only on click and applies a successful result to the URL-backed search', async () => {
    const update = vi.fn();
    render(<NuqsTestingAdapter searchParams="?q=desk&page=3" hasMemory onUrlUpdate={update}><SearchFilters /><SearchResults /></NuqsTestingAdapter>);
    expect(mocks.position).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(mocks.position).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Finding your location...' })).toBeDisabled();
    await act(async () => { mocks.position.mock.calls[0][0]({ coords: { longitude: 23.7, latitude: 37.9 } }); });
    await waitFor(() => expect(update.mock.calls.at(-1)?.[0].searchParams.get('coordinates')).toBe('23.7,37.9'));
    const sent = new URLSearchParams(mocks.search.mock.calls.at(-1)?.[0]);
    expect(sent.get('coordinates')).toBe('23.7,37.9');
    expect(sent.get('q')).toBe('desk');
    expect(sent.get('page')).toBe('1');
  });

  it('reports denied location in Greek and continues searching all locations', async () => {
    mocks.locale = 'el';
    render(<NuqsTestingAdapter hasMemory><SearchFilters /><SearchResults /></NuqsTestingAdapter>);
    fireEvent.click(screen.getByRole('button', { name: 'Χρήση της τοποθεσίας μου' }));
    await act(async () => { mocks.position.mock.calls[0][1]({ code: 1, message: 'Permission denied' }); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Η τοποθεσία σου δεν είναι διαθέσιμη');
    expect(screen.getByRole('button', { name: 'Χρήση της τοποθεσίας μου' })).toBeEnabled();
    expect(new URLSearchParams(mocks.search.mock.calls.at(-1)?.[0]).has('coordinates')).toBe(false);
  });

  it('ignores a late success after the user chooses all locations', async () => {
    const update = vi.fn();
    render(<NuqsTestingAdapter hasMemory onUrlUpdate={update}><SearchFilters /></NuqsTestingAdapter>);
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search all locations' }));
    await act(async () => { mocks.position.mock.calls[0][0]({ coords: { longitude: 23.7, latitude: 37.9 } }); });
    expect(update.mock.calls.every(call => !call[0].searchParams.has('coordinates'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Use my location' })).toBeEnabled();
  });

  it('ignores location callbacks after unmounting the filters', async () => {
    const update = vi.fn();
    const view = render(<NuqsTestingAdapter hasMemory onUrlUpdate={update}><SearchFilters /></NuqsTestingAdapter>);
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    view.unmount();
    await act(async () => { mocks.position.mock.calls[0][0]({ coords: { longitude: 23.7, latitude: 37.9 } }); });
    expect(update).not.toHaveBeenCalled();
  });

  it('starts with a collapsed mobile filter control and exposes the associated controls on demand', () => {
    render(<NuqsTestingAdapter><ClientSearchPage /></NuqsTestingAdapter>);
    const toggle = screen.getByRole('button', { name: 'Filters' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const region = document.getElementById(toggle.getAttribute('aria-controls')!);
    expect(region).toHaveClass('hidden');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(region).not.toHaveClass('hidden');
    expect(region).toContainElement(screen.getByRole('combobox', { name: 'Category' }));
  });

  it('labels the distance slider and persists keyboard-compatible changes without retaining a stale page', async () => {
    const update = vi.fn();
    render(<NuqsTestingAdapter searchParams="?distance=12&page=3&coordinates=23.7,37.9" hasMemory onUrlUpdate={update}><SearchFilters /></NuqsTestingAdapter>);
    const slider = screen.getByRole('slider', { name: 'Distance (km)' });
    expect(slider).toHaveAttribute('aria-valuetext', '12 kilometers');
    expect(slider).toHaveAccessibleDescription('Distance applies around the selected location.');
    fireEvent.change(slider, { target: { value: '25' } });
    await waitFor(() => expect(update.mock.calls.at(-1)?.[0].searchParams.get('distance')).toBe('25'));
    expect(update.mock.calls.at(-1)?.[0].searchParams.get('page')).toBeNull();
  });

  it('makes the empty state reset the actual URL while preserving a dedicated category', async () => {
    const update = vi.fn();
    render(<NuqsTestingAdapter searchParams="?q=desk&tags=wood&page=2" hasMemory onUrlUpdate={update}><SearchResults fixedCategory="Items" /></NuqsTestingAdapter>);
    fireEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }));
    await waitFor(() => expect(update.mock.calls.at(-1)?.[0].searchParams.toString()).toBe(''));
    const sent = new URLSearchParams(mocks.search.mock.calls.at(-1)?.[0]);
    expect(sent.get('category')).toBe('Items');
    expect(sent.get('q')).toBe('');
  });

  it('renders only stored image URLs and falls back when an actual image fails', () => {
    mocks.search.mockReturnValue({ data: { listings: [
      { id: 'one', title: 'Oak desk', description: 'A wooden desk', price: 40, main_category: 'Items', sub_category: 'Sell', listing_images: [{ url: 'https://storage.example.com/desk.jpg', main: true }] },
      { id: 'two', title: 'Help with gardening', description: 'Gardening help', price: 0, main_category: 'Services', sub_category: 'I can' },
    ], pagination: { total: 2, page: 1, totalPages: 1 } }, isLoading: false, error: null, retry: mocks.retry });
    render(<NuqsTestingAdapter><SearchResults /></NuqsTestingAdapter>);
    const images = document.querySelectorAll('img');
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAttribute('src', 'https://storage.example.com/desk.jpg');
    expect(screen.getByRole('link', { name: /Oak desk/ })).toHaveAttribute('href', '/listings/one?returnTo=%2Fsearch');
    fireEvent.error(images[0]);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getAllByText('No photo added')).toHaveLength(2);
  });

  it('provides a real retry action for a failed search', () => {
    mocks.search.mockReturnValue({ data: null, isLoading: false, error: 'Search service temporarily unavailable', retry: mocks.retry });
    render(<NuqsTestingAdapter><SearchResults /></NuqsTestingAdapter>);
    expect(screen.getByRole('alert')).toHaveTextContent('Search service temporarily unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mocks.retry).toHaveBeenCalledTimes(1);
  });

  it('translates category, distance and result labels consistently into Greek', () => {
    mocks.locale = 'el';
    render(<NuqsTestingAdapter><SearchHeader title="Services" /><SearchFilters fixedCategory="Services" /><SearchResults fixedCategory="Services" /></NuqsTestingAdapter>);
    expect(screen.getByRole('heading', { name: 'Υπηρεσίες' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Απόσταση (χλμ)' })).toHaveAttribute('aria-valuetext', '50 χιλιόμετρα');
    expect(screen.getByRole('option', { name: 'Μπορώ' })).toHaveValue('I can');
    expect(screen.getByRole('region', { name: 'Αποτελέσματα αναζήτησης' })).toBeInTheDocument();
  });
});
