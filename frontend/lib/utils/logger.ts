/**
 * Enhanced logging system with sanitization and structured logging
 * Integrates with AppError for comprehensive error tracking
 */

import { AppError } from './error-handler'

type Level = 'info' | 'warn' | 'error' | 'debug'

// Sensitive fields that should be sanitized
const SENSITIVE_FIELDS = [
  'password', 'token', 'secret', 'key', 'api_key', 'apikey',
  'auth', 'authorization', 'cookie', 'session', 'jwt',
  'credit_card', 'card_number', 'cvv', 'ssn', 'social_security',
  'bank_account', 'routing_number', 'pin', 'private_key'
]

// Common field patterns to sanitize
const SENSITIVE_PATTERNS = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Email addresses
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, // Credit card numbers
  /\b\d{3}-\d{2}-\d{4}\b/g, // SSN format
  /\b\d{9}\b/g, // 9-digit numbers (potential SSN)
  /\b[A-Za-z0-9]{20,}\b/g // Long alphanumeric strings (potential tokens)
]

/**
 * Sanitize sensitive data from log metadata
 */
function sanitizeMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  if (!meta || typeof meta !== 'object') {
    return meta as Record<string, unknown>
  }

  const sanitized: Record<string, unknown> = { ...meta }

  // Sanitize known sensitive fields
  for (const field of SENSITIVE_FIELDS) {
    if (field in sanitized) {
      sanitized[field] = '[REDACTED]'
    }
    // Check nested objects
    const value = sanitized[field]
    if (typeof value === 'object' && value !== null) {
      sanitized[field] = sanitizeMetadata(value as Record<string, unknown>)
    }
  }

  // Sanitize nested objects recursively
  for (const key in sanitized) {
    const value = sanitized[key]
    if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeMetadata(value as Record<string, unknown>)
    } else if (typeof value === 'string') {
      // Apply pattern-based sanitization
      let str = value as string
      for (const pattern of SENSITIVE_PATTERNS) {
        str = str.replace(pattern, '[REDACTED]')
      }
      sanitized[key] = str
    }
  }

  return sanitized
}

/**
 * Enhanced logging function with sanitization and structured output
 */
export function log(level: Level, message: string, meta?: Record<string, unknown>) {
  const sanitizedMeta = meta ? sanitizeMetadata(meta) : undefined
  
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    service: 'marketplace-app',
    ...(sanitizedMeta ? { metadata: sanitizedMeta } : {})
  }

  const line = JSON.stringify(entry)
  
  // Output to appropriate console method
  switch (level) {
    case 'error':
      console.error(line)
      break
    case 'warn':
      console.warn(line)
      break
    case 'debug':
      if (process.env.NODE_ENV === 'development') {
        console.debug(line)
      }
      break
    default:
      console.log(line)
  }
}

/**
 * Log an AppError with structured information
 */
export function logError(error: AppError, additionalContext?: Record<string, unknown>) {
  const logData = {
    ...error.toLogObject(),
    ...(additionalContext ? { additionalContext: sanitizeMetadata(additionalContext) } : {})
  }

  log('error', error.message, logData)
}

/**
 * Log authentication events with user context
 */
export function logAuth(event: string, userId?: string, additionalContext?: Record<string, unknown>) {
  const context = {
    event,
    ...(userId ? { userId } : {}),
    ...(additionalContext ? sanitizeMetadata(additionalContext) : {})
  }

  log('info', `Auth: ${event}`, context)
}

/**
 * Log security events with enhanced context
 */
export function logSecurity(event: string, severity: 'low' | 'medium' | 'high' | 'critical', context?: Record<string, unknown>) {
  const logData = {
    event,
    severity,
    ...(context ? sanitizeMetadata(context) : {})
  }

  log(severity === 'critical' || severity === 'high' ? 'error' : 'warn', `Security: ${event}`, logData)
}

/**
 * Log performance metrics
 */
export function logPerformance(operation: string, duration: number, additionalContext?: Record<string, unknown>) {
  const context = {
    operation,
    durationMs: duration,
    ...(additionalContext ? sanitizeMetadata(additionalContext) : {})
  }

  log('info', `Performance: ${operation}`, context)
}

/**
 * Log database operations with query information
 */
export function logDatabase(operation: string, table?: string, additionalContext?: Record<string, unknown>) {
  const context = {
    operation,
    ...(table ? { table } : {}),
    ...(additionalContext ? sanitizeMetadata(additionalContext) : {})
  }

  log('info', `Database: ${operation}`, context)
}

/**
 * Log external API calls with response information
 */
export function logExternalApi(service: string, operation: string, status?: number, additionalContext?: Record<string, unknown>) {
  const context = {
    service,
    operation,
    ...(status !== undefined ? { status } : {}),
    ...(additionalContext ? sanitizeMetadata(additionalContext) : {})
  }

  const level = status && status >= 400 ? 'error' : 'info'
  log(level, `External API: ${service}.${operation}`, context)
}
