import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/search/route';

const mocks = vi.hoisted(() => {
  const query: Record<string, any> = {};
  for (const method of ['select', 'eq', 'in', 'or', 'order', 'range']) query[method] = vi.fn(() => query);
  query.then = vi.fn((resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(resolve));
  return { query, client: { from: vi.fn(() => query), rpc: vi.fn(() => query) }, allowed: vi.fn(async () => ({ allowed: true })) };
});
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => mocks.client) }));
vi.mock('@/lib/utils/rate-limit-enhanced', () => ({ rateLimitEnhanced: mocks.allowed, RateLimitConfigs: { PUBLIC_API: { key: (ip: string) => ip, anonymousLimit: 100, windowMs: 60000, message: 'Slow down' } } }));
vi.mock('@/lib/utils/logger', () => ({ log: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://search-test.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-public-key');
  mocks.query.then.mockImplementation((resolve: (value: unknown) => unknown) => Promise.resolve({ data: [{ id: 'one', title: 'Oak desk', description: 'Wooden desk', price: 40, main_category: 'Items', sub_category: 'Sell', status: 'active', listing_tags: [{ tag: 'wood' }] }], count: 1, error: null }).then(resolve));
});

describe('Public listing search', () => {
  it('queries active records and applies all filters before pagination', async () => {
    const response = await GET(new NextRequest('http://localhost/api/search?q=desk&category=Items&subcategory=Sell&tags=wood&page=2&limit=12'));
    expect(response.status).toBe(200);
    expect(mocks.client.from).toHaveBeenCalledWith('listings');
    expect(mocks.query.eq).toHaveBeenCalledWith('status', 'active');
    expect(mocks.query.eq).toHaveBeenCalledWith('main_category', 'Items');
    expect(mocks.query.eq).toHaveBeenCalledWith('sub_category', 'Sell');
    expect(mocks.query.or).toHaveBeenCalledWith('tag.ilike."wood"', { referencedTable: 'listing_tags' });
    expect(mocks.query.or).toHaveBeenCalledWith(expect.stringContaining('desk'));
    expect(mocks.query.range).toHaveBeenCalledWith(12, 23);
    const body = await response.json();
    expect(body.listings[0].title).toBe('Oak desk');
    expect(body.pagination.total).toBe(1);
  });

  it('uses the actual requested radius and coordinates for nearby search', async () => {
    const response = await GET(new NextRequest('http://localhost/api/search?coordinates=23.72,37.98&distance=12'));
    expect(response.status).toBe(200);
    expect(mocks.client.rpc).toHaveBeenCalledWith('nearby_listings', { lon: 23.72, lat: 37.98, radius_m: 12000 }, { count: 'exact' });
    expect(mocks.query.eq).toHaveBeenCalledWith('status', 'active');
  });

  it('opens only the requested active listing for a detail page', async () => {
    const response = await GET(new NextRequest('http://localhost/api/search?listingId=123e4567-e89b-12d3-a456-426614174000'));
    expect(response.status).toBe(200);
    expect(mocks.query.eq).toHaveBeenCalledWith('id', '123e4567-e89b-12d3-a456-426614174000');
    expect(mocks.query.eq).toHaveBeenCalledWith('status', 'active');
  });

  it.each(['?category=Unknown', '?category=Services&subcategory=Sell', '?coordinates=181,37', '?distance=-1', '?page=NaN', '?listingId=broken'])('rejects invalid filters %s', async (params) => {
    const response = await GET(new NextRequest(`http://localhost/api/search${params}`));
    expect(response.status).toBe(400);
    expect(mocks.client.from).not.toHaveBeenCalled();
    expect(mocks.client.rpc).not.toHaveBeenCalled();
  });

  it('returns an explicit unavailable response on a database error', async () => {
    mocks.query.then.mockImplementation((resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, count: null, error: { message: 'database unavailable' } }).then(resolve));
    const response = await GET(new NextRequest('http://localhost/api/search'));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe('Search service temporarily unavailable');
  });
});
