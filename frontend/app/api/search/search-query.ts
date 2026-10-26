import { createClient } from '@supabase/supabase-js';

const subcategories: Record<string, readonly string[]> = {
  Items: ['Buy', 'Sell', 'Free'],
  Services: ['I want', 'I will', 'I can'],
};

export class SearchValidationError extends Error {}

function integer(params: URLSearchParams, name: string, fallback: number, max: number) {
  const raw = params.get(name);
  const value = raw === null ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) throw new SearchValidationError(`Invalid ${name}`);
  return value;
}

export function parseSearchQuery(params: URLSearchParams) {
  const query = (params.get('q') || '').trim();
  const category = params.get('category') || '';
  const subcategory = params.get('subcategory') || '';
  const listingId = params.get('listingId') || '';
  if (listingId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(listingId)) throw new SearchValidationError('Invalid listing ID');
  if (query.length > 200) throw new SearchValidationError('Search text must be 200 characters or fewer');
  if (category && !Object.hasOwn(subcategories, category)) throw new SearchValidationError('Invalid category');
  if (subcategory && !(category ? subcategories[category] : Object.values(subcategories).flat()).includes(subcategory)) {
    throw new SearchValidationError('Invalid subcategory');
  }
  const tags = [...new Set((params.get('tags') || '').split(',').map(tag => tag.trim()).filter(Boolean))];
  if (tags.length > 20 || tags.some(tag => tag.length > 80)) throw new SearchValidationError('Invalid tags');
  const page = integer(params, 'page', 1, 10000);
  const limit = integer(params, 'limit', 12, 50);
  const distance = integer(params, 'distance', 50, 500);
  const coordinates = params.get('coordinates');
  let point: [number, number] | null = null;
  if (coordinates) {
    const pieces = coordinates.split(',');
    const [longitude, latitude] = pieces.map(Number);
    if (pieces.length !== 2 || pieces.some(piece => !piece.trim()) || !Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) {
      throw new SearchValidationError('Invalid coordinates');
    }
    point = [longitude, latitude];
  }
  return { query, category, subcategory, tags, page, limit, distance, point, listingId };
}

/** Geography columns are returned as either GeoJSON or PostGIS EWKB. */
export function listingCoordinates(location: unknown): [number, number] | null {
  let point: unknown;
  if (location && typeof location === 'object' && 'coordinates' in location) {
    point = location.coordinates;
  } else if (typeof location === 'string') {
    const wkt = location.match(/^(?:SRID=4326;)?POINT\s*\(([-\d.eE]+)\s+([-\d.eE]+)\)$/i);
    if (wkt) point = [Number(wkt[1]), Number(wkt[2])];
    else if (/^(?:[a-f\d]{2}){21,}$/i.test(location)) {
      try {
        const bytes = Buffer.from(location, 'hex');
        const littleEndian = bytes[0] === 1;
        const type = littleEndian ? bytes.readUInt32LE(1) : bytes.readUInt32BE(1);
        const offset = (type & 0x20000000) ? 9 : 5;
        if ((type & 0xffff) === 1 && bytes.length >= offset + 16) {
          point = littleEndian
            ? [bytes.readDoubleLE(offset), bytes.readDoubleLE(offset + 8)]
            : [bytes.readDoubleBE(offset), bytes.readDoubleBE(offset + 8)];
        }
      } catch { return null; }
    }
  }
  if (!Array.isArray(point) || point.length < 2 || !point.slice(0, 2).every(value => typeof value === 'number' && Number.isFinite(value))) return null;
  return Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90 ? [point[0], point[1]] : null;
}

// Quote PostgREST filter values so punctuation cannot become a second predicate.
function quotedPattern(value: string, contains = false) {
  const escaped = value.replace(/\\/g, '\\\\').replace(/[%_*]/g, '\\$&').replace(/"/g, '\\"');
  return `"${contains ? '%' : ''}${escaped}${contains ? '%' : ''}"`;
}

export async function searchListings(filters: ReturnType<typeof parseSearchQuery>) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Public search is not configured');
  // Anonymous credentials preserve public RLS even on this server route.
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const columns = `id,title,description,price,main_category,sub_category,seller_id,location,address,created_at,listing_images(url,main),listing_tags${filters.tags.length ? '!inner' : ''}(tag)`;
  let request = filters.point
    ? supabase.rpc('nearby_listings', { lon: filters.point[0], lat: filters.point[1], radius_m: filters.distance * 1000 }, { count: 'exact' }).select(columns)
    : supabase.from('listings').select(columns, { count: 'exact' }).order('created_at', { ascending: false }).order('id', { ascending: false });
  request = request.eq('status', 'active');
  if (filters.listingId) request = request.eq('id', filters.listingId);
  if (filters.category) request = request.eq('main_category', filters.category);
  if (filters.subcategory) request = request.eq('sub_category', filters.subcategory);
  if (filters.query) {
    const pattern = quotedPattern(filters.query, true);
    request = request.or(`title.ilike.${pattern},description.ilike.${pattern}`);
  }
  if (filters.tags.length) request = request.or(filters.tags.map(tag => `tag.ilike.${quotedPattern(tag)}`).join(','), { referencedTable: 'listing_tags' });
  const offset = (filters.page - 1) * filters.limit;
  const { data, count, error } = await request.range(offset, offset + filters.limit - 1);
  if (error) throw error;
  const rows = (data || []) as unknown as Array<Record<string, unknown> & { location?: unknown }>;
  const sellerIds = [...new Set(rows.map(row => row.seller_id).filter((id): id is string => typeof id === 'string'))];
  const ratings = new Map<string, { sum: number; count: number }>();
  if (sellerIds.length) {
    const { data: reviews } = await supabase.from('reviews').select('seller_id,rating').in('seller_id', sellerIds);
    for (const review of reviews || []) {
      if (typeof review.rating !== 'number') continue;
      const previous = ratings.get(review.seller_id) || { sum: 0, count: 0 };
      ratings.set(review.seller_id, { sum: previous.sum + review.rating, count: previous.count + 1 });
    }
  }
  const listings = rows.map(row => ({
    ...row,
    coordinates: listingCoordinates(row.location),
    location: undefined,
    sellerRating: typeof row.seller_id === 'string' && ratings.has(row.seller_id)
      ? ratings.get(row.seller_id)!.sum / ratings.get(row.seller_id)!.count : undefined,
  }));
  return {
    listings,
    pagination: { total: count || 0, page: filters.page, limit: filters.limit, totalPages: Math.ceil((count || 0) / filters.limit) },
    locationApplied: Boolean(filters.point),
  };
}
