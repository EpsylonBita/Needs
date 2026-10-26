import { supabase } from '@/lib/supabase/client'
import { ownedListingRpc, requireListingUser } from '@/lib/listings/owner-request'
import { listingPriceNeedsConfirmation, RATE_PRICE_REQUIRED_ERROR } from '@/lib/listings/price-policy'

export const LISTING_TITLE_MAX = 200
export const LISTING_DESCRIPTION_MAX = 10000
export const LISTING_CONTACT_MAX = 50
export const LISTING_TAG_MAX = 50
export const LISTING_TAG_LIMIT = 20
export type ListingStatus = 'active' | 'sold' | 'suspended'
export type ListingImage = { id: string; url: string; main: boolean; storage_path?: string | null }
export type OwnedListing = {
  id: string; seller_id: string; title: string; description: string; price: number
  main_category: CreateListingInput['main_category']; sub_category: CreateListingInput['sub_category']
  status: ListingStatus; owner_status: ListingStatus; moderation_suspended: boolean; created_at: string
  address: Record<string, unknown> | null; coordinates: [number, number] | null; contact_number: string | null
  tags: string[]; images: ListingImage[]
  can_edit: boolean; can_edit_images: boolean; category_locked: boolean; price_locked: boolean
}

export type CreateListingInput = {
  title: string
  description: string
  main_category: 'Items' | 'Services'
  sub_category: 'Buy' | 'Sell' | 'Free' | 'I want' | 'I will' | 'I can'
  price?: string | number
  tags?: string[]
  coordinates?: [number, number] | null
  address?: Record<string, unknown> | string | null
  contact_number?: string
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
  location: string
  contact_number?: string
}

export function parseListingPrice(value: string | number | undefined): number {
  if (value === undefined || value === '') return 0
  const normalized = typeof value === 'string' ? value.trim().replace(/\s*€\s*$/, '').replace(',', '.') : value
  if (typeof normalized === 'string' && !/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error('Enter a valid non-negative price with up to two decimal places')
  }
  const price = Number(normalized)
  if (!Number.isFinite(price) || price < 0 || price > 9999999999.99 || Math.abs(price * 100 - Math.round(price * 100)) > 0.0001) {
    throw new Error('Enter a valid non-negative price with up to two decimal places')
  }
  return price
}

export async function createListing(input: CreateListingInput) {
  const priceNum = parseListingPrice(input.price)
  const allowedSubcategories = input.main_category === 'Items' ? ['Buy', 'Sell', 'Free'] : input.main_category === 'Services' ? ['I want', 'I will', 'I can'] : []
  if (!allowedSubcategories.includes(input.sub_category)) throw new Error('Choose a valid category and subcategory')
  if (listingPriceNeedsConfirmation(priceNum, input.description, input.main_category, input.sub_category)) throw new Error(RATE_PRICE_REQUIRED_ERROR)
  if (input.title.trim().length < 3 || input.description.trim().length < 10) throw new Error('Enter a title and description for your listing')
  if (!input.coordinates || input.coordinates.length !== 2 || !input.coordinates.every(Number.isFinite)
    || Math.abs(input.coordinates[0]) > 180 || Math.abs(input.coordinates[1]) > 90) {
    throw new Error('Select a valid location on the map')
  }
  const userRes = await supabase.auth.getUser()
  if (userRes.error) throw userRes.error
  const userId = userRes.data.user?.id
  if (!userId) throw new Error('Not authenticated')

  // Get profile id for seller
  const { data: profileRows, error: profileError } = await supabase
    .from('profiles')
    .select('id, stripe_account_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)

  const profile = (profileRows || [])[0]
  if (profileError) throw profileError
  if (!profile?.id) throw new Error('Profile not found')
  const acceptsPayment = priceNum > 0 && ['Sell', 'I will', 'I can'].includes(input.sub_category)
  if (acceptsPayment && !profile?.stripe_account_id) throw new Error('Seller not onboarded')

  const insertPayload: InsertPayload = {
    seller_id: profile.id,
    title: input.title.trim(),
    description: input.description.trim(),
    price: input.sub_category === 'Free' ? 0 : priceNum,
    main_category: input.main_category,
    sub_category: input.sub_category,
    status: 'active',
    address: typeof input.address === 'string' ? { label: input.address } : input.address || null,
    location: `SRID=4326;POINT(${input.coordinates[0]} ${input.coordinates[1]})`,
    contact_number: input.contact_number?.trim(),
  }

  const { data: listing, error } = await supabase
    .from('listings')
    .insert(insertPayload)
    .select('id')
    .single()

  if (error) throw error
  if (!listing?.id) throw new Error('Listing could not be saved')

  if (input.tags && input.tags.length > 0) {
    const { error: tagError } = await supabase.from('listing_tags').insert(
      [...new Set(input.tags.map(tag => tag.trim()).filter(Boolean))].map((tag) => ({ listing_id: listing.id, tag }))
    )
    if (tagError) {
      const { error: rollbackError } = await supabase.from('listings').delete().eq('id', listing.id)
      if (rollbackError) throw new Error(`Tags could not be saved. The listing ${listing.id} remains in My Listings; edit it there before trying again.`)
      throw tagError
    }
  }

  return listing
}

export function parseListingImages(value: unknown): ListingImage[] {
  if (!Array.isArray(value) || value.some(image => !image || typeof image.id !== 'string' || typeof image.url !== 'string'
    || typeof image.main !== 'boolean' || (image.storage_path != null && typeof image.storage_path !== 'string'))) {
    throw new Error('Listing images could not be loaded')
  }
  return value as ListingImage[]
}

function validCoordinates(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90
}

function parseOwnedListing(value: unknown, expectedId?: string): OwnedListing {
  if (!value || typeof value !== 'object') throw new Error('Listing could not be loaded')
  const row = value as OwnedListing
  if (!row.id || (expectedId && row.id !== expectedId) || typeof row.seller_id !== 'string' || typeof row.title !== 'string' || typeof row.description !== 'string'
    || !['Items', 'Services'].includes(row.main_category) || !['Buy', 'Sell', 'Free', 'I want', 'I will', 'I can'].includes(row.sub_category)
    || !['active', 'sold', 'suspended'].includes(row.status) || !['active', 'sold', 'suspended'].includes(row.owner_status)
    || [row.moderation_suspended, row.can_edit, row.can_edit_images, row.category_locked, row.price_locked].some(flag => typeof flag !== 'boolean')
    || (row.coordinates !== null && !validCoordinates(row.coordinates)) || !Array.isArray(row.tags) || row.tags.some(tag => typeof tag !== 'string')) {
    throw new Error('Listing could not be loaded')
  }
  return { ...row, price: parseListingPrice(row.price), images: parseListingImages(row.images) }
}

export async function getMyListings(expectedUserId?: string, signal?: AbortSignal): Promise<OwnedListing[]> {
  const userId = await requireListingUser(expectedUserId, signal)
  const data = await ownedListingRpc('get_my_listings', {}, userId, signal)
  if (!Array.isArray(data)) throw new Error('Listings could not be loaded')
  return data.map(row => parseOwnedListing(row))
}

export async function getMyListing(id: string, expectedUserId: string, signal?: AbortSignal): Promise<OwnedListing> {
  if (!id) throw new Error('Choose a listing first')
  const data = await ownedListingRpc('get_my_listing', { p_listing_id: id }, expectedUserId, signal)
  return parseOwnedListing(data, id)
}

export function normalizeListingEdit(input: CreateListingInput) {
  const title = input.title.trim()
  const description = input.description.trim()
  const contact = input.contact_number?.trim() || null
  const titleLength = Array.from(title).length
  const descriptionLength = Array.from(description).length
  if (titleLength < 3 || titleLength > LISTING_TITLE_MAX) throw new Error('Title must contain 3 to 200 characters')
  if (descriptionLength < 10 || descriptionLength > LISTING_DESCRIPTION_MAX) throw new Error('Description must contain 10 to 10000 characters')
  if (contact && Array.from(contact).length > LISTING_CONTACT_MAX) throw new Error('Contact number is too long')
  const allowed = input.main_category === 'Items' ? ['Buy', 'Sell', 'Free'] : input.main_category === 'Services' ? ['I want', 'I will', 'I can'] : []
  if (!allowed.includes(input.sub_category)) throw new Error('Choose a valid category and subcategory')
  const price = input.sub_category === 'Free' ? 0 : parseListingPrice(input.price)
  if (listingPriceNeedsConfirmation(price, description, input.main_category, input.sub_category)) throw new Error(RATE_PRICE_REQUIRED_ERROR)
  if (input.coordinates != null && !validCoordinates(input.coordinates)) throw new Error('Select a valid location on the map')
  const tags = [...new Set((input.tags ?? []).map(tag => tag.trim()).filter(Boolean))]
  if (tags.length > LISTING_TAG_LIMIT || tags.some(tag => Array.from(tag).length > LISTING_TAG_MAX)) throw new Error('Use up to 20 tags with at most 50 characters each')
  const address = typeof input.address === 'string' ? { label: input.address.trim() } : input.address ?? null
  if (address !== null && (typeof address !== 'object' || Array.isArray(address))) throw new Error('Enter a valid address')
  return {
    title, description, main_category: input.main_category, sub_category: input.sub_category,
    price,
    coordinates: input.coordinates ?? null, address, contact_number: contact, tags,
  }
}

export async function updateListing(id: string, input: CreateListingInput, expectedUserId: string): Promise<OwnedListing> {
  if (!id) throw new Error('Choose a listing first')
  // Construct an explicit payload so accidental identity/status/moderation fields can never be sent.
  const normalized = normalizeListingEdit(input)
  const data = await ownedListingRpc('update_my_listing', { p_listing_id: id, p_input: normalized }, expectedUserId)
  const saved = parseOwnedListing(data, id)
  if (saved.title !== normalized.title || saved.description !== normalized.description || saved.price !== normalized.price
    || saved.main_category !== normalized.main_category || saved.sub_category !== normalized.sub_category
    || saved.contact_number !== normalized.contact_number || JSON.stringify([...saved.tags].sort()) !== JSON.stringify([...normalized.tags].sort())
    || (normalized.coordinates && (saved.coordinates?.[0] !== normalized.coordinates[0] || saved.coordinates?.[1] !== normalized.coordinates[1]))) {
    throw new Error('The saved listing could not be verified. Refresh before trying again.')
  }
  return saved
}

export async function updateListingStatus(id: string, status: ListingStatus, expectedUserId?: string): Promise<OwnedListing> {
  if (!id || !['active', 'sold', 'suspended'].includes(status)) throw new Error('Choose a valid listing status')
  const userId = await requireListingUser(expectedUserId)
  const saved = parseOwnedListing(await ownedListingRpc('update_my_listing_status', { p_listing_id: id, p_status: status }, userId), id)
  if (saved.status !== status || saved.owner_status !== status) throw new Error('The saved listing status could not be verified')
  return saved
}

export async function deleteListing(id: string, expectedUserId?: string): Promise<void> {
  if (!id) throw new Error('Choose a listing first')
  const userId = await requireListingUser(expectedUserId)
  const data = await ownedListingRpc('delete_my_listing', { p_listing_id: id }, userId)
  if (!data || typeof data !== 'object' || !('id' in data) || data.id !== id) throw new Error('Listing could not be deleted. Refresh your listings and try again.')
}
