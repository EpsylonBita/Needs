"use client";

import { useEffect, useState } from 'react'
 
import { getMyListings, updateListingStatus, deleteListing } from '@/lib/services/listing-service'

type ListingRow = {
  id: string
  title: string
  description: string
  price: number
  main_category: string
  sub_category: string
  status: 'active' | 'sold' | 'suspended'
}

export default function MyListingsPage() {
  const [listings, setListings] = useState<ListingRow[]>([])
  const [filter, setFilter] = useState<string>('all')
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const data = await getMyListings()
      setListings((data || []) as ListingRow[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const changeStatus = async (id: string, status: ListingRow['status']) => {
    setLoading(true)
    await updateListingStatus(id, status)
    await load()
  }

  const remove = async (id: string) => {
    setLoading(true)
    await deleteListing(id)
    await load()
  }

  const filtered = listings.filter(l => filter === 'all' ? true : l.status === filter)

  return (
    <div className="container mx-auto p-4 pt-[72px]">
      <h1 className="text-2xl font-bold">My Listings</h1>
      <div className="mt-4 flex items-center gap-2">
        <label className="text-sm">Filter:</label>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="border rounded-md p-1">
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="sold">Sold</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>
      <div className="mt-4 border rounded-md">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="p-2">Title</th>
              <th className="p-2">Category</th>
              <th className="p-2">Price</th>
              <th className="p-2">Status</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="p-2">{l.title}</td>
                <td className="p-2">{l.main_category} • {l.sub_category}</td>
                <td className="p-2">${Number(l.price || 0).toFixed(2)}</td>
                <td className="p-2">{l.status}</td>
                <td className="p-2 space-x-2">
                  <button disabled={loading} onClick={() => changeStatus(l.id, 'active')} className="px-3 py-1 rounded-md bg-blue-600 text-white">Activate</button>
                  <button disabled={loading} onClick={() => changeStatus(l.id, 'suspended')} className="px-3 py-1 rounded-md bg-yellow-600 text-white">Suspend</button>
                  <button disabled={loading} onClick={() => changeStatus(l.id, 'sold')} className="px-3 py-1 rounded-md bg-green-600 text-white">Mark Sold</button>
                  <button disabled={loading} onClick={() => remove(l.id)} className="px-3 py-1 rounded-md bg-red-600 text-white">Delete</button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td className="p-2" colSpan={5}>No listings</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
