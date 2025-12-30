'use client'

import React, { Component, ErrorInfo, ReactNode } from 'react'

import { AlertCircle, Home, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { log } from '@/lib/utils/logger'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
  resetOnPropsChange?: boolean
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

/**
 * Comprehensive error boundary component that catches JavaScript errors anywhere in the child component tree
 * and displays a fallback UI instead of the component tree that crashed.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    }
  }

  static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI
    return {
      hasError: true,
      error,
      errorInfo: null
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error details for debugging
    console.error('ErrorBoundary caught an error:', error, errorInfo)
    
    // Log to external logging service
    log('error', 'react_error_boundary', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      url: typeof window !== 'undefined' ? window.location.href : 'unknown'
    })

    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo)
    }

    this.setState({
      error,
      errorInfo
    })
  }

  resetError = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    })
  }

  refreshPage = () => {
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  goHome = () => {
    if (typeof window !== 'undefined') {
      window.location.href = '/'
    }
  }

  componentDidUpdate(prevProps: Props) {
    // Reset error state when props change if resetOnPropsChange is enabled
    if (this.props.resetOnPropsChange && prevProps.children !== this.props.children) {
      this.resetError()
    }
  }

  render() {
    if (this.state.hasError) {
      // Custom fallback UI if provided
      if (this.props.fallback) {
        return this.props.fallback
      }

      // Default error UI
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <Card className="max-w-lg w-full">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 h-12 w-12 text-red-500">
                <AlertCircle className="h-12 w-12" />
              </div>
              <CardTitle className="text-xl text-red-600">
                Something went wrong
              </CardTitle>
              <CardDescription>
                We apologize for the inconvenience. An unexpected error has occurred.
              </CardDescription>
            </CardHeader>
            
            <CardContent>
              <div className="space-y-4">
                <div className="bg-gray-100 rounded-lg p-4">
                  <h4 className="font-semibold text-sm text-gray-700 mb-2">Error Details</h4>
                  <p className="text-sm text-gray-600 break-words">
                    {this.state.error?.message || 'Unknown error'}
                  </p>
                  {process.env.NODE_ENV === 'development' && this.state.errorInfo && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700">
                        Stack trace (development only)
                      </summary>
                      <pre className="mt-2 text-xs text-gray-500 overflow-auto max-h-32">
                        {this.state.errorInfo.componentStack}
                      </pre>
                    </details>
                  )}
                </div>
                
                <div className="text-sm text-gray-600">
                  <p>If this problem persists, please:</p>
                  <ul className="list-disc list-inside mt-2 space-y-1">
                    <li>Try refreshing the page</li>
                    <li>Clear your browser cache</li>
                    <li>Contact support if the issue continues</li>
                  </ul>
                </div>
              </div>
            </CardContent>
            
            <CardFooter className="flex gap-3 justify-center">
              <Button onClick={this.resetError} variant="outline" size="sm">
                <RefreshCw className="h-4 w-4 mr-2" />
                Try Again
              </Button>
              <Button onClick={this.refreshPage} variant="outline" size="sm">
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh Page
              </Button>
              <Button onClick={this.goHome} variant="outline" size="sm">
                <Home className="h-4 w-4 mr-2" />
                Go Home
              </Button>
            </CardFooter>
          </Card>
        </div>
      )
    }

    // Render children normally if no error
    return this.props.children
  }
}

/**
 * Hook-based error boundary for functional components
 * This provides a simpler API for wrapping components with error boundaries
 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  options?: {
    fallback?: ReactNode
    onError?: (error: Error, errorInfo: ErrorInfo) => void
    resetOnPropsChange?: boolean
  }
) {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary
      fallback={options?.fallback}
      onError={options?.onError}
      resetOnPropsChange={options?.resetOnPropsChange}
    >
      <Component {...props} />
    </ErrorBoundary>
  )

  // Set display name for debugging
  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`

  return WrappedComponent
}

/**
 * Error boundary specifically for critical application components
 * Provides enhanced error handling and recovery options
 */
export class CriticalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    }
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Critical error logging - send to external service immediately
    console.error('CriticalErrorBoundary caught an error:', error, errorInfo)
    
    log('error', 'critical_component_error', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      url: typeof window !== 'undefined' ? window.location.href : 'unknown',
      timestamp: new Date().toISOString()
    })

    if (this.props.onError) {
      this.props.onError(error, errorInfo)
    }

    this.setState({
      error,
      errorInfo
    })
  }

  resetError = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-red-50 flex items-center justify-center p-4">
          <Card className="max-w-lg w-full border-red-200">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 h-16 w-16 text-red-600">
                <AlertCircle className="h-16 w-16" />
              </div>
              <CardTitle className="text-2xl text-red-700">
                Critical Error
              </CardTitle>
              <CardDescription className="text-red-600">
                A critical error has occurred that prevents the application from functioning properly.
              </CardDescription>
            </CardHeader>
            
            <CardContent>
              <div className="bg-red-100 rounded-lg p-4 border border-red-200">
                <h4 className="font-semibold text-sm text-red-800 mb-2">Error Details</h4>
                <p className="text-sm text-red-700 break-words">
                  {this.state.error?.message || 'Unknown critical error'}
                </p>
                {process.env.NODE_ENV === 'development' && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm text-red-600 hover:text-red-800">
                      Technical details (development only)
                    </summary>
                    <pre className="mt-2 text-xs text-red-600 overflow-auto max-h-32">
                      {this.state.errorInfo?.componentStack || 'No stack trace available'}
                    </pre>
                  </details>
                )}
              </div>
            </CardContent>
            
            <CardFooter className="flex gap-3 justify-center">
              <Button onClick={this.resetError} variant="destructive" size="sm">
                <RefreshCw className="h-4 w-4 mr-2" />
                Try to Recover
              </Button>
              <Button onClick={() => window.location.href = '/'} variant="outline" size="sm">
                <Home className="h-4 w-4 mr-2" />
                Return to Home
              </Button>
            </CardFooter>
          </Card>
        </div>
      )
    }

    return this.props.children
  }
}
