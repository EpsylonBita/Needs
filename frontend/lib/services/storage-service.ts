import { supabase } from '@/lib/supabase/client'
import { listingError, ownedListingRpc, requireListingUser } from '@/lib/listings/owner-request'
import { getMyListing, parseListingImages, type ListingImage } from '@/lib/services/listing-service'

export const LISTING_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const LISTING_IMAGE_BATCH_LIMIT = 20
export const LISTING_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }
type UploadedImage = { url: string; path: string }

async function requireOwnedListing(listingId: string, expectedUserId?: string, editing = true, signal?: AbortSignal) {
  const userId = await requireListingUser(expectedUserId, signal)
  const listing = await getMyListing(listingId, userId, signal)
  if (editing && (!listing.can_edit_images || listing.moderation_suspended)) throw new Error('Images cannot be changed while this listing is under moderation')
  return { userId, listing }
}

function readHeader(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('The image could not be read'))
    reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(new Uint8Array(reader.result)) : reject(new Error('The image could not be read'))
    reader.readAsArrayBuffer(file.slice(0, 12))
  })
}

export async function validateListingImages(files: File[]): Promise<void> {
  if (files.length > LISTING_IMAGE_BATCH_LIMIT) throw new Error('Choose up to 20 images per upload')
  for (const file of files) {
    if (!extensions[file.type] || file.size <= 0 || file.size > LISTING_IMAGE_MAX_BYTES) throw new Error('Use JPEG, PNG, WebP or GIF images up to 5 MB each')
    const bytes = await readHeader(file)
    const text = String.fromCharCode(...bytes)
    const matches = file.type === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : file.type === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)
      : file.type === 'image/gif' ? text.startsWith('GIF87a') || text.startsWith('GIF89a')
      : text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP'
    if (!matches) throw new Error('The file content does not match a supported image type')
  }
}

function canonicalPath(path: string, userId: string, listingId: string) {
  const prefix = `${userId}/${listingId}/`
  if (!path.startsWith(prefix) || !path.slice(prefix.length) || path.slice(prefix.length).includes('/') || path.includes('..')) {
    throw new Error('Image storage path does not belong to this listing')
  }
  return path
}

export async function uploadListingImages(listingId: string, files: File[], expectedUserId?: string): Promise<UploadedImage[]> {
  if (!files?.length) return []
  await validateListingImages(files)
  const { userId } = await requireOwnedListing(listingId, expectedUserId)
  const bucket = supabase.storage.from('listing-images')
  const uploaded: UploadedImage[] = []
  let attaching = false
  try {
    for (const file of files) {
      await requireListingUser(userId)
      const path = `${userId}/${listingId}/${crypto.randomUUID()}.${extensions[file.type]}`
      const { error } = await bucket.upload(path, file, { upsert: false, contentType: file.type })
      if (error) throw listingError(error)
      const { data } = bucket.getPublicUrl(path)
      uploaded.push({ url: data.publicUrl, path })
      await requireListingUser(userId)
    }
    attaching = true
    const rows = parseListingImages(await ownedListingRpc('attach_listing_images', {
      p_listing_id: listingId, p_images: uploaded.map(image => ({ url: image.url, storage_path: image.path })),
    }, userId))
    if (!uploaded.every(image => rows.some(row => row.storage_path === image.path && row.url === image.url))) throw new Error('Uploaded image metadata could not be verified')
    return uploaded
  } catch (failure) {
    let persisted: ListingImage[] = []
    if (attaching) {
      // A lost RPC response can follow a successful commit. Never remove an object
      // that is now referenced by the listing, or guess when reconciliation fails.
      try { persisted = (await getMyListing(listingId, userId)).images }
      catch { throw new Error(`${listingError(failure).message}. Photos may have been saved; refresh before trying again.`) }
      if (uploaded.every(image => persisted.some(row => row.storage_path === image.path && row.url === image.url))) return uploaded
    }
    const orphaned = uploaded.filter(image => !persisted.some(row => row.storage_path === image.path))
    if (orphaned.length) {
      try {
        await requireListingUser(userId)
        const { error } = await bucket.remove(orphaned.map(image => canonicalPath(image.path, userId, listingId)))
        if (error) throw listingError(error)
        await requireListingUser(userId)
      } catch (cleanupError) {
        throw new Error(`${listingError(failure).message}. Uploaded-file cleanup also failed: ${listingError(cleanupError).message}`)
      }
    }
    throw listingError(failure)
  }
}

export async function listListingImages(listingId: string, expectedUserId?: string, signal?: AbortSignal): Promise<ListingImage[]> {
  return (await requireOwnedListing(listingId, expectedUserId, false, signal)).listing.images
}

export async function setMainListingImage(listingId: string, imageId: string, expectedUserId?: string): Promise<ListingImage[]> {
  const { userId, listing } = await requireOwnedListing(listingId, expectedUserId)
  if (!listing.images.some(image => image.id === imageId)) throw new Error('Image does not belong to this listing')
  const rows = parseListingImages(await ownedListingRpc('set_main_listing_image', { p_listing_id: listingId, p_image_id: imageId }, userId))
  if (rows.filter(image => image.main).length !== 1 || !rows.some(image => image.id === imageId && image.main)) throw new Error('The main image change could not be verified')
  return rows
}

export async function deleteListingImage(listingId: string, imageId: string, _storagePath?: string, expectedUserId?: string): Promise<void> {
  const { userId, listing } = await requireOwnedListing(listingId, expectedUserId)
  const image = listing.images.find(row => row.id === imageId)
  if (!image) throw new Error('Image not found')
  // Canonical database metadata is the only source for object deletion.
  if (image.storage_path) {
    await requireListingUser(userId)
    const path = canonicalPath(image.storage_path, userId, listingId)
    const { error } = await supabase.storage.from('listing-images').remove([path])
    if (error) throw listingError(error)
    await requireListingUser(userId)
  }
  try {
    const data = await ownedListingRpc('delete_listing_image', { p_listing_id: listingId, p_image_id: imageId }, userId)
    if (!data || typeof data !== 'object' || !('id' in data) || data.id !== imageId) throw new Error('Image deletion could not be verified')
  } catch (failure) {
    // Retrying a completed delete is safe when its acknowledgement was lost.
    try { if (!(await getMyListing(listingId, userId)).images.some(row => row.id === imageId)) return }
    catch { /* Preserve the original failure if verification is unavailable. */ }
    throw new Error(`Image metadata could not be deleted; refresh and retry this operation. ${listingError(failure).message}`)
  }
}
