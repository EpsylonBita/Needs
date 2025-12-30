"use client";

import { useEffect, useState } from 'react'
 
import { supabase } from '@/lib/supabase/client'
import { withCsrfHeaders } from '@/lib/utils/csrf'

type Tx = { id: string; amount: number; status: string; type: string }
type Dp = { id: string; status: string; reason: string | null }
type Pay = { id: string; status: string; amount: number; buyer_id: string; seller_id: string; stripe_payment_intent: string | null }

export default function PaymentsPage() {
  const paymentsEnabled = (process.env.NEXT_PUBLIC_PAYMENTS_ENABLED || '').toLowerCase() === 'true'
  const [txs, setTxs] = useState<Tx[]>([])
  const [dps, setDps] = useState<Dp[]>([])
  const [pays, setPays] = useState<Pay[]>([])
  const [myProfileId, setMyProfileId] = useState<string | null>(null)

  useEffect(() => {
    const run = async () => {
      const userRes = await supabase.auth.getUser()
      const userId = userRes.data.user?.id
      if (!userId) return
      const prof = await supabase.from('profiles').select('id').eq('user_id', userId).limit(1).single()
      const pid = prof.data?.id
      if (!pid) return
      setMyProfileId(pid)
      const p = await supabase.from('payments').select('id,status,amount,buyer_id,seller_id,stripe_payment_intent').or(`buyer_id.eq.${pid},seller_id.eq.${pid}`)
      const paymentIds = (p.data || []).map((x: any) => x.id)
      setPays((p.data || []) as any)
      if (paymentIds.length > 0) {
        const t = await supabase.from('transactions').select('id,amount,status,type').in('payment_id', paymentIds)
        const d = await supabase.from('disputes').select('id,status,reason').in('payment_id', paymentIds)
        setTxs((t.data || []) as any)
        setDps((d.data || []) as any)
      }
      ;(window as any).__MY_PROFILE_ID = pid
    }
    run()
  }, [])

  const confirmAsBuyer = async (p: Pay) => {
    if (!myProfileId || myProfileId !== p.buyer_id) return
    await supabase.from('payments').update({ buyer_confirmed: true }).eq('id', p.id)
    const refreshed = await supabase.from('payments').select('id,status,amount,buyer_id,seller_id,stripe_payment_intent,buyer_confirmed,seller_confirmed').eq('id', p.id).single()
    if (refreshed.data) setPays((prev) => prev.map(x => x.id===p.id ? refreshed.data as any : x))
  }

  const confirmAsSeller = async (p: Pay) => {
    if (!myProfileId || myProfileId !== p.seller_id) return
    await supabase.from('payments').update({ seller_confirmed: true }).eq('id', p.id)
    const refreshed = await supabase.from('payments').select('id,status,amount,buyer_id,seller_id,stripe_payment_intent,buyer_confirmed,seller_confirmed').eq('id', p.id).single()
    if (refreshed.data) setPays((prev) => prev.map(x => x.id===p.id ? refreshed.data as any : x))
  }

  return (
    <div className="container mx-auto p-4 pt-[72px]">
      <h1 className="text-2xl font-bold">Payments</h1>
      {!paymentsEnabled && (
        <div className="mt-2 p-3 rounded-md bg-yellow-100 text-yellow-800">Payments are disabled until Stripe is configured.</div>
      )}
      <div className="mt-4 border rounded-md p-2">
        <h2 className="text-xl font-semibold">My Payments</h2>
        <table className="w-full text-sm mt-2">
          <thead>
            <tr className="text-left">
              <th className="p-2">Status</th>
              <th className="p-2">Amount</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pays.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="p-2">{p.status}</td>
                <td className="p-2">${Number(p.amount).toFixed(2)}</td>
                <td className="p-2 space-x-2">
                  {paymentsEnabled && p.status === 'requires_capture' && (
                    <>
                      {myProfileId === p.buyer_id && (
                        <button onClick={() => confirmAsBuyer(p)} className="px-3 py-1 rounded-md bg-blue-600 text-white">I’m done (Buyer)</button>
                      )}
                      {myProfileId === p.seller_id && (
                        <button onClick={() => confirmAsSeller(p)} className="px-3 py-1 rounded-md bg-purple-600 text-white">I’m done (Seller)</button>
                      )}
                      {p.stripe_payment_intent && myProfileId === p.buyer_id && (
                        <button
                          onClick={async () => {
                            const s = await supabase.auth.getSession()
                            const at = s.data.session?.access_token || ''
                            const headers = await withCsrfHeaders({ 'Content-Type': 'application/json', ...(at ? { Authorization: `Bearer ${at}` } : {}) })
                            await fetch('/api/payments/capture', {
                              method: 'POST',
                              headers,
                              body: JSON.stringify({ intentId: p.stripe_payment_intent }),
                            })
                            const refreshed = await supabase.from('payments').select('id,status,amount,buyer_id,seller_id,stripe_payment_intent,buyer_confirmed,seller_confirmed').eq('id', p.id).single()
                            if (refreshed.data) setPays((prev) => prev.map(x => x.id===p.id ? refreshed.data as any : x))
                          }}
                          className="px-3 py-1 rounded-md bg-green-600 text-white"
                          disabled={!(p as any).buyer_confirmed || !(p as any).seller_confirmed}
                        >Capture</button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
            {pays.length === 0 && (
              <tr><td className="p-2" colSpan={3}>No payments</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="text-xl font-semibold">Transactions</h2>
          <div className="mt-2 border rounded-md">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="p-2">Type</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {txs.map((t) => (
                  <tr key={t.id} className="border-t">
                    <td className="p-2">{t.type}</td>
                    <td className="p-2">{t.status}</td>
                    <td className="p-2">${t.amount.toFixed(2)}</td>
                  </tr>
                ))}
                {txs.length === 0 && (
                  <tr><td className="p-2" colSpan={3}>No transactions</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h2 className="text-xl font-semibold">Disputes</h2>
          <div className="mt-2 border rounded-md">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="p-2">Status</th>
                  <th className="p-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {dps.map((d) => (
                  <tr key={d.id} className="border-t">
                    <td className="p-2">{d.status}</td>
                    <td className="p-2">{d.reason || ''}</td>
                  </tr>
                ))}
                {dps.length === 0 && (
                  <tr><td className="p-2" colSpan={2}>No disputes</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
export const dynamic = 'force-dynamic'
