"use client";

import { useEffect, useState } from 'react'

import { supabase } from '@/lib/supabase/client'

type CheckResult = { name: string; ok: boolean; detail?: string }

export default function StatusPage() {
  const [results, setResults] = useState<CheckResult[]>([])

  useEffect(() => {
    const run = async () => {
      const r: CheckResult[] = []
      try {
        const urlOk = !!process.env.NEXT_PUBLIC_SUPABASE_URL
        const keyOk = !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        r.push({ name: 'Supabase URL env', ok: urlOk })
        r.push({ name: 'Supabase anon key env', ok: keyOk })

        const sessionRes = await supabase.auth.getSession()
        r.push({ name: 'Auth session fetch', ok: true, detail: sessionRes.data.session ? 'logged in' : 'anonymous' })

        const loc = { lng: 23.7275, lat: 37.9838 }
        const rpc = await supabase.rpc('nearby_listings', { lon: loc.lng, lat: loc.lat, radius_m: 10000 })
        r.push({ name: 'RPC nearby_listings', ok: !rpc.error, detail: rpc.error ? rpc.error.message : String((rpc.data || []).length) })

        const userRes = await supabase.auth.getUser()
        const userId = userRes.data.user?.id
        if (userId) {
          const listAvatars = await supabase.storage.from('avatars').list(`${userId}`)
          r.push({ name: 'Storage list avatars', ok: !listAvatars.error, detail: listAvatars.error ? listAvatars.error.message : String((listAvatars.data || []).length) })
        } else {
          r.push({ name: 'Storage list avatars', ok: false, detail: 'login required' })
        }
      } catch (e: unknown) {
        const err = e as { message?: string } | Error
        r.push({ name: 'Status error', ok: false, detail: (err as { message?: string })?.message || String(err) })
      }
      setResults(r)
    }
    run()
  }, [])

  return (
    <div className="container mx-auto p-4 pt-[72px]">
      <h1 className="text-2xl font-bold">Status</h1>
      <div className="mt-4 space-y-2">
        {results.map((x) => (
          <div key={x.name} className={`p-3 rounded-md ${x.ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            <div className="flex items-center justify-between">
              <span>{x.name}</span>
              <span>{x.ok ? 'OK' : 'FAIL'}</span>
            </div>
            {x.detail && <div className="mt-1 text-sm opacity-80">{x.detail}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
