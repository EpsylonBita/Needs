"use client";

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { listChats, listMessages, sendMessage } from '@/lib/services/chat-service'
import { withCsrfHeaders } from '@/lib/utils/csrf'
import { supabase } from '@/lib/supabase/client'
import { ErrorBoundary } from '@/components/common/error-boundary'
import { ErrorFallback } from '@/components/common/error-fallbacks'

type ChatItem = { chat_id: string; chats: { id: string; title: string | null; type: string } }

function ChatPageContent() {
  const [chats, setChats] = useState<ChatItem[]>([])
  const [activeChat, setActiveChat] = useState<string | null>(null)
  const [messages, setMessages] = useState<any[]>([])
  const [text, setText] = useState('')
  const params = useSearchParams()
  const listingId = params.get('listing')
  const [sellerId, setSellerId] = useState<string | null>(null)
  const [sellerOnboarded, setSellerOnboarded] = useState<boolean | null>(null)
  const [showMilestoneForm, setShowMilestoneForm] = useState(false)
  const [msTitle, setMsTitle] = useState('')
  const [msAmount, setMsAmount] = useState('')
  const [paymentsEnabled, setPaymentsEnabled] = useState<boolean | null>(null)
  const [milestonesEnabled, setMilestonesEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    const run = async () => {
      const c = await listChats()
      setChats(c as any)
      if (c.length > 0) {
        setActiveChat(c[0].chat_id)
      }
    }
    run()
  }, [])

  useEffect(() => {
    const loadListing = async () => {
      if (!listingId) return
      const { data: listing } = await supabase.from('listings').select('id, seller_id, title').eq('id', listingId).single()
      if (!listing?.seller_id) return
      setSellerId(listing.seller_id)
      const { data: profile } = await supabase.from('profiles').select('stripe_account_id').eq('id', listing.seller_id).limit(1).single()
      setSellerOnboarded(!!profile?.stripe_account_id)
      const { data: flag } = await supabase.from('feature_flags').select('enabled').eq('key','payments_enabled').single()
      const paymentsEnabledEnv = (process.env.NEXT_PUBLIC_PAYMENTS_ENABLED || '').toLowerCase() === 'true'
      setPaymentsEnabled((flag?.enabled ?? paymentsEnabledEnv) as boolean)
      const { data: msflag } = await supabase.from('feature_flags').select('enabled').eq('key','milestones_enabled').single()
      const milestonesEnabledEnv = (process.env.NEXT_PUBLIC_MILESTONES_ENABLED || '').toLowerCase() === 'true'
      setMilestonesEnabled((msflag?.enabled ?? milestonesEnabledEnv) as boolean)
    }
    loadListing()
  }, [listingId])

  useEffect(() => {
    const load = async () => {
      if (!activeChat) return
      const msgs = await listMessages(activeChat)
      setMessages(msgs as any)
    }
    load()
    if (!activeChat) return
    const channel = supabase.channel(`messages-${activeChat}`).on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `chat_id=eq.${activeChat}` }, (payload: any) => {
      setMessages((prev) => {
        const exists = prev.some((m: any) => m.id === (payload.new as any)?.id)
        if (exists) return prev
        return [...prev, payload.new as any]
      })
    }).subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [activeChat])

  const send = async () => {
    if (!activeChat || !text.trim()) return
    await sendMessage(activeChat, text.trim())
    setText('')
    const msgs = await listMessages(activeChat)
    setMessages(msgs as any)
  }

  return (
    <div className="container mx-auto p-4 pt-[72px] grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="border rounded-md p-2">
        <h2 className="font-semibold">Chats</h2>
        <ul className="mt-2 space-y-1">
          {chats.map((c) => (
            <li key={c.chat_id}>
              <button onClick={() => setActiveChat(c.chat_id)} className={`w-full text-left px-2 py-1 rounded ${activeChat===c.chat_id?'bg-blue-100':''}`}>
                {c.chats.title || c.chats.id}
              </button>
            </li>
          ))}
          {chats.length === 0 && <li className="text-sm text-muted-foreground">No chats</li>}
        </ul>
      </div>
      <div className="md:col-span-2 border rounded-md p-2 flex flex-col">
        {listingId && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Link
              href={`/payments/checkout/${listingId}`}
              className={`px-3 py-1 rounded-md ${(sellerOnboarded && paymentsEnabled) ? 'bg-blue-600 text-white' : 'bg-gray-300 text-gray-600 cursor-not-allowed'}`}
              aria-disabled={!(sellerOnboarded && paymentsEnabled)}
            >Get</Link>
            <button
              onClick={async () => {
                if (!activeChat) return
                await sendMessage(activeChat, '[LEAVE] not interested')
              }}
              className="px-3 py-1 rounded-md bg-gray-200 text-gray-900"
            >Leave</button>
            {sellerId && (
              <Link href={`/profile/${sellerId}`} className="ml-auto px-3 py-1 rounded-md bg-gray-100 text-gray-900">View Seller</Link>
            )}
            {sellerOnboarded === false && (
              <span className="text-xs text-yellow-700 bg-yellow-100 px-2 py-1 rounded">Seller not onboarded</span>
            )}
            {milestonesEnabled && (
              <button onClick={()=>setShowMilestoneForm(v=>!v)} className="px-3 py-1 rounded-md bg-purple-600 text-white">Add Milestone</button>
            )}
          </div>
        )}
        {showMilestoneForm && listingId && (
          <div className="mb-2 flex items-center gap-2">
            <input value={msTitle} onChange={(e)=>setMsTitle(e.target.value)} className="flex-1 border rounded-md p-2" placeholder="Milestone title" />
            <input value={msAmount} onChange={(e)=>setMsAmount(e.target.value)} className="w-32 border rounded-md p-2" placeholder="Amount" />
            <button
              onClick={async () => {
                const s = await supabase.auth.getSession()
                const at = s.data.session?.access_token || ''
                const res = await fetch('/api/milestones/create', { method: 'POST', headers: await withCsrfHeaders({ 'Content-Type': 'application/json', ...(at ? { Authorization: `Bearer ${at}` } : {}) }), body: JSON.stringify({ listingId, title: msTitle, amount: msAmount }) })
                if (res.ok) {
                  const json = await res.json()
                  await sendMessage(activeChat!, `[MILESTONE] ${msTitle} - ${msAmount}`)
                  setShowMilestoneForm(false)
                }
              }}
              className="px-3 py-1 rounded-md bg-green-600 text-white"
            >Save</button>
          </div>
        )}
        <div className="flex-1 space-y-2 overflow-auto max-h-[50vh]">
          {messages.map((m) => (
            <div key={m.id} className="px-2 py-1 rounded bg-gray-100">
              <div className="text-xs text-gray-500">{new Date(m.created_at).toLocaleString()}</div>
              <div>{m.content}</div>
            </div>
          ))}
          {messages.length === 0 && <div className="text-sm text-muted-foreground">No messages</div>}
        </div>
        <div className="mt-2 flex gap-2">
          <input value={text} onChange={(e)=>setText(e.target.value)} className="flex-1 border rounded-md p-2" placeholder="Type a message" />
          <button onClick={send} className="px-3 py-2 rounded-md bg-blue-600 text-white">Send</button>
        </div>
      </div>
    </div>
  )
}

export default function ChatPage() {
  return (
    <ErrorBoundary
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <ErrorFallback
            error={new Error('Chat system error')}
            resetError={() => window.location.reload()}
            title="Chat Error"
            description="There was an error loading the chat system. Please refresh the page."
          />
        </div>
      }
    >
      <ChatPageContent />
    </ErrorBoundary>
  )
}