import { createClient } from '@supabase/supabase-js'
import { listingCoordinates } from '@/app/api/search/search-query'
import { getProductIdentity } from './matching'
import type { ComparableListing, PricingSubject } from './types'

function client(token?: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Public data unavailable')
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}),
  })
}

function parse(row: Record<string, unknown>): ComparableListing | null {
  if (typeof row.id !== 'string' || typeof row.seller_id !== 'string' || typeof row.title !== 'string'
    || typeof row.description !== 'string' || !['Items', 'Services'].includes(String(row.main_category))
    || !['Sell', 'I will', 'I can'].includes(String(row.sub_category)) || row.status !== 'active'
    || (typeof row.price !== 'number' && typeof row.price !== 'string')) return null
  const price = Number(row.price)
  if (!Number.isFinite(price) || price < 0) return null
  return { id: row.id, sellerId: row.seller_id, title: row.title, description: row.description, price,
    mainCategory: row.main_category as PricingSubject['mainCategory'], subCategory: row.sub_category as PricingSubject['subCategory'], coordinates: listingCoordinates(row.location) }
}
const columns = 'id,seller_id,title,description,price,main_category,sub_category,location,status'

export async function publicListing(id: string): Promise<PricingSubject | null> {
  // Always anonymous: a private/suspended listing must not become visible through comparison APIs.
  const { data, error } = await client().from('listings').select(columns).eq('id', id).eq('status', 'active').abortSignal(AbortSignal.timeout(6000)).maybeSingle()
  if (error) throw new Error('Public data unavailable')
  return data ? parse(data) : null
}

export async function pricingUser(token: string): Promise<{ id: string; sellerIds: string[] } | null> {
  const scoped = client(token)
  const { data, error } = await scoped.auth.getUser(token)
  if (error || !data.user) return null
  const { data: profiles, error: profileError } = await scoped.from('profiles').select('id').eq('user_id', data.user.id).abortSignal(AbortSignal.timeout(6000))
  if (profileError) throw new Error('Profile unavailable')
  return { id: data.user.id, sellerIds: (profiles || []).map(row => row.id) }
}

export async function publicComparables(subject: PricingSubject, excludedSellers: string[]): Promise<ComparableListing[]> {
  const identity = subject.mainCategory === 'Items' ? getProductIdentity(subject) : null
  if (subject.mainCategory === 'Items' && !identity) return []
  const escapePattern = (value: string) => value.replace(/[%_\\]/g, '\\$&')
  // A canonical model removes punctuation and sometimes a family name. Searching it
  // verbatim would miss 'Sony WH-1000XM5' and 'Samsung Galaxy S25'. This is only
  // a bounded prefilter; matching.ts must still prove the complete identity.
  const search = identity ? identity.model.split(' ').at(-1)! : subject.title.trim().split(/\s+/).sort((a, b) => b.length - a.length)[0]
  if (!search) return []
  const pattern = identity ? `%${(search.match(/[a-z]+|\d+/gi) || [search]).map(escapePattern).join('%')}%` : `%${escapePattern(search)}%`
  const { data, error } = await client().from('listings').select(columns)
    .eq('status', 'active').eq('main_category', subject.mainCategory)
    .in('sub_category', subject.mainCategory === 'Items' ? ['Sell'] : ['I will', 'I can'])
    .gt('price', 0).gte('created_at', new Date(Date.now() - 180 * 86400000).toISOString())
    .ilike('title', pattern).order('created_at', { ascending: false }).limit(100).abortSignal(AbortSignal.timeout(6000))
  if (error) throw new Error('Public data unavailable')
  return (data || []).map(row => parse(row)).filter((row): row is ComparableListing => row !== null && !excludedSellers.includes(row.sellerId))
}
