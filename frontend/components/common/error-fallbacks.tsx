import React from 'react'

import { AlertTriangle, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

interface ErrorFallbackProps {
  error: Error
  resetError: () => void
  title?: string
  description?: string
  showDetails?: boolean
}

/**
 * Reusable error fallback component for error boundaries
 * Provides a consistent error UI across the application
 */
export function ErrorFallback({ 
  error, 
  resetError, 
  title = 'Something went wrong',
  description = 'We apologize for the inconvenience. Please try again.',
  showDetails = process.env.NODE_ENV === 'development' 
}: ErrorFallbackProps) {
  return (
    <div className="flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 text-red-500">
            <AlertTriangle className="h-12 w-12" />
          </div>
          <CardTitle className="text-xl text-red-600">
            {title}
          </CardTitle>
          <CardDescription>
            {description}
          </CardDescription>
        </CardHeader>
        
        {showDetails && (
          <CardContent>
            <div className="bg-gray-100 rounded-lg p-3">
              <h4 className="font-semibold text-sm text-gray-700 mb-2">Error Details</h4>
              <p className="text-sm text-gray-600 break-words">
                {error.message}
              </p>
            </div>
          </CardContent>
        )}
        
        <CardFooter className="flex justify-center">
          <Button onClick={resetError} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Try Again
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}

interface LoadingFallbackProps {
  title?: string
  description?: string
}

/**
 * Reusable loading fallback component
 */
export function LoadingFallback({ 
  title = 'Loading...',
  description = 'Please wait while we load the content.'
}: LoadingFallbackProps) {
  return (
    <div className="flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 text-blue-500">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
          </div>
          <CardTitle className="text-xl text-blue-600">
            {title}
          </CardTitle>
          <CardDescription>
            {description}
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}

interface EmptyFallbackProps {
  title?: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
}

/**
 * Reusable empty state fallback component
 */
export function EmptyFallback({ 
  title = 'No data found',
  description = 'There is no data to display at the moment.',
  action
}: EmptyFallbackProps) {
  return (
    <div className="flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 text-gray-400">
            <AlertTriangle className="h-12 w-12" />
          </div>
          <CardTitle className="text-xl text-gray-600">
            {title}
          </CardTitle>
          <CardDescription>
            {description}
          </CardDescription>
        </CardHeader>
        
        {action && (
          <CardFooter className="flex justify-center">
            <Button onClick={action.onClick} variant="outline" size="sm">
              {action.label}
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>
  )
}
