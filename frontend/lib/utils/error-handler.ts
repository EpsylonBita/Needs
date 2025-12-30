/**
 * Comprehensive error handling and logging system
 * Provides structured error handling with proper categorization and logging
 */

export enum ErrorCategory {
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  VALIDATION = 'validation',
  DATABASE = 'database',
  EXTERNAL_SERVICE = 'external_service',
  RATE_LIMIT = 'rate_limit',
  BUSINESS_LOGIC = 'business_logic',
  SYSTEM = 'system',
  NETWORK = 'network',
  SECURITY = 'security'
}

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export interface AppErrorOptions {
  category: ErrorCategory
  severity: ErrorSeverity
  code?: string
  context?: Record<string, unknown>
  originalError?: Error
  userMessage?: string
  shouldLog?: boolean
  shouldNotify?: boolean
}

/**
 * Custom application error class with structured error information
 */
export class AppError extends Error {
  public readonly category: ErrorCategory
  public readonly severity: ErrorSeverity
  public readonly code?: string
  public readonly context?: Record<string, unknown>
  public readonly originalError?: Error
  public readonly userMessage?: string
  public readonly shouldLog: boolean
  public readonly shouldNotify: boolean
  public readonly timestamp: Date

  constructor(message: string, options: AppErrorOptions) {
    super(message)
    this.name = 'AppError'
    this.category = options.category
    this.severity = options.severity
    this.code = options.code
    this.context = options.context
    this.originalError = options.originalError
    this.userMessage = options.userMessage
    this.shouldLog = options.shouldLog ?? true
    this.shouldNotify = options.shouldNotify ?? (options.severity === ErrorSeverity.CRITICAL)
    this.timestamp = new Date()

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError)
    }
  }

  /**
   * Get a user-friendly error message
   */
  getUserMessage(): string {
    return this.userMessage || this.getDefaultUserMessage()
  }

  /**
   * Get default user message based on error category
   */
  private getDefaultUserMessage(): string {
    switch (this.category) {
      case ErrorCategory.AUTHENTICATION:
        return 'Authentication failed. Please check your credentials and try again.'
      case ErrorCategory.AUTHORIZATION:
        return 'You do not have permission to perform this action.'
      case ErrorCategory.VALIDATION:
        return 'Please check your input and try again.'
      case ErrorCategory.DATABASE:
        return 'A database error occurred. Please try again later.'
      case ErrorCategory.EXTERNAL_SERVICE:
        return 'An external service error occurred. Please try again later.'
      case ErrorCategory.RATE_LIMIT:
        return 'Too many requests. Please try again later.'
      case ErrorCategory.BUSINESS_LOGIC:
        return 'This operation cannot be completed at this time.'
      case ErrorCategory.SYSTEM:
        return 'A system error occurred. Please try again later.'
      case ErrorCategory.NETWORK:
        return 'A network error occurred. Please check your connection and try again.'
      case ErrorCategory.SECURITY:
        return 'A security error occurred. Please try again.'
      default:
        return 'An unexpected error occurred. Please try again later.'
    }
  }

  /**
   * Convert error to structured log object
   */
  toLogObject(): Record<string, unknown> {
    return {
      error: this.message,
      category: this.category,
      severity: this.severity,
      code: this.code,
      context: this.context,
      stack: this.stack,
      originalError: this.originalError?.message,
      timestamp: this.timestamp.toISOString()
    }
  }

  /**
   * Convert error to JSON for API responses
   */
  toJSON(): Record<string, unknown> {
    return {
      error: this.getUserMessage(),
      code: this.code,
      category: this.category,
      severity: this.severity,
      field: typeof this.context?.field === 'string' ? this.context.field : undefined,
      timestamp: this.timestamp.toISOString()
    }
  }
}

/**
 * Error factory for creating common error types
 */
export class ErrorFactory {
  static authentication(message: string, options?: Partial<AppErrorOptions>): AppError {
    return new AppError(message, {
      category: ErrorCategory.AUTHENTICATION,
      severity: ErrorSeverity.HIGH,
      code: 'AUTH_ERROR',
      ...options
    })
  }

  static authorization(message: string, options?: Partial<AppErrorOptions>): AppError {
    return new AppError(message, {
      category: ErrorCategory.AUTHORIZATION,
      severity: ErrorSeverity.HIGH,
      code: 'AUTHZ_ERROR',
      ...options
    })
  }

  static validation(message: string, field?: string, options?: Partial<AppErrorOptions>): AppError {
    return new AppError(message, {
      category: ErrorCategory.VALIDATION,
      severity: ErrorSeverity.MEDIUM,
      code: field ? `VALIDATION_${field.toUpperCase()}` : 'VALIDATION_ERROR',
      ...options
    })
  }

  static database(message: string, options?: Partial<AppErrorOptions>): AppError {
    return new AppError(message, {
      category: ErrorCategory.DATABASE,
      severity: ErrorSeverity.HIGH,
      code: 'DB_ERROR',
      ...options
    })
  }

  static externalService(service: string, message: string, options?: Partial<AppErrorOptions>): AppError {
    return new AppError(message, {
      category: ErrorCategory.EXTERNAL_SERVICE,
      severity: ErrorSeverity.MEDIUM,
      code: `${service.toUpperCase()}_ERROR`,
      context: { service },
      ...options
    })
  }

  static rateLimit(message: string = 'Too many requests', options?: Partial<AppErrorOptions>): AppError {
    return new AppError(message, {
      category: ErrorCategory.RATE_LIMIT,
      severity: ErrorSeverity.MEDIUM,
      code: 'RATE_LIMIT_ERROR',
      ...options
    })
  }

  static businessLogic(message: string, options?: Partial<AppErrorOptions>): AppError {
    return new AppError(message, {
      category: ErrorCategory.BUSINESS_LOGIC,
      severity: ErrorSeverity.MEDIUM,
      code: 'BUSINESS_ERROR',
      ...options
    })
  }

  static system(message: string, options?: Partial<AppErrorOptions>): AppError {
    return new AppError(message, {
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.CRITICAL,
      code: 'SYSTEM_ERROR',
      shouldNotify: true,
      ...options
    })
  }

  static security(message: string, options?: Partial<AppErrorOptions>): AppError {
    return new AppError(message, {
      category: ErrorCategory.SECURITY,
      severity: ErrorSeverity.CRITICAL,
      code: 'SECURITY_ERROR',
      shouldNotify: true,
      ...options
    })
  }

  static network(message: string, options?: Partial<AppErrorOptions>): AppError {
    return new AppError(message, {
      category: ErrorCategory.NETWORK,
      severity: ErrorSeverity.MEDIUM,
      code: 'NETWORK_ERROR',
      ...options
    })
  }
}

/**
 * Async error wrapper for handling errors in async functions
 */
export async function withErrorHandling<T>(
  fn: () => Promise<T>,
  options: {
    fallback?: T
    onError?: (error: Error) => void
    rethrow?: boolean
  } = {}
): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (options.onError) {
      options.onError(error instanceof Error ? error : new Error(String(error)))
    }

    if (options.rethrow) {
      throw error
    }

    return options.fallback as T
  }
}

/**
 * Error boundary handler for API routes
 */
import { NextResponse, NextRequest } from 'next/server'

export function handleApiError(error: unknown): {
  status: number
  response: Record<string, unknown>
} {
  if (error instanceof AppError) {
    // Structured application error
    const status = getStatusCodeForError(error)
    return {
      status,
      response: error.toJSON()
    }
  }

  if (error instanceof Error) {
    // Generic error - wrap in AppError
    const appError = ErrorFactory.system(error.message, {
      originalError: error,
      userMessage: 'An unexpected error occurred. Please try again later.'
    })
    
    return {
      status: 500,
      response: appError.toJSON()
    }
  }

  // Unknown error type
  const appError = ErrorFactory.system('Unknown error occurred')
  return {
    status: 500,
    response: appError.toJSON()
  }
}

/**
 * Get HTTP status code for error category
 */
function getStatusCodeForError(error: AppError): number {
  switch (error.category) {
    case ErrorCategory.AUTHENTICATION:
      return 401
    case ErrorCategory.AUTHORIZATION:
      return 403
    case ErrorCategory.VALIDATION:
      return 400
    case ErrorCategory.RATE_LIMIT:
      return 429
    case ErrorCategory.BUSINESS_LOGIC:
      return 404
    case ErrorCategory.SECURITY:
      return 403
    default:
      return 500
  }
}

/**
 * Validation error helper
 */
export function createValidationError(field: string, message: string): AppError {
  return ErrorFactory.validation(message, field, {
    context: { field },
    userMessage: message
  })
}

export function withApiErrorHandler<T extends (req: NextRequest) => Promise<Response | NextResponse>>(handler: T) {
  return async function (req: NextRequest): Promise<Response | NextResponse> {
    try {
      return await handler(req)
    } catch (error) {
      const { status, response } = handleApiError(error)
      const rid = req.headers.get('x-request-id') || crypto.randomUUID()
      const res = { ...response, requestId: rid }
      return NextResponse.json(res, { status, headers: { 'X-Request-Id': rid } })
    }
  }
}
