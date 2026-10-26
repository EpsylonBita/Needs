import { log } from '@/lib/utils/logger'

export interface RateLimitConfig {
  key: string
  limit: number
  windowMs: number
  message?: string
  failClosed?: boolean
}

export interface RateLimitResult {
  allowed: boolean
  remaining?: number
  resetAt?: Date
  retryAfter?: number
  message?: string
}

/**
 * Database-backed fixed windows with burst protection.
 * Supports different rate limit strategies for different endpoint types
 */
export class RateLimiter {
  /**
   * The database owns time and atomically consumes one slot. No client-side
   * read/modify/write fallback is safe if the RPC or its migration is unavailable.
   */
  async limit(config: RateLimitConfig): Promise<RateLimitResult> {
    if (!config.key.trim() || config.key.length > 512 || !Number.isInteger(config.limit) || config.limit < 1
      || config.limit > 2147483647 || !Number.isInteger(config.windowMs) || config.windowMs < 1 || config.windowMs > 2147483647) {
      return { allowed: false, remaining: 0 }
    }
    try {
      const { getSupabaseAdmin } = await import('@/lib/supabase/server')
      const { data, error } = await getSupabaseAdmin().rpc('consume_rate_limit', {
        p_key: config.key, p_limit: config.limit, p_window_ms: config.windowMs,
      })
      if (error) throw new Error(error.message || 'Rate limit storage unavailable')
      const resetAt = new Date(data?.reset_at)
      if (!data || typeof data.allowed !== 'boolean' || !Number.isInteger(data.remaining)
        || data.remaining < 0 || data.remaining >= config.limit || typeof data.reset_at !== 'string'
        || !Number.isFinite(resetAt.getTime()) || !Number.isInteger(data.retry_after) || data.retry_after < 0
        || (!data.allowed && (data.remaining !== 0 || data.retry_after < 1)) || (data.allowed && data.retry_after !== 0)) {
        throw new Error('Invalid rate limit storage response')
      }
      if (!data.allowed) log('warn', 'rate_limit_exceeded', { key: config.key, limit: config.limit })
      return {
        allowed: data.allowed,
        remaining: data.remaining,
        resetAt,
        ...(!data.allowed ? { retryAfter: data.retry_after, message: config.message } : {}),
      }
    } catch (error) {
      log('error', 'rate_limit_error', {
        key: config.key,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      
      if (config.failClosed) {
        return { allowed: false, remaining: 0, retryAfter: 60, message: config.message }
      }
      return { allowed: true, remaining: config.limit }
    }
  }

  /**
   * A shorter burst window plus a longer sustained fixed window.
   * Allows bursts up to burstLimit within burstWindow, then enforces sustained limit
   */
  async limitWithBurst(config: {
    key: string
    sustainedLimit: number
    sustainedWindowMs: number
    burstLimit: number
    burstWindowMs: number
    message?: string
    failClosed?: boolean
  }): Promise<RateLimitResult> {

    // Check burst limit first (shorter window)
    const burstResult = await this.limit({
      key: `${config.key}:burst`,
      limit: config.burstLimit,
      windowMs: config.burstWindowMs,
      failClosed: config.failClosed,
    })

    if (!burstResult.allowed) {
      return {
        ...burstResult,
        message: 'Too many requests. Please slow down.',
        retryAfter: burstResult.retryAfter
      }
    }

    // Check sustained limit (longer window)
    const sustainedResult = await this.limit({
      key: `${config.key}:sustained`,
      limit: config.sustainedLimit,
      windowMs: config.sustainedWindowMs,
      failClosed: config.failClosed,
    })

    if (!sustainedResult.allowed) {
      return {
        ...sustainedResult,
        message: config.message || 'Rate limit exceeded. Please try again later.',
        retryAfter: sustainedResult.retryAfter
      }
    }

    // Both limits passed
    return {
      allowed: true,
      remaining: Math.min(burstResult.remaining!, sustainedResult.remaining!),
      resetAt: burstResult.resetAt && sustainedResult.resetAt
        ? (burstResult.resetAt < sustainedResult.resetAt ? burstResult.resetAt : sustainedResult.resetAt)
        : burstResult.resetAt ?? sustainedResult.resetAt,
    }
  }

  /**
   * Progressive rate limiting - increases limits for authenticated users
   */
  async limitProgressive(config: {
    key: string
    anonymousLimit: number
    authenticatedLimit: number
    windowMs: number
    isAuthenticated: boolean
    message?: string
    failClosed?: boolean
  }): Promise<RateLimitResult> {
    const limit = config.isAuthenticated ? config.authenticatedLimit : config.anonymousLimit
    const key = config.isAuthenticated ? `${config.key}:auth` : `${config.key}:anon`

    return this.limit({
      key,
      limit,
      windowMs: config.windowMs,
      message: config.message,
      failClosed: config.failClosed,
    })
  }

  /**
   * Clean up old rate limit entries
   */
  async cleanup(olderThanMs: number = 24 * 60 * 60 * 1000): Promise<void> {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString()
    
    try {
      const { getSupabaseAdmin } = await import('@/lib/supabase/server')
      const { error } = await getSupabaseAdmin()
        .from('rate_limits')
        .delete()
        .lt('window_start', cutoff)

      if (error) {
        log('error', 'rate_limit_cleanup_error', { error: error.message })
      } else {
        log('info', 'rate_limit_cleanup_success')
      }
    } catch (error) {
      log('error', 'rate_limit_cleanup_exception', { error })
    }
  }
}

export const rateLimiter = new RateLimiter()

/**
 * Predefined rate limit configurations for different endpoint types
 */
export const RateLimitConfigs = {
  // Authentication endpoints
  LOGIN: {
    key: (identifier: string) => `auth:login:${identifier}`,
    anonymousLimit: 5,
    authenticatedLimit: 20,
    windowMs: 15 * 60 * 1000, // 15 minutes
    message: 'Too many login attempts. Please try again later.'
  },
  
  REGISTER: {
    key: (identifier: string) => `auth:register:${identifier}`,
    limit: 3,
    windowMs: 60 * 60 * 1000, // 1 hour
    message: 'Too many registration attempts. Please try again later.'
  },

  // Public API endpoints
  PUBLIC_API: {
    key: (identifier: string) => `api:public:${identifier}`,
    anonymousLimit: 100,
    authenticatedLimit: 500,
    windowMs: 60 * 60 * 1000, // 1 hour
    message: 'API rate limit exceeded.'
  },

  // Admin endpoints
  ADMIN: {
    key: (identifier: string) => `admin:${identifier}`,
    limit: 50,
    windowMs: 60 * 1000, // 1 minute
    message: 'Admin rate limit exceeded.'
  },

  // Sensitive operations
  PAYMENTS: {
    key: (identifier: string) => `payments:${identifier}`,
    sustainedLimit: 10,
    sustainedWindowMs: 60 * 60 * 1000,
    burstLimit: 3,
    burstWindowMs: 5 * 60 * 1000,
    message: 'Too many payment attempts. Please try again later.'
  },

  MILESTONES: {
    key: (identifier: string) => `milestones:${identifier}`,
    sustainedLimit: 10,
    sustainedWindowMs: 60 * 60 * 1000,
    burstLimit: 3,
    burstWindowMs: 60 * 1000,
    message: 'Too many milestone creation attempts'
  },

  // File uploads
  UPLOAD: {
    key: (identifier: string) => `upload:${identifier}`,
    limit: 20,
    windowMs: 60 * 60 * 1000, // 1 hour
    message: 'Upload rate limit exceeded.'
  }
} as const

/**
 * Enhanced rate limiting function with better error handling and logging
 */
export async function rateLimitEnhanced(
  key: string,
  limit: number,
  windowMs: number,
  options?: {
    burstLimit?: number
    burstWindowMs?: number
    isAuthenticated?: boolean
    message?: string
    failClosed?: boolean
  }
): Promise<RateLimitResult> {
  try {
    if (options?.burstLimit && options?.burstWindowMs) {
      // Use burst protection
      return await rateLimiter.limitWithBurst({
        key,
        sustainedLimit: limit,
        sustainedWindowMs: windowMs,
        burstLimit: options.burstLimit,
        burstWindowMs: options.burstWindowMs,
        message: options.message,
        failClosed: options.failClosed,
      })
    } else if (options?.isAuthenticated !== undefined) {
      // Use progressive limiting
      return await rateLimiter.limitProgressive({
        key,
        anonymousLimit: limit,
        authenticatedLimit: options.isAuthenticated ? limit * 5 : limit,
        windowMs,
        isAuthenticated: options.isAuthenticated,
        message: options.message,
        failClosed: options.failClosed,
      })
    } else {
      // Standard rate limiting
      return await rateLimiter.limit({ key, limit, windowMs, message: options?.message, failClosed: options?.failClosed })
    }
  } catch (error) {
    log('error', 'rate_limit_enhanced_error', {
      key,
      limit,
      windowMs,
      error: error instanceof Error ? error.message : 'Unknown error'
    })
    if (options?.failClosed) {
      return { allowed: false, remaining: 0, retryAfter: 60, message: options.message }
    }
    return { allowed: true, remaining: limit }
  }
}

/**
 * Legacy rate limiting function for backward compatibility
 */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean }> {
  const result = await rateLimitEnhanced(key, limit, windowMs)
  return { allowed: result.allowed }
}
