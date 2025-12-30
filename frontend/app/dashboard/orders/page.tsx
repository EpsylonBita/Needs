"use client";

import { useEffect, useState } from 'react'
 
import { supabase } from '@/lib/supabase/client'
import { withCsrfHeaders } from '@/lib/utils/csrf'

type PaymentRow = { id: string; listing_id: string; status: string; amount: number; buyer_id: string; seller_id: string; stripe_payment_intent: string | null }
type ListingRow = { id: string; title: string }

export default function OrdersPage() {
  const paymentsEnabled = (process.env.NEXT_PUBLIC_PAYMENTS_ENABLED || '').toLowerCase() === 'true'
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [listingsById, setListingsById] = useState<Record<string, ListingRow>>({})
  const [myProfileId, setMyProfileId] = useState<string | null>(null)

  useEffect(() => {
    const run = async () => {
      const u = await supabase.auth.getUser()
      const uid = u.data.user?.id
      if (!uid) return
      const prof = await supabase.from('profiles').select('id').eq('user_id', uid).limit(1).single()
      const pid = prof.data?.id
      if (!pid) return
      setMyProfileId(pid)
      const p = await supabase.from('payments').select('*').or(`buyer_id.eq.${pid},seller_id.eq.${pid}`).order('created_at', { ascending: false })
      const rows = (p.data || []) as PaymentRow[]
      setPayments(rows)
      const listingIds = Array.from(new Set(rows.map(r => r.listing_id)))
      if (listingIds.length) {
        const l = await supabase.from('listings').select('id,title').in('id', listingIds)
        const map: Record<string, ListingRow> = {};
        (l.data || []).forEach((x: any) => { map[x.id] = x })
        setListingsById(map)
      }
    }
    run()
  }, [])

  const confirm = async (p: PaymentRow) => {
    if (!p.stripe_payment_intent) return
    const s = await supabase.auth.getSession()
    const at = s.data.session?.access_token || ''
    const headers = await withCsrfHeaders({ 'Content-Type': 'application/json', ...(at ? { Authorization: `Bearer ${at}` } : {}) })
    await fetch('/api/payments/capture', {
      method: 'POST', headers, body: JSON.stringify({ intentId: p.stripe_payment_intent })
    })
    const refreshed = await supabase.from('payments').select('*').eq('id', p.id).single()
    if (refreshed.data) setPayments(prev => prev.map(x => x.id===p.id ? refreshed.data as any : x))
  }

  const confirmAsBuyer = async (p: PaymentRow) => {
    if (!myProfileId || myProfileId !== p.buyer_id) return
    await supabase.from('payments').update({ buyer_confirmed: true }).eq('id', p.id)
    const refreshed = await supabase.from('payments').select('*').eq('id', p.id).single()
    if (refreshed.data) setPayments(prev => prev.map(x => x.id===p.id ? refreshed.data as any : x))
  }

  const confirmAsSeller = async (p: PaymentRow) => {
    if (!myProfileId || myProfileId !== p.seller_id) return
    await supabase.from('payments').update({ seller_confirmed: true }).eq('id', p.id)
    const refreshed = await supabase.from('payments').select('*').eq('id', p.id).single()
    if (refreshed.data) setPayments(prev => prev.map(x => x.id===p.id ? refreshed.data as any : x))
  }

  const refund = async (p: PaymentRow) => {
    const s = await supabase.auth.getSession()
    const at = s.data.session?.access_token || ''
    const headers = await withCsrfHeaders({ ...(at ? { Authorization: `Bearer ${at}` } : {}) })
    await fetch(`/api/payments/disputes/${p.id}/create`, { method: 'POST', headers })
    const refreshed = await supabase.from('payments').select('*').eq('id', p.id).single()
    if (refreshed.data) setPayments(prev => prev.map(x => x.id===p.id ? refreshed.data as any : x))
  }

  return (
    <div className="container mx-auto p-4 pt-[72px]">
      <h1 className="text-2xl font-bold">Orders</h1>
      {!paymentsEnabled && (
        <div className="mt-2 p-3 rounded-md bg-yellow-100 text-yellow-800">Payments are disabled until Stripe is configured.</div>
      )}
      <div className="mt-4 border rounded-md">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="p-2">Listing</th>
              <th className="p-2">Amount</th>
              <th className="p-2">Status</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="p-2">{listingsById[p.listing_id]?.title || p.listing_id}</td>
                <td className="p-2">${Number(p.amount).toFixed(2)}</td>
                <td className="p-2">{p.status}</td>
                <td className="p-2 space-x-2">
                  {paymentsEnabled && p.status === 'requires_capture' && (
                    <>
                      {myProfileId === p.buyer_id && (
                        <button onClick={() => confirmAsBuyer(p)} className="px-3 py-1 rounded-md bg-blue-600 text-white">I’m done (Buyer)</button>
                      )}
                      {myProfileId === p.seller_id && (
                        <button onClick={() => confirmAsSeller(p)} className="px-3 py-1 rounded-md bg-purple-600 text-white">I’m done (Seller)</button>
                      )}
                      {myProfileId === p.buyer_id && p.stripe_payment_intent && (
                        <button onClick={() => confirm(p)} disabled={!(p as any).buyer_confirmed || !(p as any).seller_confirmed} className="px-3 py-1 rounded-md bg-green-600 text-white">Capture</button>
                      )}
                    </>
                  )}
                  {paymentsEnabled && p.status !== 'refunded' && myProfileId === p.buyer_id && (
                    <button onClick={() => refund(p)} className="px-3 py-1 rounded-md bg-red-600 text-white">Request Refund</button>
                  )}
                  {paymentsEnabled && myProfileId === p.buyer_id && (
                    <button
                      onClick={async () => {
                        const s = await supabase.auth.getSession()
                        const at = s.data.session?.access_token || ''
                        await fetch(`/api/payments/disputes/${p.id}/create`, { method: 'POST', headers: await withCsrfHeaders({ ...(at ? { Authorization: `Bearer ${at}` } : {}) }) })
                      }}
                      className="px-3 py-1 rounded-md bg-yellow-500 text-white"
                    >Open Dispute</button>
                  )}
                </td>
              </tr>
            ))}
            {payments.length === 0 && (
              <tr><td className="p-2" colSpan={4}>No orders</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
