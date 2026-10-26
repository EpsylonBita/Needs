import { rateLimitEnhanced } from '@/lib/utils/rate-limit-enhanced'

/** Administrative callers share the atomic counter and reject requests when it is unavailable. */
export async function rateLimit(key: string, limit: number, windowMs: number) {
  const result = await rateLimitEnhanced(key, limit, windowMs, { failClosed: true })
  return { allowed: result.allowed }
}
