"use client";

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { withCsrfHeaders } from '@/lib/utils/csrf'

type ListingRow = { id: string; title: string; status: string }

export default function AdminListingsPage() {
  const [rows, setRows] = useState<ListingRow[]>([])
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const run = async () => {
      const s = await supabase.auth.getSession()
      const at = s.data.session?.access_token || ''
      const chk = await fetch('/api/admin/check', { headers: { ...(at ? { Authorization: `Bearer ${at}` } : {}) } })
      if (!chk.ok) { setAllowed(false); router.push('/dashboard'); return }
      setAllowed(true)
      const { data } = await supabase
        .from('listings')
        .select('id,title,status')
        .order('created_at', { ascending: false })
        .limit(50)
      setRows((data || []) as ListingRow[])
    }
    run()
    const ch = supabase.channel('admin-listings').on('postgres_changes', { event: '*', schema: 'public', table: 'listings' }, async () => {
      const { data } = await supabase
        .from('listings')
        .select('id,title,status')
        .order('created_at', { ascending: false })
        .limit(50)
      setRows((data || []) as ListingRow[])
    }).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [router])

  const suspend = async (id: string) => {
    setLoading(true)
    const s = await supabase.auth.getSession()
    const at = s.data.session?.access_token || ''
    await fetch(`/api/admin/listings/${id}/suspend`, { method: 'POST', headers: await withCsrfHeaders({ ...(at ? { Authorization: `Bearer ${at}` } : {}) }) })
    const { data } = await supabase.from('listings').select('id,title,status').eq('id', id).single()
    if (data) setRows(prev => prev.map(r => r.id===id ? (data as ListingRow) : r))
    setLoading(false)
  }

  return (
    <div className="container mx-auto p-4 pt-[72px]">
      <h1 className="text-2xl font-bold">Listings Moderation</h1>
      {allowed === false && (<div className="mt-2">Forbidden</div>)}
      <div className="mt-4 border rounded-md">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="p-2">Title</th>
              <th className="p-2">Status</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="p-2">{l.title}</td>
                <td className="p-2">{l.status}</td>
                <td className="p-2">
                  <button disabled={loading || l.status==='suspended'} onClick={() => suspend(l.id)} className="px-3 py-1 rounded-md bg-red-600 text-white">Suspend</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td className="p-2" colSpan={3}>No listings</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
