'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminRequest } from '../admin-request'

type ListingRow = { id: string; title: string; status: string; owner_status: string; moderation_suspended: boolean }
type ListingResponse = { listings: ListingRow[]; page: number; totalPages: number }

export default function AdminListingsPage() {
  const [rows, setRows] = useState<ListingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [filter, setFilter] = useState('all')
  const load = useCallback(async () => {
    const result = await adminRequest<ListingResponse>(`/api/admin/listings?page=${page}&filter=${filter}`)
    setRows(result.listings)
    setTotalPages(result.totalPages)
  }, [page, filter])

  useEffect(() => {
    let active = true
    adminRequest<ListingResponse>(`/api/admin/listings?page=${page}&filter=${filter}`)
      .then(result => { if (active) { setRows(result.listings); setTotalPages(result.totalPages) } })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Listings could not be loaded') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [page, filter])

  function changePage(nextPage: number) {
    setLoading(true)
    setError(null)
    setPage(nextPage)
  }

  async function moderate(listing: ListingRow) {
    setLoading(true)
    setError(null)
    try {
      await adminRequest(`/api/admin/listings/${listing.id}/${listing.moderation_suspended ? 'unsuspend' : 'suspend'}`, {
        method: 'POST', body: JSON.stringify({}),
      })
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Moderation could not be saved')
    } finally { setLoading(false) }
  }

  return <div className="container mx-auto p-4 pt-[72px] space-y-4">
    <h1 className="text-2xl font-bold">Listings Moderation</h1>
    <p className="text-sm text-muted-foreground">Releasing a hold restores the owner’s previous visibility. Previously suspended listings remain paused until the owner activates them.</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <label className="flex items-center gap-2">Show
      <select value={filter} disabled={loading} onChange={event => { setLoading(true); setError(null); setFilter(event.target.value); setPage(1) }} className="border rounded-md p-2">
        <option value="all">All listings</option><option value="held">Under moderation</option>
      </select>
    </label>
    {loading && <p role="status">Loading…</p>}
    <div className="overflow-x-auto border rounded-md">
      <table className="w-full text-sm">
        <thead><tr className="text-left"><th className="p-2">Title</th><th className="p-2">Visibility</th><th className="p-2">Moderation</th><th className="p-2">Actions</th></tr></thead>
        <tbody>{rows.map(listing => <tr key={listing.id} className="border-t">
          <td className="p-2">{listing.title}</td>
          <td className="p-2">{listing.owner_status === 'suspended' ? 'Paused' : listing.owner_status}</td>
          <td className="p-2">{listing.moderation_suspended ? 'Under moderation' : 'No hold'}</td>
          <td className="p-2"><button disabled={loading} onClick={() => { void moderate(listing) }} className="px-3 py-2 rounded-md bg-primary text-primary-foreground disabled:opacity-50">{listing.moderation_suspended ? 'Release hold' : 'Suspend'}</button></td>
        </tr>)}</tbody>
      </table>
      {!loading && !error && rows.length === 0 && <p className="p-4">No listings</p>}
    </div>
    <nav aria-label="Listing pages" className="flex items-center gap-3">
      <button disabled={loading || page <= 1} onClick={() => changePage(page - 1)}>Previous</button>
      <span>Page {page} of {totalPages}</span>
      <button disabled={loading || page >= totalPages} onClick={() => changePage(page + 1)}>Next</button>
    </nav>
  </div>
}
