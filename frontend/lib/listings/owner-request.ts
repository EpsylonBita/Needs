import { supabase } from '@/lib/supabase/client'

export function listingError(error: unknown): Error {
  return error instanceof Error ? error : new Error(typeof error === 'object' && error && 'message' in error ? String(error.message) : 'Listing request failed')
}

export async function requireListingUser(expectedUserId?: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const { data, error } = await supabase.auth.getUser()
  signal?.throwIfAborted()
  if (error) throw listingError(error)
  if (!data.user) throw new Error('Not authenticated')
  if (expectedUserId && data.user.id !== expectedUserId) throw new Error('Your session changed. Please try again.')
  return data.user.id
}

/** SQL checks the captured identity before making any change, including mid-request account switches. */
export async function ownedListingRpc(name: string, parameters: Record<string, unknown>, expectedUserId: string, signal?: AbortSignal): Promise<unknown> {
  await requireListingUser(expectedUserId, signal)
  let query = supabase.rpc(name, { ...parameters, p_expected_user_id: expectedUserId })
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query
  await requireListingUser(expectedUserId, signal)
  if (error) throw listingError(error)
  return data
}
