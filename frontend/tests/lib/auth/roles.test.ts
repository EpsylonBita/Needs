import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { requireAdmin, updateUserRole } from '@/lib/auth/role-based-admin'

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), getUserById: vi.fn(), updateUserById: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: { auth: {
  getUser: mocks.getUser, admin: { getUserById: mocks.getUserById, updateUserById: mocks.updateUserById },
} } }))
const req = () => new NextRequest('http://localhost/api/admin/check', { headers: { Authorization: 'Bearer token' } })
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('ADMIN_EMAILS', '')
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user', email: 'user@example.test' } }, error: null })
})
describe('administrator authority', () => {
  it('rejects an administrator role the user put in editable metadata', async () => {
    mocks.getUserById.mockResolvedValue({ data: { user: { user_metadata: { role: 'super_admin' } } }, error: null })
    expect((await requireAdmin(req())).allowed).toBe(false)
  })
  it('accepts a role assigned through server-controlled app metadata', async () => {
    mocks.getUserById.mockResolvedValue({ data: { user: { app_metadata: { role: 'admin' } } }, error: null })
    expect((await requireAdmin(req())).allowed).toBe(true)
  })
  it('persists role changes in app metadata only', async () => {
    mocks.getUserById.mockResolvedValue({ data: { user: { app_metadata: { role: 'super_admin' } } }, error: null })
    mocks.updateUserById.mockResolvedValue({ data: { user: { id: 'target' } }, error: null })
    await updateUserRole('target', 'admin', 'operator')
    expect(mocks.updateUserById).toHaveBeenCalledWith('target', { app_metadata: { role: 'admin' } })
  })
})
