'use client'

import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, ArrowDown, ExternalLink, Loader2, MessageCircle, RefreshCw, Send } from 'lucide-react'
import { ErrorBoundary } from '@/components/common/error-boundary'
import { ErrorFallback } from '@/components/common/error-fallbacks'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAuth } from '@/contexts/auth-context'
import { useI18n } from '@/contexts/i18n-context'
import { useInbox } from '@/lib/chat/use-inbox'
import { MESSAGE_MAX_LENGTH, sendMessage, type ChatItem } from '@/lib/services/chat-service'
import { ChatTransactionPanel } from '@/components/features/chat/chat-transaction-panel'
import { inboxCopy } from '@/components/features/chat/inbox-copy'
import styles from '@/components/features/chat/inbox.module.css'

function InboxSession({ userId }: { userId: string }) {
  const params = useSearchParams()
  const router = useRouter()
  const { locale } = useI18n()
  const copy = inboxCopy[locale === 'el' ? 'el' : 'en']
  const inbox = useInbox({ requestedChatId: params.get('chat'), requestedListingId: params.get('listing') })
  const [folderSelection, setFolderSelection] = useState<{ scope: string; value: 'active' | 'left' } | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [actionError, setActionError] = useState<{ chatId: string; message: string } | null>(null)
  const [leaveChatId, setLeaveChatId] = useState<string | null>(null)
  const [nearBottom, setNearBottom] = useState(true)
  const [visible, setVisible] = useState(true)
  const scroller = useRef<HTMLDivElement>(null)
  const prependAnchor = useRef<{ height: number; firstId?: string; chatId: string } | null>(null)
  const renderedChat = useRef<string | null>(null)
  const readAttempt = useRef('')
  const currentChat = useRef(inbox.activeChatId)
  const active = inbox.activeChat
  const activeId = active?.chat_id
  const leftAt = active?.left_at
  const folderScope = `${activeId || ''}:${leftAt || ''}`
  const folder = folderSelection?.scope === folderScope ? folderSelection.value : leftAt ? 'left' : 'active'
  const setFolder = (value: 'active' | 'left') => setFolderSelection({ scope: folderScope, value })
  const confirmLeave = !!activeId && !leftAt && leaveChatId === activeId
  const setConfirmLeave = (open: boolean) => setLeaveChatId(open ? activeId || null : null)
  const draft = active ? drafts[active.chat_id] || '' : ''
  const lastMessage = inbox.messages.at(-1)
  const lastMessageId = lastMessage?.id
  const lastMessageChatId = lastMessage?.chat_id
  const firstMessageId = inbox.messages[0]?.id

  const name = (chat: ChatItem) => chat.participants.map(member => member.display_name?.trim() || copy.member).join(', ') || copy.member
  const initials = (value: string) => value.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('')
  function date(value: string, short = false) {
    const instant = new Date(value)
    if (Number.isNaN(instant.getTime())) return ''
    return new Intl.DateTimeFormat(locale === 'el' ? 'el-GR' : 'en-GB', short
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(instant)
  }

  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible')
    update()
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  useLayoutEffect(() => { currentChat.current = inbox.activeChatId }, [inbox.activeChatId])
  useEffect(() => { readAttempt.current = '' }, [activeId, leftAt])

  useLayoutEffect(() => {
    const element = scroller.current
    if (!element || !activeId) return
    if (renderedChat.current !== activeId) {
      renderedChat.current = activeId
      prependAnchor.current = null
      element.scrollTop = element.scrollHeight
      setNearBottom(true)
    } else if (prependAnchor.current) {
      if (prependAnchor.current.chatId === activeId && prependAnchor.current.firstId !== firstMessageId) {
        element.scrollTop += element.scrollHeight - prependAnchor.current.height
        prependAnchor.current = null
      }
    } else if (nearBottom) element.scrollTop = element.scrollHeight
  }, [activeId, firstMessageId, inbox.messages.length, lastMessageId, inbox.messagesLoading, nearBottom])

  const markRead = inbox.markRead
  useEffect(() => {
    if (!activeId || leftAt || !lastMessageId || lastMessageChatId !== activeId || inbox.messagesLoading || !visible || document.visibilityState !== 'visible' || !nearBottom) return
    const key = `${activeId}:${lastMessageId}`
    if (readAttempt.current === key) return
    readAttempt.current = key
    void markRead(lastMessageId).catch(() => { /* The hook exposes an explicit retry state. */ })
  }, [activeId, leftAt, lastMessageId, lastMessageChatId, inbox.messagesLoading, visible, nearBottom, markRead])

  function selectChat(id: string | null) {
    setLeaveChatId(null)
    setActionError(null)
    inbox.selectChat(id)
    router.replace(id ? `/chat?chat=${encodeURIComponent(id)}` : '/chat', { scroll: false })
  }

  async function submit() {
    if (!active || !draft.trim() || inbox.sending || !active.can_send) return
    const id = active.chat_id
    const sentDraft = draft
    setActionError(null)
    try {
      await inbox.send(sentDraft)
      setDrafts(previous => previous[id] === sentDraft ? { ...previous, [id]: '' } : previous)
      if (currentChat.current === id) setNearBottom(true)
    } catch { if (currentChat.current === id) setActionError({ chatId: id, message: copy.sendError }) }
  }

  async function membership(action: 'leave' | 'rejoin') {
    if (!active) return
    const id = active.chat_id
    setActionError(null)
    try {
      if (action === 'leave') await inbox.leave()
      else await inbox.rejoin()
      if (currentChat.current !== id) return
      setConfirmLeave(false)
      setFolder(action === 'leave' ? 'left' : 'active')
    } catch { if (currentChat.current === id) setActionError({ chatId: id, message: copy.actionError }) }
  }

  const refreshInbox = inbox.refresh
  const sendTransactionMessage = useCallback(async (chatId: string, content: string) => {
    await sendMessage(chatId, content, userId)
    await refreshInbox()
  }, [userId, refreshInbox])

  const entries = inbox.chats.filter(chat => folder === 'left' ? !!chat.left_at : !chat.left_at)
  const participant = active?.participants[0]
  const selectedError = inbox.openingError || (inbox.activeChatId && !active && !inbox.loading ? new Error(copy.unavailable) : null)

  return <div className={styles.page}>
    <header className={styles.heading}>
      <div><h1>{copy.title}</h1><p>{copy.subtitle}</p></div>
      <Button variant="outline" aria-label={copy.refresh} disabled={inbox.isRefreshing} onClick={() => { void inbox.refresh().catch(() => {}) }}>
        <RefreshCw size={16} className={inbox.isRefreshing ? 'animate-spin' : ''} aria-hidden="true" /><span>{copy.refresh}</span>
      </Button>
    </header>
    <div className={styles.workspace} data-conversation={!!inbox.activeChatId || !!inbox.openingError}>
      <aside className={styles.sidebar} aria-label={copy.title}>
        <div className={styles.filters}>
          <button type="button" aria-pressed={folder === 'active'} onClick={() => setFolder('active')}>{copy.active}</button>
          <button type="button" aria-pressed={folder === 'left'} onClick={() => setFolder('left')}>{copy.left}</button>
        </div>
        {inbox.loading && <p role="status" className={styles.status}>{copy.loading}</p>}
        {inbox.chatsError && <div role="alert" className={styles.error}><p>{copy.loadError}</p><Button variant="outline" size="sm" onClick={() => { void inbox.refresh().catch(() => {}) }}>{copy.retry}</Button></div>}
        {!inbox.loading && !inbox.chatsError && entries.length === 0 && <div className={styles.empty}>
          <MessageCircle aria-hidden="true" /><h3>{folder === 'left' ? copy.noLeft : copy.empty}</h3><p>{folder === 'left' ? copy.noLeftHint : copy.emptyHint}</p>
          {folder === 'active' && <Button asChild variant="outline"><Link href="/search">{copy.browse}</Link></Button>}
        </div>}
        <ul className={styles.list}>{entries.map(chat => {
          const title = name(chat)
          const message = chat.last_message
          return <li key={chat.chat_id}><button type="button" className={styles.chat} aria-current={active?.chat_id === chat.chat_id} onClick={() => selectChat(chat.chat_id)}>
            <Avatar className={styles.avatar}><AvatarImage src={chat.participants[0]?.avatar_url || undefined} alt="" /><AvatarFallback>{initials(title)}</AvatarFallback></Avatar>
            <div className={styles.chatText}><div className={styles.chatTop}><strong>{title}</strong>{message && <time dateTime={message.created_at}>{date(message.created_at, true)}</time>}</div>
              {chat.chats.title && <span className={styles.listing}>{chat.chats.title}</span>}
              <div className={styles.preview}><p>{message ? `${message.sender_id === inbox.profileId ? `${copy.you}: ` : ''}${message.content || copy.attachment}` : copy.noPreview}</p>
                {chat.unread_count > 0 && <span className={styles.count} aria-label={`${chat.unread_count} ${copy.unread}`}>{chat.unread_count > 99 ? '99+' : chat.unread_count}</span>}
              </div>
            </div>
          </button></li>
        })}</ul>
      </aside>
      <section className={styles.thread} aria-label={active ? name(active) : copy.choose}>
        {!active ? <>
          {(!!inbox.activeChatId || !!inbox.openingError) && <div className={styles.threadHeader}><Button variant="ghost" size="icon" onClick={() => selectChat(null)} aria-label={copy.back}><ArrowLeft size={18} /></Button></div>}
          <div className={styles.empty}><MessageCircle aria-hidden="true" />
            {selectedError ? <><h2>{copy.unavailable}</h2><Button variant="outline" onClick={() => { void inbox.refresh().catch(() => {}) }}>{copy.retry}</Button></>
              : inbox.loading ? <p role="status">{copy.loading}</p> : <><h2>{copy.choose}</h2><p>{copy.chooseHint}</p></>}
          </div>
        </> : <>
          <header className={styles.threadHeader}>
            <Button className={styles.mobileBack} variant="ghost" size="icon" onClick={() => selectChat(null)} aria-label={copy.back}><ArrowLeft size={18} /></Button>
            <Avatar className={styles.avatar}><AvatarImage src={participant?.avatar_url || undefined} alt="" /><AvatarFallback>{initials(name(active))}</AvatarFallback></Avatar>
            <div className={styles.threadIdentity}><h2>{name(active)}</h2>{active.chats.title && <p>{active.chats.title}</p>}</div>
            <div className={styles.threadActions}>
              {participant && <Button asChild variant="ghost" size="icon"><Link href={`/profile/${encodeURIComponent(participant.profile_id)}`} aria-label={copy.profile}><ExternalLink size={16} /></Link></Button>}
              {!active.left_at && <Button variant="ghost" size="sm" disabled={inbox.leaving} onClick={() => setConfirmLeave(true)}>{copy.leave}</Button>}
            </div>
          </header>
          {active.chats.listing_id && inbox.profileId && <details className={styles.transaction}>
            <summary>{copy.details}</summary>
            <ChatTransactionPanel chatId={active.chat_id} listingId={active.chats.listing_id} profileId={inbox.profileId} userId={userId} onSendMessage={sendTransactionMessage} />
          </details>}
          {inbox.messagesError && <div role="alert" className={styles.error}><p>{copy.messageError}</p><Button variant="outline" size="sm" onClick={() => { void inbox.refresh().catch(() => {}) }}>{copy.retry}</Button></div>}
          {actionError?.chatId === active.chat_id && !confirmLeave && <p role="alert" className={styles.error}>{actionError.message}</p>}
          {inbox.markReadError && <div role="alert" className={styles.error}><p>{copy.readError}</p><Button variant="ghost" size="sm" onClick={() => { if (lastMessage) void inbox.markRead(lastMessage.id).catch(() => {}) }}>{copy.retryRead}</Button></div>}
          <div className={styles.messages} ref={scroller} onScroll={event => { const el = event.currentTarget; setNearBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60) }} aria-busy={inbox.messagesLoading}>
            {inbox.hasOlder && <div className={styles.older}><Button variant="ghost" size="sm" disabled={inbox.isFetchingOlder} onClick={() => {
              prependAnchor.current = scroller.current ? { height: scroller.current.scrollHeight, firstId: firstMessageId, chatId: active.chat_id } : null
              setNearBottom(false)
              void inbox.loadOlder().catch(() => { prependAnchor.current = null })
            }}>{inbox.isFetchingOlder ? <Loader2 className="animate-spin" size={16} /> : null}{copy.older}</Button></div>}
            {inbox.messagesLoading ? <p role="status" className={styles.status}>{copy.messagesLoading}</p>
              : !inbox.messagesError && inbox.messages.length === 0 ? <div className={styles.empty}><MessageCircle aria-hidden="true" /><h3>{copy.noMessages}</h3><p>{copy.noMessagesHint}</p></div> : null}
            <ol className={styles.messageList}>{inbox.messages.map(message => {
              const own = message.sender_id === inbox.profileId
              const author = own ? copy.you : active.participants.find(member => member.profile_id === message.sender_id)?.display_name || copy.member
              return <li key={message.id} className={styles.message} data-own={own}>
                <p className={styles.messageAuthor}>{author}</p><p className={styles.bubble}>{message.content || copy.attachment}</p>
                <time dateTime={message.created_at}>{date(message.created_at)}</time>
              </li>
            })}</ol>
          </div>
          {!nearBottom && inbox.messages.length > 0 && <Button className={styles.latest} variant="outline" size="sm" onClick={() => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; setNearBottom(true) }}><ArrowDown size={15} />{copy.newMessages}</Button>}
          {active.left_at ? <div className={styles.notice}><p>{copy.leftNotice}</p><Button variant="outline" disabled={inbox.rejoining} onClick={() => { void membership('rejoin') }}>{inbox.rejoining ? copy.rejoining : copy.rejoin}</Button></div>
            : !active.can_send ? <p className={styles.notice}>{active.other_left ? copy.otherLeft : copy.blocked}</p>
            : <form className={styles.composer} onSubmit={event => { event.preventDefault(); void submit() }}>
              <div className={styles.composerRow}><label htmlFor="chat-draft" className="sr-only">{copy.draft}</label>
                <textarea id="chat-draft" rows={2} maxLength={MESSAGE_MAX_LENGTH} placeholder={copy.placeholder} value={draft} disabled={inbox.sending}
                  onChange={event => setDrafts(previous => ({ ...previous, [active.chat_id]: event.target.value }))}
                  onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit() } }} />
                <Button type="submit" disabled={inbox.sending || !draft.trim()} aria-label={inbox.sending ? copy.sending : copy.send}>
                  {inbox.sending ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : <Send size={17} aria-hidden="true" />}<span>{inbox.sending ? copy.sending : copy.send}</span>
                </Button>
              </div><small>{copy.sendHint}{draft.length > MESSAGE_MAX_LENGTH - 500 ? ` · ${draft.length}/${MESSAGE_MAX_LENGTH}` : ''}</small>
            </form>}
        </>}
      </section>
    </div>
    <Dialog open={confirmLeave} onOpenChange={open => { if (!inbox.leaving) setConfirmLeave(open) }}>
      <DialogContent closeLabel={copy.cancel} closeDisabled={inbox.leaving} className="w-[calc(100%-2rem)] max-w-md rounded-2xl p-6 sm:rounded-2xl">
        <DialogHeader className="pr-8 text-left"><DialogTitle>{copy.leaveTitle}</DialogTitle><DialogDescription className="pt-2 leading-6">{copy.leaveHint}</DialogDescription></DialogHeader>
        {actionError?.chatId === active?.chat_id && <p role="alert" className="text-sm text-destructive">{actionError?.message}</p>}
        <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={inbox.leaving} onClick={() => setConfirmLeave(false)}>{copy.cancel}</Button>
          <Button disabled={inbox.leaving} onClick={() => { void membership('leave') }}>{inbox.leaving ? copy.leaving : copy.leave}</Button></div>
      </DialogContent>
    </Dialog>
  </div>
}

function ChatPageContent() {
  const { user, isInitialized } = useAuth()
  const { locale } = useI18n()
  const params = useSearchParams()
  const router = useRouter()
  const query = params.toString()
  useEffect(() => {
    if (isInitialized && !user) router.replace(`/login?redirectTo=${encodeURIComponent(`/chat${query ? `?${query}` : ''}`)}`)
  }, [isInitialized, user, query, router])
  if (!isInitialized || !user) return <p role="status" className={styles.status}>{inboxCopy[locale === 'el' ? 'el' : 'en'].loading}</p>
  return <InboxSession key={user.id} userId={user.id} />
}

export default function ChatPage() {
  return <ErrorBoundary fallback={<div className="flex min-h-screen items-center justify-center"><ErrorFallback error={new Error('Chat system error')} resetError={() => window.location.reload()} title="Chat Error" description="Please refresh to load your conversations." /></div>}>
    <Suspense fallback={<div role="status" className={styles.status}><Loader2 className="mx-auto animate-spin" aria-label="Loading" /></div>}><ChatPageContent /></Suspense>
  </ErrorBoundary>
}
