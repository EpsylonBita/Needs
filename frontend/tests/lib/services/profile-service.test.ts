import { beforeEach, describe, expect, it, vi } from 'vitest'

const boundary = vi.hoisted(() => ({
  user: { id: 'user-1', email: 'old@example.com', user_metadata: { fullName: 'Original' } },
  reads: [] as Array<{ data: unknown; error: unknown }>,
  writes: [] as Array<{ operation: string; data: Record<string, unknown> }>,
  writeError: null as unknown,
  updateUser: vi.fn(), getUser: vi.fn(), upload: vi.fn(), afterRead: null as null | (() => Promise<void>),
}))
const record = { id: 'profile-1', user_id: 'user-1', display_name: 'Saved name', bio: 'Existing biography', reputation: 0, rating_count: 0, created_at: '2026-01-01' }

vi.mock('@/lib/supabase/client', () => ({ supabase: {
  auth: { getUser: boundary.getUser, updateUser: boundary.updateUser },
  storage: { from: () => ({ upload: boundary.upload, getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.example/${path}` } }) }) },
  from: () => {
    let operation = 'select'
    let payload: Record<string, unknown> = {}
    const result = () => operation === 'select'
      ? (boundary.reads.shift() || { data: null, error: null })
      : { data: boundary.writeError ? null : { id: 'profile-1', user_id: 'user-1', ...payload }, error: boundary.writeError }
    const write = (kind: string, data: Record<string, unknown>) => { operation = kind; payload = data; boundary.writes.push({ operation, data }); return query }
    const query: any = {
      select: () => query, eq: () => query, order: () => query, limit: () => query,
      insert: (data: Record<string, unknown>) => write('insert', data),
      upsert: (data: Record<string, unknown>) => write('upsert', data),
      update: (data: Record<string, unknown>) => write('update', data),
      maybeSingle: async () => { const response = result(); await boundary.afterRead?.(); return response }, single: async () => result(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    }
    return query
  },
} }))

import { profileService } from '@/lib/services/profile-service'

beforeEach(() => {
  boundary.user = { id: 'user-1', email: 'old@example.com', user_metadata: { fullName: 'Original' } }
  boundary.reads = [{ data: record, error: null }]
  boundary.writes = []
  boundary.writeError = null
  boundary.afterRead = null
  boundary.getUser.mockReset().mockImplementation(async () => ({ data: { user: boundary.user }, error: null }))
  boundary.upload.mockReset().mockResolvedValue({ error: null })
  boundary.updateUser.mockReset().mockResolvedValue({ data: { user: boundary.user }, error: null })
})

describe('profile persistence', () => {
  it('does not overwrite a profile when its lookup fails', async () => {
    boundary.reads = [{ data: null, error: { message: 'database unavailable' } }]
    await expect(profileService.getProfile()).rejects.toThrow('database unavailable')
    expect(boundary.writes).toEqual([])
  })

  it('creates an absent profile without an upsert that could overwrite a concurrent save', async () => {
    boundary.reads = [{ data: null, error: null }]
    await profileService.getProfile()
    expect(boundary.writes).toEqual([{ operation: 'insert', data: { user_id: 'user-1', display_name: 'Original' } }])
  })

  it('rereads the existing profile if another request creates it first', async () => {
    boundary.reads = [{ data: null, error: null }, { data: record, error: null }]
    boundary.writeError = { code: '23505', message: 'duplicate profile' }
    const result = await profileService.getProfile()
    expect(result.bio).toBe('Existing biography')
    expect(boundary.writes[0].operation).toBe('insert')
  })

  it('requests an auth email change and reports pending confirmation without showing it as verified', async () => {
    const result = await profileService.updateProfile({ email: 'new@example.com', fullName: 'New name' })
    expect(boundary.updateUser).toHaveBeenCalledWith({ email: 'new@example.com' }, { emailRedirectTo: `${window.location.origin}/auth/confirm` })
    expect(result.email).toBe('old@example.com')
    expect(result).toMatchObject({ fullName: 'New name', emailChangePending: true })
    expect(boundary.writes[0].data).not.toHaveProperty('email')
  })

  it('surfaces auth email update rejection instead of reporting success', async () => {
    boundary.updateUser.mockResolvedValue({ data: { user: null }, error: { message: 'Email unavailable' } })
    await expect(profileService.updateProfile({ email: 'taken@example.com' })).rejects.toThrow('Email unavailable')
  })

  it('does not request email change when the address has not changed', async () => {
    await profileService.updateProfile({ email: 'old@example.com', fullName: 'Saved name' })
    expect(boundary.updateUser).not.toHaveBeenCalled()
  })

  it('does not send an email change if profile lookup fails', async () => {
    boundary.reads = [{ data: null, error: { message: 'lookup failed' } }]
    await expect(profileService.updateProfile({ email: 'new@example.com' })).rejects.toThrow('lookup failed')
    expect(boundary.updateUser).not.toHaveBeenCalled()
    expect(boundary.writes).toEqual([])
  })

  it('rejects an expected account mismatch before any profile, email or storage write', async () => {
    await expect(profileService.updateProfile({ fullName: 'Wrong name', email: 'wrong@example.com' }, 'another-user')).rejects.toThrow('session changed')
    await expect(profileService.uploadPhoto(new File(['image'], 'photo.png', { type: 'image/png' }), 'avatar', 'another-user')).rejects.toThrow('session changed')
    expect(boundary.writes).toEqual([])
    expect(boundary.upload).not.toHaveBeenCalled()
    expect(boundary.updateUser).not.toHaveBeenCalled()
  })

  it('does not start an upload or profile write after the account changes during lookup', async () => {
    boundary.afterRead = async () => { boundary.user = { ...boundary.user, id: 'user-2' } }
    await expect(profileService.updateProfile({ avatar: new File(['image'], 'photo.png', { type: 'image/png' }), fullName: 'Changed' }, 'user-1')).rejects.toThrow('session changed')
    expect(boundary.upload).not.toHaveBeenCalled()
    expect(boundary.writes).toEqual([])
  })

  it('does not persist a delayed uploaded image or email change into the next account', async () => {
    let finishUpload!: (value: unknown) => void
    boundary.upload.mockReturnValue(new Promise(resolve => { finishUpload = resolve }))
    const save = profileService.updateProfile({ avatar: new File(['image'], 'photo.png', { type: 'image/png' }), email: 'new@example.com' }, 'user-1')
    const rejected = expect(save).rejects.toThrow('session changed')
    await vi.waitFor(() => expect(boundary.upload).toHaveBeenCalled())
    expect(boundary.upload.mock.calls[0][0]).toMatch(/^user-1\/avatar\//)
    boundary.user = { ...boundary.user, id: 'user-2' }
    finishUpload({ error: null })
    await rejected
    expect(boundary.writes).toEqual([])
    expect(boundary.updateUser).not.toHaveBeenCalled()
  })
})
