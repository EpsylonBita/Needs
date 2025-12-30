"use client";

import { useEffect, useState } from 'react'
 
import { supabase } from '@/lib/supabase/client'

interface StatusData {
  envStatus: {
    stripe: boolean;
    webhook: boolean;
    supabase: boolean;
    paymentsEnabled: boolean;
  };
  webhooks: Array<{
    id: string;
    created_at: string;
    event_type?: string;
    status?: string;
  }>;
  timestamp: string;
}

export default function AdminStatusPage() {
  const [status, setStatus] = useState<StatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        setLoading(true)
        setError(null)

        // Get the current session for authentication
        const { data: { session } } = await supabase.auth.getSession()
        
        if (!session) {
          setError('Not authenticated')
          return
        }

        // Fetch status from secure API endpoint
        const response = await fetch('/api/admin/status', {
          headers: {
            'Authorization': `Bearer ${session.access_token}`
          }
        })

        if (!response.ok) {
          throw new Error(`Failed to fetch status: ${response.statusText}`)
        }

        const data = await response.json()
        setStatus(data)
      } catch (err) {
        console.error('Error fetching admin status:', err)
        setError(err instanceof Error ? err.message : 'Failed to fetch status')
      } finally {
        setLoading(false)
      }
    }

    fetchStatus()

    // Set up real-time webhook updates
    const channel = supabase
      .channel('admin-status-webhooks')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'webhook_events' 
      }, fetchStatus)
      .subscribe()

    return () => { 
      supabase.removeChannel(channel) 
    }
  }, [])

  if (loading) {
    return (
      <div className="container mx-auto p-4">
        <h1 className="text-2xl font-bold">Status</h1>
        <div className="mt-4">Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container mx-auto p-4">
        <h1 className="text-2xl font-bold">Status</h1>
        <div className="mt-4 text-red-500">Error: {error}</div>
      </div>
    )
  }

  if (!status) {
    return (
      <div className="container mx-auto p-4">
        <h1 className="text-2xl font-bold">Status</h1>
        <div className="mt-4">No status data available</div>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold">Status</h1>
      <div className="mt-4 grid gap-4 md:grid-cols-4">
        <div className={`border rounded-md p-4 ${status.envStatus.stripe ? 'border-green-400' : 'border-red-400'}`}>
          <div className="text-sm">Stripe Keys</div>
          <div className="text-xl font-bold">{status.envStatus.stripe ? 'OK' : 'Missing'}</div>
        </div>
        <div className={`border rounded-md p-4 ${status.envStatus.webhook ? 'border-green-400' : 'border-red-400'}`}>
          <div className="text-sm">Webhook Secret</div>
          <div className="text-xl font-bold">{status.envStatus.webhook ? 'OK' : 'Missing'}</div>
        </div>
        <div className={`border rounded-md p-4 ${status.envStatus.supabase ? 'border-green-400' : 'border-red-400'}`}>
          <div className="text-sm">Supabase Client</div>
          <div className="text-xl font-bold">{status.envStatus.supabase ? 'OK' : 'Missing'}</div>
        </div>
        <div className={`border rounded-md p-4 ${status.envStatus.paymentsEnabled ? 'border-green-400' : 'border-red-400'}`}>
          <div className="text-sm">Payments Enabled</div>
          <div className="text-xl font-bold">{status.envStatus.paymentsEnabled ? 'Yes' : 'No'}</div>
        </div>
      </div>
      <div className="mt-6 border rounded-md">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="p-2">Event ID</th>
              <th className="p-2">When</th>
              <th className="p-2">Type</th>
              <th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {status.webhooks.map(w => (
              <tr key={w.id} className="border-t">
                <td className="p-2">{w.id}</td>
                <td className="p-2">{new Date(w.created_at).toLocaleString()}</td>
                <td className="p-2">{w.event_type || 'N/A'}</td>
                <td className="p-2">{w.status || 'N/A'}</td>
              </tr>
            ))}
            {status.webhooks.length === 0 && (
              <tr>
                <td className="p-2" colSpan={4}>No events</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-4 text-xs text-muted-foreground">
        Last updated: {new Date(status.timestamp).toLocaleString()}
      </div>
    </div>
  )
}
