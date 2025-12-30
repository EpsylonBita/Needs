import { NextRequest } from 'next/server'

import { supabaseAdmin } from '@/lib/supabase/server'

function getBearerToken(req: NextRequest) {
  const h = req.headers.get('authorization') || req.headers.get('Authorization') || ''
  if (!h.startsWith('Bearer ')) return ''
  return h.slice(7)
}

export async function requireAdmin(req: NextRequest) {
  try {
    // Check if Supabase is properly configured
    if (!supabaseAdmin) {
      console.error('Supabase admin client not available')
      return { allowed: false, reason: 'service_unavailable' }
    }

    const token = getBearerToken(req)
    if (!token) return { allowed: false, reason: 'missing_token' }
    
    const { data, error } = await supabaseAdmin.auth.getUser(token)
    if (error || !data?.user) return { allowed: false, reason: 'invalid_token' }
    
    const email = data.user.email || ''
    const allow = (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
    
    if (!email || !allow.includes(email.toLowerCase())) return { allowed: false, reason: 'forbidden' }
    
    return { allowed: true, user: data.user }
  } catch (error) {
    console.error('Admin auth error:', error)
    return { allowed: false, reason: 'service_error' }
  }
}
