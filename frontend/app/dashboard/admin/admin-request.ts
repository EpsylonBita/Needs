'use client'

import { supabase } from '@/lib/supabase/client'
import { withCsrfHeaders } from '@/lib/utils/csrf'

export async function adminRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw new Error('Unable to verify your session')
  const token = data.session?.access_token
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  const mutation = options.method && options.method !== 'GET'
  const response = await fetch(path, { ...options, headers: mutation ? await withCsrfHeaders(headers) : headers })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : body.error?.message
    throw Object.assign(new Error(message || 'The request could not be completed'), { status: response.status })
  }
  return body as T
}
