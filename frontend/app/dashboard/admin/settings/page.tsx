"use client";

import { useEffect, useState } from 'react'
 
import { adminRequest } from '../admin-request'

type Flag = { key: string; enabled: boolean }

export default function AdminSettingsPage() {
  const [flags, setFlags] = useState<Flag[]>([])
  const [newKey, setNewKey] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const loadFlags = async () => {
    const data = await adminRequest<{ flags: Flag[] }>('/api/admin/settings')
    setFlags(data.flags)
  }

  useEffect(() => {
    loadFlags().catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to load settings'))
  }, [])

  const toggle = async (key: string, enabled: boolean) => {
    setBusy(true)
    setError('')
    try {
      await adminRequest('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({ key, enabled }) })
      await loadFlags()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save settings') }
    finally { setBusy(false) }
  }

  const add = async () => {
    if (!newKey.trim()) return
    setBusy(true)
    setError('')
    try {
      await adminRequest('/api/admin/settings', { method: 'POST', body: JSON.stringify({ key: newKey.trim(), enabled: false }) })
      await loadFlags()
      setNewKey('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save settings') }
    finally { setBusy(false) }
  }

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold">Settings</h1>
      {error && <div role="alert" className="mt-2 text-destructive">{error}</div>}
      <div className="mt-4 border rounded-md p-3">
        <div className="flex gap-2">
          <input value={newKey} onChange={(e)=>setNewKey(e.target.value)} maxLength={100} disabled={busy} className="border border-input bg-background text-foreground rounded-md p-2" placeholder="New flag key" />
          <button onClick={add} disabled={busy} className="px-3 py-1 rounded-md bg-blue-600 text-white">Add</button>
        </div>
        <div className="mt-4">
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th className="p-2">Key</th><th className="p-2">Enabled</th></tr></thead>
            <tbody>
              {flags.map(f => (
                <tr key={f.key} className="border-t">
                  <td className="p-2">{f.key}</td>
                  <td className="p-2">
                    <input type="checkbox" disabled={busy} checked={!!f.enabled} onChange={(e)=>toggle(f.key, e.target.checked)} />
                  </td>
                </tr>
              ))}
              {flags.length===0 && (<tr><td className="p-2" colSpan={2}>No flags</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
