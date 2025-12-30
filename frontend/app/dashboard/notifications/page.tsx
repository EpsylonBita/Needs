"use client";

import { useEffect, useState } from 'react'
 
import { supabase } from '@/lib/supabase/client'

type NotificationRow = { id: string; type: string; payload: any; read: boolean; created_at: string }

export default function NotificationsPage() {
  const [rows, setRows] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState<boolean>(false)

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      const u = await supabase.auth.getUser()
      const uid = u.data.user?.id
      if (!uid) { setLoading(false); return }
      const { data: me } = await supabase.from('profiles').select('id').eq('user_id', uid).limit(1).single()
      const myId = me?.id
      if (!myId) { setLoading(false); return }
      const { data } = await supabase
        .from('notifications')
        .select('id,type,payload,read,created_at')
        .eq('user_id', myId)
        .order('created_at', { ascending: false })
        .limit(50)
      setRows((data || []) as any)
      setLoading(false)
    }
    run()
  }, [])

  const markRead = async (id: string) => {
    const updated = await supabase.from('notifications').update({ read: true }).eq('id', id).select('id,type,payload,read,created_at').single()
    if (updated.data) setRows(prev => prev.map(r => r.id===id ? updated.data as any : r))
  }

  return (
    <div className="container mx-auto p-4 pt-[72px]">
      <h1 className="text-2xl font-bold">Notifications</h1>
      {loading && <div className="text-sm text-gray-500">Loading…</div>}
      <div className="mt-4 border rounded-md">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="p-2">Type</th>
              <th className="p-2">Details</th>
              <th className="p-2">When</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(n => (
              <tr key={n.id} className="border-t">
                <td className="p-2">{n.type}</td>
                <td className="p-2"><code className="text-xs">{JSON.stringify(n.payload || {})}</code></td>
                <td className="p-2">{new Date(n.created_at).toLocaleString()}</td>
                <td className="p-2">
                  {!n.read && (
                    <button onClick={() => markRead(n.id)} className="px-3 py-1 rounded-md bg-blue-600 text-white">Mark Read</button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td className="p-2" colSpan={4}>No notifications</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
