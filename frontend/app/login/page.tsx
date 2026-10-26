'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AuthDialog } from '@/components/auth/auth-dialog'
import { useAuth } from '@/contexts/auth-context'

export default function LoginPage() {
  const { user, isInitialized } = useAuth()
  const router = useRouter()
  const params = useSearchParams()
  const requested = params.get('redirectTo') || '/dashboard'
  const destination = requested.startsWith('/') && !requested.startsWith('//') && !requested.includes('\\') ? requested : '/dashboard'
  useEffect(() => {
    if (isInitialized && user) router.replace(destination)
  }, [destination, isInitialized, router, user])
  return <AuthDialog isOpen={!user} onClose={() => router.replace('/')} onAuthenticated={() => router.replace(destination)} />
}
