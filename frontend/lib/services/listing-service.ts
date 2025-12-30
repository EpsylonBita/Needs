import { supabase } from '@/lib/supabase/client'

export type CreateListingInput = {
  title: string
  description: string
  main_category: 'Items' | 'Services'
  sub_category: 'Buy' | 'Sell' | 'Free' | 'I want' | 'I will' | 'I can'
  price?: string | number
  tags?: string[]
  coordinates?: [number, number] | null
  address?: Record<string, unknown> | string | null
}

type InsertPayload = {
  seller_id: string
  title: string
  description: string
  price: number
  main_category: 'Items' | 'Services'
  sub_category: 'Buy' | 'Sell' | 'Free' | 'I want' | 'I will' | 'I can'
  status: 'active' | 'sold' | 'suspended'
  address: Record<string, unknown> | null
  location?: { type: 'Point'; coordinates: [number, number] } | null
}

export async function createListing(input: CreateListingInput) {
  const userRes = await supabase.auth.getUser()
  const userId = userRes.data.user?.id
  if (!userId) throw new Error('Not authenticated')

  const priceNum = input.price === undefined || input.price === ''
    ? 0
    : typeof input.price === 'string'
      ? Number(input.price.replace(/[^0-9.]/g, ''))
      : input.price

  const point = input.coordinates
    ? { type: 'Point' as const, coordinates: input.coordinates }
    : null

  // Get profile id for seller
  const { data: profileRows } = await supabase
    .from('profiles')
    .select('id, stripe_account_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)

  const profile = (profileRows || [])[0]
  if (!profile?.id) throw new Error('Profile not found')
  if (!profile?.stripe_account_id) throw new Error('Seller not onboarded')

  const insertPayload: InsertPayload = {
    seller_id: profile.id,
    title: input.title,
    description: input.description,
    price: priceNum,
    main_category: input.main_category,
    sub_category: input.sub_category,
    status: 'active',
    address: typeof input.address === 'string' ? { label: input.address } : input.address || null,
  }

  if (point) insertPayload.location = point

  const { data: listing, error } = await supabase
    .from('listings')
    .insert(insertPayload)
    .select('id')
    .single()

  if (error) throw error

  if (input.tags && input.tags.length > 0) {
    await supabase.from('listing_tags').insert(
      input.tags.map((tag) => ({ listing_id: listing!.id, tag }))
    )
  }

  return listing
}

export async function getMyListings() {
  const userRes = await supabase.auth.getUser()
  const userId = userRes.data.user?.id
  if (!userId) throw new Error('Not authenticated')
  const prof = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
  const pid = (prof.data || [])[0]?.id
  if (!pid) return []
  const { data, error } = await supabase
    .from('listings')
    .select('id,title,description,price,main_category,sub_category,status')
    .eq('seller_id', pid)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function updateListingStatus(id: string, status: 'active' | 'sold' | 'suspended') {
  const { error } = await supabase
    .from('listings')
    .update({ status })
    .eq('id', id)
  if (error) throw error
}

export async function deleteListing(id: string) {
  const { error } = await supabase
    .from('listings')
    .delete()
    .eq('id', id)
  if (error) throw error
}
