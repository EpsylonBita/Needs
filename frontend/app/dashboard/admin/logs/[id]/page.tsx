"use client";

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
 
import { adminRequest } from '../../admin-request'

type LogRow = { id: string; admin_email: string; listing_id: string; action: string; admin_notes: string | null; created_at: string; listing: { title: string } | null }

export default function AdminLogDetailPage() {
  const params = useParams()
  const id = Array.isArray(params?.id) ? (params?.id[0] as string) : ((params?.id as string) || '')
  const [row, setRow] = useState<LogRow | null>(null)
  const [listingTitle, setListingTitle] = useState<string>('')
  const [note, setNote] = useState<string>('')
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const run = async () => {
      try {
        const { log } = await adminRequest<{ log: LogRow }>(`/api/admin/logs/${encodeURIComponent(id)}`)
        setAllowed(true)
        setRow(log)
        setNote(log.admin_notes || '')
        setListingTitle(log.listing?.title || '')
      } catch (cause) {
        if ((cause as { status?: number }).status === 403) { setAllowed(false); router.push('/dashboard'); return }
        setError(cause instanceof Error ? cause.message : 'Unable to load moderation log')
      }
    }
    run()
  }, [id, router])

  const saveNote = async () => {
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      await adminRequest(`/api/admin/logs/${encodeURIComponent(id)}/note`, { method: 'POST', body: JSON.stringify({ note }) })
      setSaved(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save note') }
    finally { setBusy(false) }
  }

  if (allowed === false) return null
  return (
    <div className="container mx-auto p-4 pt-[72px] space-y-4">
      <h1 className="text-2xl font-bold">Log Detail</h1>
      {error && <div role="alert" className="text-destructive">{error}</div>}
      {saved && <div role="status">Saved</div>}
      {row && (
        <div className="border rounded-md p-3 space-y-2">
          <div className="text-sm">When: {new Date(row.created_at).toLocaleString()}</div>
          <div className="text-sm">Admin: {row.admin_email}</div>
          <div className="text-sm">Listing: {row.listing_id} {listingTitle && `(${listingTitle})`}</div>
          <div className="text-sm">Action: {row.action}</div>
          <div>
            <div className="text-sm font-medium">Admin Notes</div>
            <textarea value={note} onChange={(e)=>{ setNote(e.target.value); setSaved(false) }} disabled={busy} className="w-full border border-input bg-background text-foreground rounded-md p-2" />
            <button onClick={saveNote} disabled={busy} className="mt-2 px-3 py-1 rounded-md bg-blue-600 text-white">Save</button>
          </div>
        </div>
      )}
    </div>
  )
}
