import { supabase } from '@/lib/supabase/client'

export async function uploadListingImages(listingId: string, files: File[]) {
  const userRes = await supabase.auth.getUser()
  const userId = userRes.data.user?.id
  if (!userId) throw new Error('Not authenticated')
  if (!files || files.length === 0) return []

  const uploaded: { url: string; path: string }[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const ext = file.name.split('.').pop() || 'jpg'
    const path = `${userId}/${listingId}/${Date.now()}_${i}.${ext}`
    const { error } = await supabase.storage.from('listing-images').upload(path, file, {
      upsert: false,
    })
    if (error) throw error
    const { data } = supabase.storage.from('listing-images').getPublicUrl(path)
    uploaded.push({ url: data.publicUrl, path })
  }

  if (uploaded.length > 0) {
    await supabase.from('listing_images').insert(
      uploaded.map((u, idx) => ({ listing_id: listingId, url: u.url, storage_path: u.path, main: idx === 0 }))
    )
  }

  return uploaded
}

export async function listListingImages(listingId: string) {
  const { data, error } = await supabase
    .from('listing_images')
    .select('id,url,storage_path,main')
    .eq('listing_id', listingId)
    .order('main', { ascending: false })
  if (error) throw error
  return data || []
}

export async function setMainListingImage(listingId: string, imageId: string) {
  const { error: e1 } = await supabase.from('listing_images').update({ main: false }).eq('listing_id', listingId)
  if (e1) throw e1
  const { error: e2 } = await supabase.from('listing_images').update({ main: true }).eq('id', imageId)
  if (e2) throw e2
}

export async function deleteListingImage(listingId: string, imageId: string, storagePath?: string) {
  if (storagePath) {
    await supabase.storage.from('listing-images').remove([storagePath])
  }
  const { error } = await supabase.from('listing_images').delete().eq('id', imageId).eq('listing_id', listingId)
  if (error) throw error
}