import { supabase } from '@/lib/supabase/client'
import { withCsrfHeaders } from '@/lib/utils/csrf'

export async function beginStripeOnboarding() {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error || !session?.access_token) throw new Error('Please sign in to continue onboarding.')
  const { data: profile } = await supabase.from('profiles').select('id').eq('user_id', session.user.id).single()
  if (!profile) throw new Error('Profile not found')
  const headers = await withCsrfHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` })
  if (!headers['X-CSRF-Token']) throw new Error('Could not prepare a secure request. Refresh and try again.')
  const response = await fetch('/api/payments/connect/onboard', {
    method: 'POST', headers, body: JSON.stringify({ profileId: profile.id }),
  })
  const body = await response.json()
  if (!response.ok || !body.url) throw new Error(body.error || 'Failed to start onboarding')
  return body.url as string
}
