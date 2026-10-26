'use client'

import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/auth-context'
import { supabase } from '@/lib/supabase/client'
import { getUnreadNotificationCount } from '@/lib/services/notification-service'

export function useUnreadNotifications() {
  const { user, isInitialized } = useAuth()
  const userId = user?.id
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['notification-unread', userId],
    queryFn: ({ signal }) => getUnreadNotificationCount(userId!, signal),
    enabled: isInitialized && !!userId,
    retry: false, staleTime: 15_000, refetchInterval: 30_000, refetchOnWindowFocus: true,
  })
  const data = userId && query.data?.userId === userId ? query.data : undefined
  const profileId = data?.profileId
  const count = data?.count
  useEffect(() => {
    if (userId && count !== undefined) void client.invalidateQueries({ queryKey: ['profile-overview', userId] })
  }, [client, userId, count])
  useEffect(() => {
    if (!userId || !profileId) return
    let active = true
    const channel = supabase.channel(`notification-unread-${userId}`).on('postgres_changes', {
      event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${profileId}`,
    }, () => {
      if (!active) return
      void client.invalidateQueries({ queryKey: ['notification-unread', userId] })
      void client.invalidateQueries({ queryKey: ['notifications', userId] })
      void client.invalidateQueries({ queryKey: ['profile-overview', userId] })
    }).subscribe()
    return () => { active = false; void supabase.removeChannel(channel) }
  }, [client, userId, profileId])
  return { ...query, data }
}
