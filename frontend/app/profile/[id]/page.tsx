"use client";

import { useEffect, useState } from 'react'

import Image from 'next/image'
import Link from 'next/link'
import { useParams } from 'next/navigation'

import { supabase } from '@/lib/supabase/client'
import { withCsrfHeaders } from '@/lib/utils/csrf'
 

type ProfileRow = { id: string; display_name?: string; avatar_url?: string; reputation?: number }
type ListingRow = { id: string; title: string; price: number; status: string }

export default function PublicProfilePage() {
  const params = useParams()
  const idParam = (params?.id ?? '') as string | string[]
  const id = Array.isArray(idParam) ? idParam[0] : idParam
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [rating, setRating] = useState<{ avg: number; count: number } | null>(null)
  const [listings, setListings] = useState<ListingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [eligibleListings, setEligibleListings] = useState<ListingRow[]>([])
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null)
  const [reviewRating, setReviewRating] = useState<number>(5)
  const [reviewComment, setReviewComment] = useState<string>('')
  const [reviewSubmitted, setReviewSubmitted] = useState<boolean>(false)

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      const { data: p } = await supabase.from('profiles').select('id,display_name,avatar_url,reputation').eq('id', id).single()
      if (p) setProfile(p)
      const { data: revs } = await supabase
        .from('reviews')
        .select('rating')
        .eq('seller_id', id)
      if (revs && revs.length > 0) {
        const sum = revs.reduce((acc: number, r: { rating?: number }) => acc + Number(r.rating || 0), 0)
        setRating({ avg: sum / revs.length, count: revs.length })
      } else {
        setRating({ avg: 0, count: 0 })
      }
      const { data: ls } = await supabase
        .from('listings')
        .select('id,title,price,status')
        .eq('seller_id', id)
        .order('created_at', { ascending: false })
      setListings((ls || []) as ListingRow[])
      setLoading(false)
      const u = await supabase.auth.getUser()
      const uid = u.data.user?.id
      if (uid) {
        const { data: me } = await supabase.from('profiles').select('id').eq('user_id', uid).limit(1).single()
        if (me?.id) {
          const { data: pays } = await supabase
            .from('payments')
            .select('listing_id')
            .eq('buyer_id', me.id)
            .eq('seller_id', id)
            .eq('status', 'completed')
          const listingIds = Array.from(new Set((pays || []).map((x: { listing_id: string }) => x.listing_id)))
          if (listingIds.length > 0) {
            const { data: ls } = await supabase.from('listings').select('id,title,price,status').in('id', listingIds)
            setEligibleListings((ls || []) as ListingRow[])
            setSelectedListingId((ls || [])[0]?.id || null)
          }
        }
      }
    }
    run()
  }, [id])

  return (
    <div className="container mx-auto p-4 pt-[72px] space-y-6">
      <div className="flex items-center gap-4 justify-between">
        <div className="h-16 w-16 rounded-full bg-gray-200 overflow-hidden relative">
          {profile?.avatar_url && (
            <Image
              src={profile.avatar_url}
              alt="avatar"
              fill
              sizes="64px"
              className="object-cover rounded-full"
            />
          )}
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{profile?.display_name || 'User'}</h1>
          <div className="text-sm text-gray-600">Reputation: {Number(profile?.reputation || 0).toFixed(2)}</div>
          {rating && (
            <div className="text-sm text-gray-600">Rating: {rating.count > 0 ? rating.avg.toFixed(2) : 'No reviews'} ({rating.count})</div>
          )}
        </div>
        <div>
          <Link href="/dashboard" className="px-3 py-2 rounded-md bg-blue-600 text-white">Dashboard</Link>
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold">Listings</h2>
        <div className="mt-2 border rounded-md">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="p-2">Title</th>
                <th className="p-2">Price</th>
                <th className="p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="p-2">{l.title}</td>
                  <td className="p-2">${Number(l.price).toFixed(2)}</td>
                  <td className="p-2">{l.status}</td>
                </tr>
              ))}
              {listings.length === 0 && (
                <tr><td className="p-2" colSpan={3}>No listings</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {eligibleListings.length > 0 && !reviewSubmitted && (
        <div className="border rounded-md p-3 space-y-2">
          <div className="text-sm font-medium">Leave a Review</div>
          <div className="flex gap-2 items-center">
            <select value={selectedListingId || ''} onChange={(e)=>setSelectedListingId(e.target.value)} className="border rounded-md p-2">
              {eligibleListings.map(l => (<option key={l.id} value={l.id}>{l.title}</option>))}
            </select>
            <input type="number" min={1} max={5} value={reviewRating} onChange={(e)=>setReviewRating(Number(e.target.value))} className="w-20 border rounded-md p-2" />
          </div>
          <textarea value={reviewComment} onChange={(e)=>setReviewComment(e.target.value)} className="w-full border rounded-md p-2" placeholder="Comment (optional)" />
          <button
            onClick={async () => {
              const s = await supabase.auth.getSession()
              const at = s.data.session?.access_token || ''
              if (!selectedListingId) return
              const res = await fetch('/api/reviews/submit', { method: 'POST', headers: await withCsrfHeaders({ 'Content-Type': 'application/json', ...(at ? { Authorization: `Bearer ${at}` } : {}) }), body: JSON.stringify({ listingId: selectedListingId, rating: reviewRating, comment: reviewComment }) })
              if (res.ok) setReviewSubmitted(true)
            }}
            className="px-3 py-2 rounded-md bg-blue-600 text-white"
          >Submit Review</button>
        </div>
      )}

      {loading && (<div className="text-sm text-gray-500">Loading…</div>)}
    </div>
  )
}
