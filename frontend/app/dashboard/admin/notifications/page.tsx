"use client";

import { useEffect, useState } from 'react'
 
import { supabase } from '@/lib/supabase/client'

type NotificationRow = { id: string; user_id: string; type: string; payload: any; read: boolean; created_at: string }

export default function AdminNotificationsPage() {
  const [rows, setRows] = useState<NotificationRow[]>([])
  const [userIdFilter, setUserIdFilter] = useState<string>('')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [message, setMessage] = useState<string>('')
  const [targetUser, setTargetUser] = useState<string>('')

  useEffect(() => {
    const run = async () => {
      let q = supabase.from('notifications').select('id,user_id,type,payload,read,created_at').order('created_at', { ascending: false }).limit(100)
      const { data } = await q
      setRows((data || []) as NotificationRow[])
    }
    run()
    const ch = supabase.channel('admin-notifs').on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, run).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  const filtered = rows.filter(n => (userIdFilter ? n.user_id===userIdFilter : true) && (typeFilter ? n.type===typeFilter : true))

  const broadcast = async () => {
    if (!targetUser || !message) return
    await supabase.from('notifications').insert({ user_id: targetUser, type: 'admin_broadcast', payload: { message } })
    const { data } = await supabase.from('notifications').select('id,user_id,type,payload,read,created_at').order('created_at', { ascending: false }).limit(100)
    setRows((data || []) as NotificationRow[])
    setMessage('')
  }

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold">Notifications (Admin)</h1>
      <div className="mt-2 flex gap-2">
        <input value={userIdFilter} onChange={(e)=>setUserIdFilter(e.target.value)} className="border rounded-md p-2" placeholder="Filter by user id" />
        <input value={typeFilter} onChange={(e)=>setTypeFilter(e.target.value)} className="border rounded-md p-2" placeholder="Filter by type" />
      </div>
      <div className="mt-4 border rounded-md p-3 flex gap-2 items-center">
        <input value={targetUser} onChange={(e)=>setTargetUser(e.target.value)} className="border rounded-md p-2" placeholder="Target user id" />
        <input value={message} onChange={(e)=>setMessage(e.target.value)} className="flex-1 border rounded-md p-2" placeholder="Message" />
        <button onClick={broadcast} className="px-3 py-1 rounded-md bg-blue-600 text-white">Send</button>
      </div>
      <div className="mt-4 border rounded-md">
        <table className="w-full text-sm">
          <thead><tr className="text-left"><th className="p-2">User</th><th className="p-2">Type</th><th className="p-2">Payload</th><th className="p-2">When</th></tr></thead>
          <tbody>
            {filtered.map(n => (
              <tr key={n.id} className="border-t">
                <td className="p-2">{n.user_id}</td>
                <td className="p-2">{n.type}</td>
                <td className="p-2"><code className="text-xs">{JSON.stringify(n.payload||{})}</code></td>
                <td className="p-2">{new Date(n.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {filtered.length===0 && (<tr><td className="p-2" colSpan={4}>No notifications</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  )
}
