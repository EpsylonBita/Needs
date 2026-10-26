'use client'

import { useEffect } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useAuth } from '@/contexts/auth-context'
import { supabase } from '@/lib/supabase/client'
import { getNotifications, markNotificationRead, type NotificationCursor, type NotificationPage } from '@/lib/services/notification-service'

export function useNotifications() {
  const { user, isInitialized } = useAuth()
  const userId = user?.id
  const client = useQueryClient()
  const query = useInfiniteQuery({
    queryKey: ['notifications', userId],
    queryFn: ({ signal, pageParam }) => getNotifications(userId!, signal, pageParam),
    initialPageParam: null as NotificationCursor | null,
    getNextPageParam: page => page.nextCursor ?? undefined,
    enabled: isInitialized && !!userId,
    retry: false,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
  const pages = query.data?.pages.filter(page => page.userId === userId) ?? []
  const profileId = pages[0]?.profileId
  const mutation = useMutation({
    mutationFn: ({ userId: expectedUser, id }: { userId: string; id: string }) => markNotificationRead(expectedUser, id),
    onSuccess: (updated, variables) => {
      client.setQueryData<InfiniteData<NotificationPage>>(['notifications', variables.userId], data => data && ({
        ...data, pages: data.pages.map(page => ({ ...page, rows: page.rows.map(row => row.id === updated.id ? updated : row) })),
      }))
      void client.invalidateQueries({ queryKey: ['notifications', variables.userId] })
      void client.invalidateQueries({ queryKey: ['notification-unread', variables.userId] })
      void client.invalidateQueries({ queryKey: ['profile-overview', variables.userId] })
    },
  })
  useEffect(() => {
    if (userId && query.dataUpdatedAt) {
      void client.invalidateQueries({ queryKey: ['profile-overview', userId] })
      void client.invalidateQueries({ queryKey: ['notification-unread', userId] })
    }
  }, [client, userId, query.dataUpdatedAt])

  useEffect(() => {
    if (!userId || !profileId) return
    let active = true
    const channel = supabase.channel(`notifications-${userId}`).on('postgres_changes', {
      event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${profileId}`,
    }, () => {
      if (!active) return
      void client.invalidateQueries({ queryKey: ['notifications', userId] })
      void client.invalidateQueries({ queryKey: ['notification-unread', userId] })
      void client.invalidateQueries({ queryKey: ['profile-overview', userId] })
    }).subscribe()
    // Polling/focus/manual refresh still work if publication or the connection is unavailable.
    return () => { active = false; void supabase.removeChannel(channel) }
  }, [client, userId, profileId])

  const matchingMutation = mutation.variables?.userId === userId
  return {
    ...query,
    rows: [...new Map(pages.flatMap(page => page.rows).map(row => [row.id, row])).values()],
    hasData: pages.length > 0,
    signedIn: !!userId, authReady: isInitialized,
    updatingId: matchingMutation && mutation.isPending ? mutation.variables?.id : undefined,
    updateError: matchingMutation && mutation.isError,
    markRead: (id: string) => { if (userId && !(matchingMutation && mutation.isPending)) mutation.mutate({ userId, id }) },
  }
}
