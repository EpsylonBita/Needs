"use client";

import { useEffect, useState } from 'react'
import Link from 'next/link'

import { supabase } from '@/lib/supabase/client'
import { withCsrfHeaders } from '@/lib/utils/csrf'

type Pay = { id: string; status: string; amount: number; buyer_id: string; seller_id: string; stripe_payment_intent: string | null; buyer_confirmed?: boolean; seller_confirmed?: boolean }

export default function PaymentReturnPage() {
  const [pays, setPays] = useState<Pay[]>([])
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
      const p = await supabase
        .from('payments')
        .select('id,status,amount,buyer_id,seller_id,stripe_payment_intent,buyer_confirmed,seller_confirmed')
        .or(`buyer_id.eq.${pid},seller_id.eq.${pid}`)
        .order('created_at', { ascending: false })
        .limit(10)
      setPays((p.data || []) as Pay[])
    }
    run()
  }, [])

  return (
    <div className="container mx-auto p-4 pt-[72px] space-y-4">
      <h1 className="text-2xl font-bold">Payment Complete</h1>
      <p className="text-muted-foreground">Next steps depend on both parties confirming completion. Capture happens only after mutual confirmation.</p>
      <div className="border rounded-md p-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="p-2">Status</th>
              <th className="p-2">Amount</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pays.map(p => (
              <tr key={p.id} className="border-t">
                <td className="p-2">{p.status}</td>
                <td className="p-2">${Number(p.amount).toFixed(2)}</td>
                <td className="p-2 space-x-2">
                  <Link href="/dashboard/payments" className="px-3 py-1 rounded-md bg-blue-600 text-white">Go to Payments</Link>
                  {myProfileId === p.buyer_id && p.stripe_payment_intent && p.status === 'requires_capture' && (
                    <button
                      disabled={!p.buyer_confirmed || !p.seller_confirmed}
                      onClick={async () => {
                        const s = await supabase.auth.getSession()
                        const at = s.data.session?.access_token || ''
                        const headers = await withCsrfHeaders({ 'Content-Type': 'application/json', ...(at ? { Authorization: `Bearer ${at}` } : {}) })
                        await fetch('/api/payments/capture', { method: 'POST', headers, body: JSON.stringify({ intentId: p.stripe_payment_intent }) })
                        const refreshed = await supabase.from('payments').select('*').eq('id', p.id).single()
                        if (refreshed.data) setPays(prev => prev.map(x => x.id===p.id ? refreshed.data as Pay : x))
                      }}
                      className="px-3 py-1 rounded-md bg-green-600 text-white"
                    >Capture</button>
                  )}
                </td>
              </tr>
            ))}
            {pays.length === 0 && (
              <tr><td className="p-2" colSpan={3}>No recent payments</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
