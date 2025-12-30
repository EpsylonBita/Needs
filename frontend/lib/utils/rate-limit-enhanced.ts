import { getSupabaseAdmin } from '@/lib/supabase/server'
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
 * Advanced rate limiting with sliding window and burst protection
 * Supports different rate limit strategies for different endpoint types
 */
export class RateLimiter {
  private supabase = getSupabaseAdmin()

  /**
   * Standard rate limiting with sliding window
   */
  async limit(config: RateLimitConfig): Promise<RateLimitResult> {
    const now = Date.now()
    const windowStart = new Date(Math.floor(now / config.windowMs) * config.windowMs)
    const windowEnd = new Date(windowStart.getTime() + config.windowMs)

    try {
      // Get current count for this window
      const { data } = await this.supabase
        .from('rate_limits')
        .select('count')
        .eq('key', config.key)
        .eq('window_start', windowStart.toISOString())
        .limit(1)

      const current = data?.[0]?.count || 0
      const remaining = Math.max(0, config.limit - current)

      if (current >= config.limit) {
        // Rate limit exceeded
        log('warn', 'rate_limit_exceeded', {
          key: config.key,
          limit: config.limit,
          current,
          windowStart: windowStart.toISOString()
        })

        return {
          allowed: false,
          remaining: 0,
          resetAt: windowEnd,
          retryAfter: Math.ceil((windowEnd.getTime() - now) / 1000)
        }
      }

      // Increment counter
      if (current === 0) {
        await this.supabase
          .from('rate_limits')
          .insert({ 
            key: config.key, 
            window_start: windowStart.toISOString(), 
            count: 1 
          })
      } else {
        await this.supabase
          .from('rate_limits')
          .update({ count: current + 1 })
          .eq('key', config.key)
          .eq('window_start', windowStart.toISOString())
      }

      return {
        allowed: true,
        remaining: remaining - 1,
        resetAt: windowEnd
      }

    } catch (error) {
      log('error', 'rate_limit_error', {
        key: config.key,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      
      if (config.failClosed) {
        return { allowed: false, remaining: 0 }
      }
      return { allowed: true, remaining: config.limit }
    }
  }

  /**
   * Sliding window rate limit with burst protection
   * Allows bursts up to burstLimit within burstWindow, then enforces sustained limit
   */
  async limitWithBurst(config: {
    key: string
    sustainedLimit: number
    sustainedWindowMs: number
    burstLimit: number
    burstWindowMs: number
    message?: string
  }): Promise<RateLimitResult> {

    // Check burst limit first (shorter window)
    const burstResult = await this.limit({
      key: `${config.key}:burst`,
      limit: config.burstLimit,
      windowMs: config.burstWindowMs
    })

    if (!burstResult.allowed) {
      return {
        allowed: false,
        message: 'Too many requests. Please slow down.',
        retryAfter: burstResult.retryAfter
      }
    }

    // Check sustained limit (longer window)
    const sustainedResult = await this.limit({
      key: `${config.key}:sustained`,
      limit: config.sustainedLimit,
      windowMs: config.sustainedWindowMs
    })

    if (!sustainedResult.allowed) {
      return {
        allowed: false,
        message: config.message || 'Rate limit exceeded. Please try again later.',
        retryAfter: sustainedResult.retryAfter
      }
    }

    // Both limits passed
    return {
      allowed: true,
      remaining: Math.min(burstResult.remaining!, sustainedResult.remaining!),
      resetAt: burstResult.resetAt! < sustainedResult.resetAt! ? burstResult.resetAt! : sustainedResult.resetAt!
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
  }): Promise<RateLimitResult> {
    const limit = config.isAuthenticated ? config.authenticatedLimit : config.anonymousLimit
    const key = config.isAuthenticated ? `${config.key}:auth` : `${config.key}:anon`

    return this.limit({
      key,
      limit,
      windowMs: config.windowMs,
      message: config.message
    })
  }

  /**
   * Clean up old rate limit entries
   */
  async cleanup(olderThanMs: number = 24 * 60 * 60 * 1000): Promise<void> {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString()
    
    try {
      const { error } = await this.supabase
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
      return rateLimiter.limitWithBurst({
        key,
        sustainedLimit: limit,
        sustainedWindowMs: windowMs,
        burstLimit: options.burstLimit,
        burstWindowMs: options.burstWindowMs,
        message: options.message
      })
    } else if (options?.isAuthenticated !== undefined) {
      // Use progressive limiting
      return rateLimiter.limitProgressive({
        key,
        anonymousLimit: limit,
        authenticatedLimit: options.isAuthenticated ? limit * 5 : limit,
        windowMs,
        isAuthenticated: options.isAuthenticated,
        message: options.message
      })
    } else {
      // Standard rate limiting
      return rateLimiter.limit({ key, limit, windowMs, message: options?.message, failClosed: options?.failClosed })
    }
  } catch (error) {
    log('error', 'rate_limit_enhanced_error', {
      key,
      limit,
      windowMs,
      error: error instanceof Error ? error.message : 'Unknown error'
    })
    if (options?.failClosed) {
      return { allowed: false, remaining: 0 }
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
