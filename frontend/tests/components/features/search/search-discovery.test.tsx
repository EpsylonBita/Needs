import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { SearchBar } from '@/components/features/search/search-bar';
import SearchHeader from '@/components/features/search/search-header';
import SearchFilters from '@/components/features/search/search-filters';
import { SearchResults } from '@/components/features/search/search-results';
import { ListingDetail } from '@/components/features/search/listing-detail';
import { SearchHeroSection } from '@/components/features/search/search-hero-section';
import { DEMO_LISTING_IDS, DEMO_PROJECT_ID } from '@/lib/listings/demo-policy';

const navigation = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/search', useSearchParams: () => new URLSearchParams(navigation.search) }));
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ t: (_key: string, fallback?: string) => fallback || _key, formatCurrency: (value: number) => `$${value}` }) }));
vi.mock('@/hooks/useGeolocation', () => ({ useGeolocation: () => ({ location: null, error: 'Location denied', isLoading: false }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
const account = vi.hoisted(() => ({ user: null as { id: string } | null, profile: null as { id: string } | null, profileLoading: false }));
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: account.user }) }));
vi.mock('@/contexts/profile-context', () => ({ useProfile: () => ({ profile: account.profile, isLoading: account.profileLoading }) }));
vi.mock('@/components/features/map/map-component', () => ({ Map: ({ results, live }: { results: { title: string }[]; live?: boolean }) => <div data-testid="search-map" data-live={String(live)}>{results.map(result => result.title).join(', ')}</div> }));

const request = vi.fn();
beforeEach(() => {
  navigation.search = '';
  account.user = null;
  account.profile = null;
  account.profileLoading = false;
  request.mockReset();
  request.mockResolvedValue({ ok: true, json: async () => ({ listings: [{ id: 'listing-1', title: 'Oak desk', description: 'A real listing response', price: 40, main_category: 'Items', sub_category: 'Sell', coordinates: [23.72, 37.98] }], pagination: { total: 1, page: 1, totalPages: 1 } }) });
  vi.stubGlobal('fetch', request);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Listing discovery', () => {
  it('labels verified demos on search, detail and home, with no invitation to start a chat', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', `https://${DEMO_PROJECT_ID}.supabase.co`);
    request.mockResolvedValue({ ok: true, json: async () => ({ listings: [{ id: DEMO_LISTING_IDS[0], title: 'Seed guitar', description: 'Example', price: 85, main_category: 'Items', sub_category: 'Sell' }], pagination: { total: 1, page: 1, totalPages: 1 } }) });
    const search = render(<NuqsTestingAdapter searchParams=""><SearchResults /></NuqsTestingAdapter>);
    expect(await screen.findByTestId('demo-listing-notice')).toHaveTextContent('Not available for transactions');
    search.unmount();
    const detail = render(<ListingDetail id={DEMO_LISTING_IDS[0]} />);
    expect(await screen.findByTestId('demo-listing-notice')).toHaveTextContent('Demo listing');
    expect(screen.queryByRole('link', { name: 'Chat' })).not.toBeInTheDocument();
    expect(screen.queryByText('Please log in to start a chat.')).not.toBeInTheDocument();
    expect(screen.getByText(/cannot start a conversation or transaction/)).toBeInTheDocument();
    detail.unmount();
    render(<SearchHeroSection />);
    expect(await screen.findByTestId('demo-listing-notice')).toHaveTextContent('Not available for transactions');
    expect(screen.getByText('€85.00')).toBeInTheDocument();
  });
  it('shows stored zero-rate prices as needing confirmation across discovery surfaces', async () => {
    request.mockResolvedValue({ ok: true, json: async () => ({ listings: [{ id: 'rate-listing', title: 'Home care', description: 'Home care 10€/hour', price: 0, main_category: 'Services', sub_category: 'I can' }], pagination: { total: 1, page: 1, totalPages: 1 } }) });
    const results = render(<NuqsTestingAdapter searchParams=""><SearchResults /></NuqsTestingAdapter>);
    expect(await screen.findByText('Price needs confirmation')).toBeInTheDocument();
    expect(screen.queryByText('Free')).not.toBeInTheDocument();
    results.unmount();
    const detail = render(<ListingDetail id="rate-listing" />);
    expect(await screen.findByText('Price needs confirmation')).toBeInTheDocument();
    detail.unmount();
    render(<SearchHeroSection />);
    expect(await screen.findByText('Price needs confirmation')).toBeInTheDocument();
  });

  it('keeps explicit Items/Free discovery labels despite earlier rate wording', async () => {
    request.mockResolvedValue({ ok: true, json: async () => ({ listings: [{ id: 'free-listing', title: 'Free bicycle', description: 'Previously rented at 10€/hour', price: 0, main_category: 'Items', sub_category: 'Free' }], pagination: { total: 1, page: 1, totalPages: 1 } }) });
    render(<NuqsTestingAdapter searchParams=""><SearchResults /></NuqsTestingAdapter>);
    expect(await screen.findAllByText('Free')).toHaveLength(2);
    expect(screen.queryByText('Price needs confirmation')).not.toBeInTheDocument();
  });

  it('preserves an hourly basis in result cards, listing detail and the home listing preview', async () => {
    request.mockResolvedValue({ ok: true, json: async () => ({ listings: [{ id: 'rate-listing', title: 'Home care', description: 'Care at home for 10 euros per hour', price: 10, main_category: 'Services', sub_category: 'I can', coordinates: [23.72, 37.98] }], pagination: { total: 1, page: 1, totalPages: 1 } }) })
    const results = render(<NuqsTestingAdapter searchParams=""><SearchResults /></NuqsTestingAdapter>)
    expect(await screen.findByText('€10.00/hour')).toBeInTheDocument()
    results.unmount()
    const detail = render(<ListingDetail id="rate-listing" />)
    expect(await screen.findByText('€10.00/hour')).toBeInTheDocument()
    detail.unmount()
    render(<SearchHeroSection />)
    expect(await screen.findByText('€10.00/hour')).toBeInTheDocument()
  })

  it('searches the newly typed text, including clearing the search', async () => {
    const onSearch = vi.fn();
    render(<SearchBar onSearch={onSearch} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'desk' } });
    await waitFor(() => expect(onSearch).toHaveBeenLastCalledWith('desk', ''));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    await waitFor(() => expect(onSearch).toHaveBeenLastCalledWith('', ''));
  });

  it('sends URL query, category, tags and radius together without requiring geolocation', async () => {
    render(<NuqsTestingAdapter searchParams="?q=desk&category=Items&subcategory=Sell&tags=wood&distance=12" hasMemory>
      <SearchHeader /><SearchFilters /><SearchResults />
    </NuqsTestingAdapter>);
    await screen.findByRole('heading', { name: 'Oak desk' });
    const url = new URL(request.mock.calls.at(-1)![0], 'http://localhost');
    expect(url.pathname).toBe('/api/search');
    expect(url.searchParams.get('q')).toBe('desk');
    expect(url.searchParams.get('category')).toBe('Items');
    expect(url.searchParams.get('subcategory')).toBe('Sell');
    expect(url.searchParams.get('tags')).toBe('wood');
    expect(url.searchParams.get('distance')).toBe('12');
  });

  it('clears the incompatible subcategory and pagination when category changes', async () => {
    const onUrlUpdate = vi.fn();
    render(<NuqsTestingAdapter searchParams="?category=Items&subcategory=Sell&page=4" onUrlUpdate={onUrlUpdate} hasMemory>
      <SearchFilters /><SearchResults />
    </NuqsTestingAdapter>);
    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'Services' } });
    await waitFor(() => {
      const params = onUrlUpdate.mock.calls.at(-1)?.[0].searchParams;
      expect(params?.get('category')).toBe('Services');
      expect(params?.get('subcategory')).toBeNull();
      expect(params?.get('page')).toBeNull();
    });
    expect(screen.getByRole('option', { name: 'I want' })).toBeInTheDocument();
  });

  it('shows a backend failure instead of claiming there are no results', async () => {
    request.mockResolvedValue({ ok: false, json: async () => ({ error: 'Search service temporarily unavailable' }) });
    render(<NuqsTestingAdapter searchParams="?q=desk"><SearchResults /></NuqsTestingAdapter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Search service temporarily unavailable');
  });

  it('keeps the Items category on its dedicated page despite a conflicting URL', async () => {
    render(<NuqsTestingAdapter searchParams="?category=Services&subcategory=I%20can"><SearchResults fixedCategory="Items" /></NuqsTestingAdapter>);
    await screen.findByRole('heading', { name: 'Oak desk' });
    const url = new URL(request.mock.calls.at(-1)![0], 'http://localhost');
    expect(url.searchParams.get('category')).toBe('Items');
    expect(url.searchParams.get('subcategory')).toBe('');
    expect(screen.getByRole('link', { name: /Oak desk/ })).toHaveAttribute('href', '/listings/listing-1?returnTo=%2Fsearch');
  });

  it('loads a detail record and returns signed-out visitors to that listing conversation after login', async () => {
    render(<ListingDetail id="123e4567-e89b-12d3-a456-426614174000" />);
    await screen.findByRole('heading', { name: 'Oak desk' });
    const detailRequest = request.mock.calls.find(([url]) => new URL(url, 'http://localhost').pathname === '/api/search');
    expect(new URL(detailRequest![0], 'http://localhost').searchParams.get('listingId')).toBe('123e4567-e89b-12d3-a456-426614174000');
    const chatLogin = new URL(screen.getByRole('link', { name: 'Chat' }).getAttribute('href')!, 'http://localhost');
    expect(chatLogin.searchParams.get('redirectTo')).toBe('/chat?listing=listing-1');
    expect(chatLogin.searchParams.get('context')).toBe('conversation');
    expect(chatLogin.searchParams.get('listingTitle')).toBe('Oak desk');
  });

  it('keeps the complete search destination on the detail return link', async () => {
    const destination = '/search?q=%CE%BA%CE%B9%CE%B8%CE%AC%CF%81%CE%B1&category=Items&coordinates=23.72%2C37.98&distance=12&tags=wood&page=2';
    navigation.search = new URLSearchParams({ returnTo: destination }).toString();
    render(<ListingDetail id="listing-1" />);
    expect(screen.getByRole('link', { name: 'Back to search' })).toHaveAttribute('href', destination);
    await screen.findByRole('heading', { name: 'Oak desk' });
    expect(screen.getByRole('link', { name: 'Back to search' })).toHaveAttribute('href', destination);
  });

  it.each(['https://evil.invalid', '//evil.invalid', '/\\evil.invalid'])('rejects unsafe return destination %s', async returnTo => {
    navigation.search = new URLSearchParams({ returnTo }).toString();
    render(<ListingDetail id="listing-1" />);
    expect(screen.getByRole('link', { name: 'Back to search' })).toHaveAttribute('href', '/search');
    await screen.findByRole('heading', { name: 'Oak desk' });
  });

  it('identifies the publisher without treating no reviews as a zero rating', async () => {
    request.mockResolvedValue({ ok: true, json: async () => ({ listings: [{ id: 'listing-1', seller_id: 'seller-1', sellerName: 'Maria', sellerTitle: 'Music teacher', sellerReviewCount: 0, title: 'Piano lessons', price: 20, main_category: 'Services', sub_category: 'I can' }] }) });
    render(<ListingDetail id="listing-1" />);
    expect(await screen.findByRole('link', { name: /Maria Music teacher/ })).toHaveAttribute('href', '/profile/seller-1');
    expect(screen.getByText('No reviews yet')).toBeInTheDocument();
    expect(screen.queryByText('0 / 5')).not.toBeInTheDocument();
  });

  it('sends listing publishers to their inbox instead of starting a conversation with themselves', async () => {
    account.user = { id: 'owner-auth' };
    account.profile = { id: 'owner-profile' };
    request.mockResolvedValue({ ok: true, json: async () => ({ listings: [{ id: 'listing-1', seller_id: 'owner-profile', title: 'My request', price: 40, main_category: 'Items', sub_category: 'Buy' }] }) });
    render(<ListingDetail id="listing-1" />);
    expect(await screen.findByRole('link', { name: 'View conversations' })).toHaveAttribute('href', '/chat');
    expect(screen.queryByRole('link', { name: 'Chat' })).not.toBeInTheDocument();
  });

  it('waits for the signed-in profile before choosing an owner or responder action', async () => {
    account.user = { id: 'owner-auth' };
    account.profileLoading = true;
    render(<ListingDetail id="listing-1" />);
    await screen.findByRole('heading', { name: 'Oak desk' });
    expect(screen.getByRole('button', { name: 'Chat' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Chat' })).not.toBeInTheDocument();
  });

  it('shows real neighborhood listings on the homepage map with working detail and search links', async () => {
    render(<SearchHeroSection />);
    await waitFor(() => expect(screen.getByTestId('search-map')).toHaveTextContent('Oak desk'));
    expect(screen.getByTestId('search-map')).toHaveAttribute('data-live', 'false');
    const url = new URL(request.mock.calls.at(-1)![0], 'http://localhost');
    expect(url.pathname).toBe('/api/search');
    expect(url.searchParams.get('limit')).toBe('50');
    expect(screen.getByRole('link', { name: /Oak desk/ })).toHaveAttribute('href', '/listings/listing-1');
    expect(screen.getByRole('link', { name: 'All listings' })).toHaveAttribute('href', '/search');
  });
});
