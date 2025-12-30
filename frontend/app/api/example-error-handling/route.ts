/**
 * Example API route demonstrating proper error handling and logging
 * This shows how to use the new error handling system in practice
 */

import { NextRequest, NextResponse } from 'next/server'
import { AppError, ErrorFactory, handleApiError, withErrorHandling, withApiErrorHandler } from '@/lib/utils/error-handler'
import { log, logError, logAuth, logSecurity, logPerformance, logDatabase, logExternalApi } from '@/lib/utils/logger'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

// Example validation schema
const ExampleSchema = z.object({
  userId: z.string().uuid(),
  action: z.enum(['create', 'update', 'delete']),
  data: z.object({
    title: z.string().min(1).max(100),
    description: z.string().optional()
  })
})

type ExampleRequest = z.infer<typeof ExampleSchema>

/**
 * GET endpoint - demonstrates basic error handling
 */
export const GET = withApiErrorHandler(async (request: NextRequest) => {
  const startTime = Date.now()
  
    log('info', 'GET request received', { 
      url: request.url,
      method: 'GET'
    })

    // Simulate some work with performance logging
    const result = await withErrorHandling(
      async () => {
        // Simulate database query
        await new Promise(resolve => setTimeout(resolve, 100))
        return { data: 'example data' }
      },
      {
        fallback: { data: 'fallback data' },
        onError: (error) => {
          logError(
            ErrorFactory.database('Database query failed', {
              originalError: error,
              context: { operation: 'example_query' }
            }),
            { endpoint: 'GET /api/example' }
          )
        }
      }
    )

    // Log successful operation
    logPerformance('example_operation', Date.now() - startTime, {
      operation: 'GET',
      status: 'success'
    })

    return NextResponse.json(result)
})

/**
 * POST endpoint - demonstrates comprehensive error handling
 */
export const POST = withApiErrorHandler(async (request: NextRequest) => {
  const startTime = Date.now()
  let userId: string | undefined
  
    // Log request start
    log('info', 'POST request received', { 
      url: request.url,
      method: 'POST'
    })

    // Get Supabase configuration
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
    
    if (!url || !anon) {
      throw ErrorFactory.system('Missing Supabase configuration')
    }

    // Validate request body
    const body = await request.json().catch(() => {
      throw ErrorFactory.validation('Invalid JSON in request body')
    })

    const validationResult = ExampleSchema.safeParse(body)
    if (!validationResult.success) {
      const fieldErrors = validationResult.error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message
      }))
      
      logSecurity('validation_failed', 'low', {
        endpoint: 'POST /api/example',
        fieldErrors
      })

      throw ErrorFactory.validation('Request validation failed', undefined, {
        context: { fieldErrors },
        userMessage: 'Please check your input and try again.'
      })
    }

    const validatedData: ExampleRequest = validationResult.data
    userId = validatedData.userId

    // Log authentication event
    logAuth('api_request', userId, {
      endpoint: 'POST /api/example',
      action: validatedData.action
    })

    // Get authenticated user
    const supabase = createClient(url, anon)
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      logSecurity('unauthorized_api_access', 'medium', {
        endpoint: 'POST /api/example',
        attemptedUserId: userId
      })
      
      throw ErrorFactory.authentication('User not authenticated', {
        context: { attemptedUserId: userId }
      })
    }

    // Authorization check
    if (user.id !== validatedData.userId) {
      logSecurity('authorization_violation', 'high', {
        endpoint: 'POST /api/example',
        authenticatedUserId: user.id,
        requestedUserId: validatedData.userId
      })

      throw ErrorFactory.authorization('Users can only modify their own data')
    }

    // Log database operation
    logDatabase(validatedData.action, 'example_table', {
      userId,
      action: validatedData.action
    })

    // Simulate database operation with error handling
    let result
    switch (validatedData.action) {
      case 'create':
        result = await withErrorHandling(
          async () => {
            // Simulate create operation
            await new Promise(resolve => setTimeout(resolve, 200))
            return { 
              id: '123e4567-e89b-12d3-a456-426614174000',
              ...validatedData.data,
              createdAt: new Date().toISOString()
            }
          },
          {
            rethrow: true,
            onError: (error) => {
              logError(
                ErrorFactory.database('Create operation failed', {
                  originalError: error,
                  context: { userId, data: validatedData.data }
                }),
                { operation: 'create', userId }
              )
            }
          }
        )
        break

      case 'update':
        result = await withErrorHandling(
          async () => {
            // Simulate update operation
            await new Promise(resolve => setTimeout(resolve, 150))
            return { 
              id: '123e4567-e89b-12d3-a456-426614174000',
              ...validatedData.data,
              updatedAt: new Date().toISOString()
            }
          },
          {
            rethrow: true,
            onError: (error) => {
              logError(
                ErrorFactory.database('Update operation failed', {
                  originalError: error,
                  context: { userId, data: validatedData.data }
                }),
                { operation: 'update', userId }
              )
            }
          }
        )
        break

      case 'delete':
        result = await withErrorHandling(
          async () => {
            // Simulate delete operation
            await new Promise(resolve => setTimeout(resolve, 100))
            return { success: true, deletedId: '123e4567-e89b-12d3-a456-426614174000' }
          },
          {
            rethrow: true,
            onError: (error) => {
              logError(
                ErrorFactory.database('Delete operation failed', {
                  originalError: error,
                  context: { userId }
                }),
                { operation: 'delete', userId }
              )
            }
          }
        )
        break
    }

    // Log external API call simulation
    logExternalApi('notification_service', 'send_notification', 200, {
      userId,
      action: validatedData.action
    })

    // Log successful operation
    logPerformance(`${validatedData.action}_operation`, Date.now() - startTime, {
      operation: validatedData.action,
      userId,
      status: 'success'
    })

    // Log successful completion
    log('info', 'POST request completed successfully', {
      userId,
      action: validatedData.action,
      duration: Date.now() - startTime
    })

    return NextResponse.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    })
})

/**
 * Error response structure for client-side handling
 */
//

/**
 * Middleware-style error handler for consistent error responses
 */
//
