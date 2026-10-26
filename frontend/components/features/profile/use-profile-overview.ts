'use client'

import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/contexts/auth-context'
import { getProfileOverview } from '@/lib/services/profile-overview-service'

export function useProfileOverview() {
  const { user, isInitialized } = useAuth()
  const userId = user?.id
  const query = useQuery({
    queryKey: ['profile-overview', userId],
    queryFn: ({ signal }) => getProfileOverview(userId!, signal),
    enabled: isInitialized && !!userId,
    retry: false,
    staleTime: 30_000,
  })
  return { ...query, data: userId && query.data?.userId === userId ? query.data : undefined, signedIn: !!userId, authReady: isInitialized }
}
