import { supabaseAdmin } from '@/lib/supabase/server'
import { ErrorFactory } from '@/lib/utils/error-handler'

export function assertOrderUser(expectedUserId: unknown, userId: string, required = false) {
  if ((required || expectedUserId !== undefined) && expectedUserId !== userId) {
    throw ErrorFactory.authorization('Your account changed. Refresh and try again.', { userMessage: 'Your account changed. Refresh and try again.' })
  }
}

export async function requireOrderPaymentsEnabled() {
  const flag = await supabaseAdmin.from('feature_flags').select('enabled').eq('key', 'payments_enabled').single()
  if ((process.env.NEXT_PUBLIC_PAYMENTS_ENABLED || '').toLowerCase() !== 'true' && (flag.error || flag.data?.enabled !== true)) {
    throw ErrorFactory.authorization('Payments are currently disabled', { userMessage: 'Payments are currently disabled' })
  }
}
