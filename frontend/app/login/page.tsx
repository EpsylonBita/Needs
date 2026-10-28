'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AuthDialog } from '@/components/auth/auth-dialog'
import { useAuth } from '@/contexts/auth-context'
import { clearAuthContinuation, readAuthContinuation, safeInternalPath, saveAuthContinuation } from '@/lib/auth/return-path'

export default function LoginPage() {
  const { user, isInitialized } = useAuth()
  const router = useRouter()
  const params = useSearchParams()
  const [continuation] = useState(() => readAuthContinuation(user?.id))
  const requested = params.get('redirectTo') || continuation || '/dashboard'
  const destination = safeInternalPath(requested, '/dashboard')
  useEffect(() => { saveAuthContinuation(destination, user?.id) }, [destination, user?.id])
  useEffect(() => {
    if (isInitialized && user) { clearAuthContinuation(); router.replace(destination) }
  }, [destination, isInitialized, router, user])
  return <AuthDialog isOpen={!user} purpose={params.get('context') === 'conversation' ? 'conversation' : undefined} listingTitle={params.get('listingTitle') ?? undefined} onAwaitingConfirmation={() => router.replace('/')} onClose={() => { clearAuthContinuation(); router.replace('/') }} onAuthenticated={() => { clearAuthContinuation(); router.replace(destination) }} />
}
