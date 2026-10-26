'use client'

import { usePathname } from 'next/navigation'
import { ProtectedRoute } from './protected-route'

export function DashboardGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return <ProtectedRoute redirectTo={`/login?redirectTo=${encodeURIComponent(pathname)}`}>{children}</ProtectedRoute>
}
