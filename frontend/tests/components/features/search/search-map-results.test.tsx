import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchListing } from '@/components/features/search/use-listing-search';
vi.mock('@/components/features/ads/new-listing-button', () => ({ NewListingButton: ({ children }: { children: React.ReactNode }) => <button>{children}</button> }));

type MapResult = { id: string; title: string; sellerId: string; sellerRating?: number; location: { coordinates: [number, number]; address: string } };
type ResponseState = { data: { listings: SearchListing[]; pagination: { total: number; page: number; totalPages: number } } | null; isLoading: boolean; error: string | null; retry: () => void };
const mocks = vi.hoisted(() => ({ search: vi.fn(), mounted: vi.fn(), unmounted: vi.fn(), retry: vi.fn(), mapProps: null as null | { results: MapResult[]; live: boolean } }));
vi.mock('@/components/features/search/use-listing-search', () => ({ useListingSearch: mocks.search }));
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ locale: 'en', t: (_key: string, fallback?: string) => fallback || _key, formatCurrency: (amount: number) => `€${amount}` }) }));
vi.mock('@/components/features/map/map-component', async () => {
  const { useEffect } = await import('react');
  return { Map: (props: { results: MapResult[]; live: boolean; onStatusChange?: (status: 'ready') => void }) => {
    mocks.mapProps = props;
    const onStatusChange = props.onStatusChange;
    useEffect(() => { mocks.mounted(); return () => { mocks.unmounted(); }; }, []);
    useEffect(() => { onStatusChange?.('ready'); }, [onStatusChange]);
    return <div data-testid="result-map" data-markers={props.results.length} data-live={String(props.live)} />;
  } };
});

import { SearchResults } from '@/components/features/search/search-results';

const listing: SearchListing = { id: 'desk', title: 'Oak desk', description: 'A wooden desk', price: 40, main_category: 'Items', sub_category: 'Sell', seller_id: 'seller-1', sellerRating: 4.8, coordinates: [23.72, 37.98], address: { label: 'Athens' }, listing_images: [{ url: '/desk-side.jpg', main: false }, { url: '/desk-main.jpg', main: true }] };
let response: ResponseState;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.mapProps = null;
  response = { data: { listings: [], pagination: { total: 0, page: 1, totalPages: 0 } }, isLoading: false, error: null, retry: mocks.retry };
  mocks.search.mockImplementation(() => response);
});
afterEach(cleanup);

describe('search list and persistent map', () => {
  it('keeps the same map mounted through loading, results, failure and empty states while clearing stale pins', async () => {
    response = { ...response, data: { listings: [listing], pagination: { total: 1, page: 1, totalPages: 1 } }, isLoading: true };
    const view = render(<NuqsTestingAdapter><SearchResults /></NuqsTestingAdapter>);
    const map = await screen.findByTestId('result-map');
    expect(map).toHaveAttribute('data-markers', '0');
    expect(map).toHaveAttribute('data-live', 'false');
    expect(screen.queryByRole('link', { name: /Oak desk/ })).not.toBeInTheDocument();
    const rerender = () => view.rerender(<NuqsTestingAdapter><SearchResults /></NuqsTestingAdapter>);
    response = { ...response, isLoading: false };
    rerender();
    expect(map).toHaveAttribute('data-markers', '1');
    expect(screen.getByRole('link', { name: /Oak desk/ })).toHaveAttribute('href', '/listings/desk?returnTo=%2Fsearch');
    response = { ...response, isLoading: true };
    rerender();
    expect(map).toHaveAttribute('data-markers', '0');
    response = { ...response, isLoading: false, error: 'Search service temporarily unavailable' };
    rerender();
    expect(screen.getByRole('alert')).toHaveTextContent('Search service temporarily unavailable');
    expect(map).toHaveAttribute('data-markers', '0');
    response = { ...response, data: { listings: [], pagination: { total: 0, page: 1, totalPages: 0 } }, error: null };
    rerender();
    expect(screen.getByRole('heading', { name: 'A fresh search could help.' })).toBeInTheDocument();
    expect(screen.getByTestId('result-map')).toBe(map);
    expect(mocks.mounted).toHaveBeenCalledOnce();
    expect(mocks.unmounted).not.toHaveBeenCalled();
  });

  it('uses the same filtered response and page for both views, adapting only valid longitude/latitude pairs', async () => {
    const invalid = [null, [NaN, 37], [181, 37], [23, -91], ['23', 37], [23], [23, 37, 1]].map((coordinates, index) => ({ ...listing, id: `invalid-${index}`, title: `Unmapped listing ${index}`, coordinates: coordinates as SearchListing['coordinates'] }));
    const second = { ...listing, id: 'second', title: 'Second desk', coordinates: [-0.12, 51.5] as [number, number], address: 'London' };
    response.data = { listings: [listing, second, ...invalid], pagination: { total: 20, page: 3, totalPages: 4 } };
    render(<NuqsTestingAdapter searchParams="?q=old&category=Services&subcategory=I%20can&tags=wood,glass&distance=50&page=3&coordinates=23.7,37.9"><SearchResults query="desk" radiusMeters={12000} fixedCategory="Items" /></NuqsTestingAdapter>);
    await screen.findByTestId('result-map');
    expect(mocks.search).toHaveBeenCalled();
    const sent = new URLSearchParams(mocks.search.mock.calls[0][0]);
    expect(Object.fromEntries(sent)).toEqual({ q: 'desk', category: 'Items', subcategory: '', tags: 'wood,glass', distance: '12', page: '3', coordinates: '23.7,37.9' });
    expect(mocks.mapProps?.live).toBe(false);
    expect(mocks.mapProps?.results).toMatchObject([
      { id: 'desk', sellerId: 'seller-1', sellerRating: 4.8, imageUrl: '/desk-main.jpg', category: 'Items', subcategory: 'Sell', location: { coordinates: [23.72, 37.98], address: 'Athens' } },
      { id: 'second', location: { coordinates: [-0.12, 51.5], address: 'London' } },
    ]);
    expect(mocks.mapProps?.results).toHaveLength(2);
    expect(screen.getAllByRole('link')).toHaveLength(9);
    expect(screen.getByText('Page 3 of 4')).toBeInTheDocument();
  });

  it('explains missing coordinates while keeping the listing and map available', async () => {
    response.data = { listings: [{ ...listing, coordinates: null }], pagination: { total: 1, page: 1, totalPages: 1 } };
    render(<NuqsTestingAdapter><SearchResults /></NuqsTestingAdapter>);
    expect(await screen.findByTestId('result-map')).toHaveAttribute('data-markers', '0');
    expect(screen.getByText('These listings do not have a map location.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Oak desk/ })).toBeInTheDocument();
  });

  it.each([
    { url: '?category=Items&subcategory=I%20can', fixed: undefined, expectedCategory: 'Items', expectedSubtype: '' },
    { url: '?category=Services&subcategory=I%20can', fixed: 'Items' as const, expectedCategory: 'Items', expectedSubtype: '' },
    { url: '?category=Services&subcategory=I%20can', fixed: undefined, expectedCategory: 'Services', expectedSubtype: 'I can' },
    { url: '?subcategory=Sell', fixed: undefined, expectedCategory: '', expectedSubtype: 'Sell' },
  ])('sanitizes only incompatible subcategories for $url (fixed $fixed)', async ({ url, fixed, expectedCategory, expectedSubtype }) => {
    render(<NuqsTestingAdapter searchParams={url}><SearchResults fixedCategory={fixed} /></NuqsTestingAdapter>);
    await screen.findByTestId('result-map');
    const sent = new URLSearchParams(mocks.search.mock.calls.at(-1)![0]);
    expect(sent.get('category')).toBe(expectedCategory);
    expect(sent.get('subcategory')).toBe(expectedSubtype);
  });

  it('keeps pagination connected to the URL search', async () => {
    const updated = vi.fn();
    response.data = { listings: [listing], pagination: { total: 20, page: 1, totalPages: 2 } };
    render(<NuqsTestingAdapter hasMemory onUrlUpdate={updated}><SearchResults /></NuqsTestingAdapter>);
    await screen.findByTestId('result-map');
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(updated.mock.calls.at(-1)?.[0].searchParams.get('page')).toBe('2'));
    expect(new URLSearchParams(mocks.search.mock.calls.at(-1)![0]).get('page')).toBe('2');
  });
});
