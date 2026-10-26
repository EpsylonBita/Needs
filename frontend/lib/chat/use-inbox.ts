'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/auth-context'
import { supabase } from '@/lib/supabase/client'
import {
  getInbox, getMessagePage, getOrCreateListingChat, leaveChat, markChatRead, rejoinChat, sendMessage,
  type ChatItem, type InboxData,
} from '@/lib/services/chat-service'

type Scope = { userId: string; chatId: string }
type InboxOptions = { requestedChatId?: string | null; requestedListingId?: string | null }
const noChats: ChatItem[] = []

export function useInbox({ requestedChatId = null, requestedListingId = null }: InboxOptions = {}) {
  const { user, isInitialized } = useAuth()
  const userId = user?.id
  const client = useQueryClient()
  const enabled = isInitialized && !!userId
  const requestKey = JSON.stringify([requestedChatId, requestedListingId])
  const [selection, setSelection] = useState<{ userId?: string; requestKey: string; id: string | null } | null>(null)
  const nonceByScope = useRef(new Map<string, { content: string; nonce: string }>())
  const pendingSends = useRef(new Map<string, { content: string; promise: Promise<void> }>())

  const invalidate = useCallback(async (accountId: string, chatId?: string) => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['inbox', accountId] }),
      ...(chatId ? [client.invalidateQueries({ queryKey: ['chat-messages', accountId, chatId] })] : []),
      client.invalidateQueries({ queryKey: ['notifications', accountId] }),
      client.invalidateQueries({ queryKey: ['notification-unread', accountId] }),
      client.invalidateQueries({ queryKey: ['profile-overview', accountId] }),
    ])
  }, [client])

  const opening = useQuery({
    queryKey: ['listing-chat', userId, requestedListingId],
    queryFn: async ({ signal }) => ({ userId, chatId: await getOrCreateListingChat(requestedListingId!, userId!, signal) }),
    enabled: enabled && !requestedChatId && !!requestedListingId,
    staleTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
  })
  const openingListing = !requestedChatId && !!requestedListingId
  const requestedId = requestedChatId ?? (openingListing && opening.data && opening.data.userId === userId ? opening.data.chatId : null)
  const activeChatId = selection?.userId === userId && selection?.requestKey === requestKey ? selection.id : requestedId
  const inbox = useQuery({
    queryKey: ['inbox', userId],
    queryFn: ({ signal }) => getInbox(userId!, signal),
    enabled, staleTime: 10_000, retry: false,
    refetchInterval: 30_000, refetchOnWindowFocus: true,
  })
  const data = inbox.data?.userId === userId ? inbox.data : undefined
  const chats = data?.chats ?? noChats
  const profileId = data?.profileId
  const activeChat = chats.find(chat => chat.chat_id === activeChatId) ?? null
  const history = useInfiniteQuery({
    queryKey: ['chat-messages', userId, activeChatId],
    queryFn: ({ signal, pageParam }) => getMessagePage(userId!, activeChatId!, signal, pageParam),
    initialPageParam: null as number | null,
    getNextPageParam: page => page.nextCursor ?? undefined,
    enabled: enabled && !!activeChat, retry: false, staleTime: 10_000,
    refetchInterval: 30_000, refetchOnWindowFocus: true,
  })
  const messages = useMemo(() => {
    const rows = history.data?.pages.filter(page => page.userId === userId && page.chatId === activeChatId).flatMap(page => page.rows) ?? []
    return [...new Map(rows.map(row => [row.id, row])).values()].sort((a, b) => a.sequence - b.sequence)
  }, [history.data, userId, activeChatId])

  useEffect(() => {
    if (openingListing && opening.data?.userId === userId && userId) void invalidate(userId)
  }, [invalidate, openingListing, opening.data, opening.dataUpdatedAt, userId])

  useEffect(() => {
    if (!userId || !profileId) return
    let active = true
    const refresh = () => { if (active) void invalidate(userId, activeChatId ?? undefined) }
    const channel = supabase.channel(`inbox-${userId}-${activeChatId ?? 'list'}`)
      // RLS limits message delivery to conversations this profile may read.
      // Events only invalidate authorized queries; their payloads never enter the UI.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_participants', filter: `user_id=eq.${profileId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${profileId}` }, refresh)
    if (activeChatId) channel.on('postgres_changes', { event: '*', schema: 'public', table: 'chat_participants', filter: `chat_id=eq.${activeChatId}` }, refresh)
    channel.subscribe()
    return () => { active = false; void supabase.removeChannel(channel) }
  }, [userId, profileId, activeChatId, invalidate])

  const sendingMutation = useMutation({
    mutationFn: ({ userId: accountId, chatId, content, nonce }: Scope & { content: string; nonce: string }) => sendMessage(chatId, content, accountId, nonce),
    onSuccess: (_message, variables) => invalidate(variables.userId, variables.chatId),
    retry: false,
  })
  const membership = useMutation({
    mutationFn: ({ userId: accountId, chatId, action }: Scope & { action: 'leave' | 'rejoin' }) => action === 'leave' ? leaveChat(accountId, chatId) : rejoinChat(accountId, chatId),
    onSuccess: (result, variables) => {
      client.setQueryData<InboxData>(['inbox', variables.userId], previous => previous && ({
        ...previous, chats: previous.chats.map(chat => chat.chat_id === variables.chatId ? { ...chat, left_at: result.left_at, can_send: !result.left_at && !chat.other_left } : chat),
      }))
      return invalidate(variables.userId, variables.chatId)
    },
    retry: false,
  })
  const read = useMutation({
    mutationFn: ({ userId: accountId, chatId, messageId }: Scope & { messageId: string }) => markChatRead(accountId, chatId, messageId),
    onSuccess: (result, variables) => {
      client.setQueryData<InboxData>(['inbox', variables.userId], previous => previous && ({
        ...previous, chats: previous.chats.map(chat => chat.chat_id === variables.chatId ? { ...chat, last_read_at: result.last_read_at, unread_count: result.unread_count } : chat),
      }))
      return invalidate(variables.userId)
    },
    retry: false,
  })
  const sendAsync = sendingMutation.mutateAsync
  const membershipAsync = membership.mutateAsync
  const readAsync = read.mutateAsync
  const send = useCallback((content: string): Promise<void> => {
    if (!userId || !activeChatId || !activeChat?.can_send) return Promise.reject(new Error('This conversation is not available for sending'))
    const key = JSON.stringify([userId, activeChatId])
    const text = content.trim()
    const pending = pendingSends.current.get(key)
    if (pending) return pending.content === text ? pending.promise : Promise.reject(new Error('Wait for the current message to finish sending'))
    const previous = nonceByScope.current.get(key)
    const attempt = previous?.content === text ? previous : { content: text, nonce: crypto.randomUUID() }
    nonceByScope.current.set(key, attempt)
    const promise = sendAsync({ userId, chatId: activeChatId, content: text, nonce: attempt.nonce }).then(() => {
      if (nonceByScope.current.get(key) === attempt) nonceByScope.current.delete(key)
    }).finally(() => { pendingSends.current.delete(key) })
    pendingSends.current.set(key, { content: text, promise })
    return promise
  }, [userId, activeChatId, activeChat?.can_send, sendAsync])
  const updateMembership = useCallback(async (action: 'leave' | 'rejoin') => {
    if (!userId || !activeChatId) throw new Error('Choose a conversation first')
    await membershipAsync({ userId, chatId: activeChatId, action })
  }, [userId, activeChatId, membershipAsync])
  const markRead = useCallback(async (messageId: string) => {
    if (!userId || !activeChatId || !messages.some(message => message.id === messageId)) throw new Error('Only a loaded message may be marked as read')
    await readAsync({ userId, chatId: activeChatId, messageId })
  }, [userId, activeChatId, messages, readAsync])
  const matches = (scope: Scope | undefined) => scope?.userId === userId && scope?.chatId === activeChatId

  const openedListing = opening.data
  const openingFailed = opening.isError
  const retryOpening = opening.refetch
  const refresh = useCallback(async () => {
    if (!userId) return
    if (openingListing && (!openedListing || openingFailed)) await retryOpening()
    await invalidate(userId, activeChatId ?? undefined)
  }, [userId, openingListing, openedListing, openingFailed, retryOpening, invalidate, activeChatId])

  return {
    chats, activeChat, activeChatId, profileId, messages,
    signedIn: !!userId, authReady: isInitialized, initialized: isInitialized,
    loading: enabled && (inbox.isPending || (openingListing && (opening.isPending || (!!requestedId && !activeChat && inbox.isFetching)))),
    chatsError: inbox.error,
    openingError: openingListing ? opening.error : null,
    messagesError: activeChat ? history.error : null,
    messagesLoading: !!activeChat && history.isPending,
    hasOlder: !!activeChat && history.hasNextPage,
    loadOlder: async () => {
      if (!activeChat || !history.hasNextPage || history.isFetching) throw new Error('Older messages are not available yet')
      await history.fetchNextPage({ throwOnError: true })
    },
    isFetchingOlder: !!activeChat && history.isFetchingNextPage,
    selectChat: (id: string | null) => setSelection({ userId, requestKey, id }),
    refresh, isRefreshing: inbox.isFetching || history.isFetching || (openingListing && opening.isFetching),
    send, sending: matches(sendingMutation.variables) && sendingMutation.isPending,
    leave: () => updateMembership('leave'), rejoin: () => updateMembership('rejoin'),
    leaving: matches(membership.variables) && membership.isPending && membership.variables?.action === 'leave',
    rejoining: matches(membership.variables) && membership.isPending && membership.variables?.action === 'rejoin',
    markRead, markReadError: matches(read.variables) ? read.error : null,
    markingRead: matches(read.variables) && read.isPending,
  }
}
