import { afterEach, describe, expect, it, vi } from 'vitest';
import { listingCoordinates, parseSearchQuery, searchListings } from '@/app/api/search/search-query';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Search transport contract', () => {
  it('uses the public key and encoded filters with a literal query rather than executable filter grammar', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://search-test.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-public-key');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'must-never-be-used');
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/0' } }));
    vi.stubGlobal('fetch', request);
    const query = 'desk",status.eq.suspended';
    await searchListings(parseSearchQuery(new URLSearchParams({ q: query, tags: 'Wood', category: 'Items', subcategory: 'Sell', page: '2' })));
    const url = new URL(request.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/rest/v1/listings');
    expect(url.searchParams.get('status')).toBe('eq.active');
    expect(url.searchParams.get('or')).toBe('(title.ilike."%desk\\",status.eq.suspended%",description.ilike."%desk\\",status.eq.suspended%")');
    expect(url.searchParams.get('listing_tags.or')).toBe('(tag.ilike."Wood")');
    expect(url.searchParams.get('select')).toContain('listing_tags!inner(tag)');
    expect(url.searchParams.get('offset')).toBe('12');
    const headers = new Headers((request.mock.calls[0][1] as RequestInit).headers);
    expect(headers.get('apikey')).toBe('test-public-key');
    expect(headers.get('Authorization')).not.toContain('must-never-be-used');
  });

  it('passes distance and count through the RPC request with related data', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://search-test.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-public-key');
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/0' } }));
    vi.stubGlobal('fetch', request);
    await searchListings(parseSearchQuery(new URLSearchParams({ coordinates: '23.72,37.98', distance: '12' })));
    const url = new URL(request.mock.calls[0][0] as string);
    const init = request.mock.calls[0][1] as RequestInit;
    expect(url.pathname).toBe('/rest/v1/rpc/nearby_listings');
    expect(JSON.parse(init.body as string)).toEqual({ lon: 23.72, lat: 37.98, radius_m: 12000 });
    expect(new Headers(init.headers).get('Prefer')).toContain('count=exact');
  });

  it('normalizes stored geography points and rejects invalid map coordinates', () => {
    expect(listingCoordinates('0101000020E610000000000000000000000000000000000000')).toEqual([0, 0]);
    expect(listingCoordinates('SRID=4326;POINT(23.72 37.98)')).toEqual([23.72, 37.98]);
    expect(listingCoordinates({ type: 'Point', coordinates: [23.72, 37.98] })).toEqual([23.72, 37.98]);
    expect(listingCoordinates({ type: 'Point', coordinates: [200, 100] })).toBeNull();
    expect(listingCoordinates('invalid')).toBeNull();
  });
});
