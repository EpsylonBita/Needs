"use client";

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
 
import { supabase } from '@/lib/supabase/client'
import { withCsrfHeaders } from '@/lib/utils/csrf'

export default function AdminLogDetailPage() {
  const params = useParams()
  const id = Array.isArray(params?.id) ? (params?.id[0] as string) : ((params?.id as string) || '')
  const [row, setRow] = useState<any>(null)
  const [listingTitle, setListingTitle] = useState<string>('')
  const [note, setNote] = useState<string>('')
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const router = useRouter()

  useEffect(() => {
    const run = async () => {
      const s = await supabase.auth.getSession()
      const at = s.data.session?.access_token || ''
      const chk = await fetch('/api/admin/check', { headers: { ...(at ? { Authorization: `Bearer ${at}` } : {}) } })
      if (!chk.ok) { setAllowed(false); router.push('/dashboard'); return }
      setAllowed(true)
      const { data } = await supabase
        .from('moderation_logs')
        .select('id,admin_email,listing_id,action,admin_notes,created_at')
        .eq('id', id)
        .single()
      setRow(data)
      setNote(data?.admin_notes || '')
      if (data?.listing_id) {
        const { data: l } = await supabase.from('listings').select('title').eq('id', data.listing_id).single()
        setListingTitle(l?.title || '')
      }
    }
    run()
  }, [id, router])

  const saveNote = async () => {
    const s = await supabase.auth.getSession()
    const at = s.data.session?.access_token || ''
    await fetch(`/api/admin/logs/${id}/note`, { method: 'POST', headers: await withCsrfHeaders({ 'Content-Type': 'application/json', ...(at ? { Authorization: `Bearer ${at}` } : {}) }), body: JSON.stringify({ note }) })
  }

  if (allowed === false) return null
  return (
    <div className="container mx-auto p-4 pt-[72px] space-y-4">
      <h1 className="text-2xl font-bold">Log Detail</h1>
      {row && (
        <div className="border rounded-md p-3 space-y-2">
          <div className="text-sm">When: {new Date(row.created_at).toLocaleString()}</div>
          <div className="text-sm">Admin: {row.admin_email}</div>
          <div className="text-sm">Listing: {row.listing_id} {listingTitle && `(${listingTitle})`}</div>
          <div className="text-sm">Action: {row.action}</div>
          <div>
            <div className="text-sm font-medium">Admin Notes</div>
            <textarea value={note} onChange={(e)=>setNote(e.target.value)} className="w-full border rounded-md p-2" />
            <button onClick={saveNote} className="mt-2 px-3 py-1 rounded-md bg-blue-600 text-white">Save</button>
          </div>
        </div>
      )}
    </div>
  )
}
