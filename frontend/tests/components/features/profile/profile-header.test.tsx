import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  loading: false, locale: 'en', update: vi.fn(), refresh: vi.fn(), upload: vi.fn(), toast: vi.fn(), edit: vi.fn(),
  profile: {
    id: 'public-profile-id', userId: 'auth-account-id', fullName: 'Maria Member', email: 'member@example.com',
    title: 'Teacher', location: 'Athens', bio: 'A local member.', avatar: null, coverImage: null, createdAt: '2026-10-01T12:00:00Z',
  },
}))
vi.mock('@/contexts/profile-context', () => ({ useProfile: () => ({ profile: state.profile, isLoading: state.loading, updateProfile: state.update, refreshProfile: state.refresh }) }))
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: { id: 'auth-account-id' } }) }))
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ locale: state.locale }) }))
vi.mock('@/lib/services/profile-service', () => ({ profileService: { uploadPhoto: state.upload } }))
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: state.toast }) }))
vi.mock('@/components/features/profile/edit-profile-dialog', () => ({
  EditProfileDialog: ({ defaultValues }: { defaultValues: { id: string } }) => <button onClick={() => state.edit(defaultValues)}>Edit profile</button>,
}))
// eslint-disable-next-line @next/next/no-img-element -- Isolate Next image loading, not the photo form or header persistence.
vi.mock('next/image', () => ({ default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }))

import { ProfileHeader } from '@/components/features/profile/profile-header'

beforeEach(() => {
  vi.clearAllMocks(); state.loading = false; state.locale = 'en'
  state.update.mockReset().mockResolvedValue(undefined)
  state.upload.mockReset().mockResolvedValue({ url: 'https://example.invalid/photo.png' })
})
afterEach(cleanup)

async function selectImage(label: string) {
  const file = new File(['image'], 'photo.png', { type: 'image/png' })
  fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled())
  return file
}

describe('profile header integration', () => {
  it('exposes editing and both photo controls, and links to the profile ID rather than the auth account ID', () => {
    render(<ProfileHeader />)
    expect(screen.getByRole('heading', { name: 'Maria Member' })).toBeInTheDocument()
    expect(screen.getByText('Teacher')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View public profile' })).toHaveAttribute('href', '/profile/public-profile-id')
    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }))
    expect(state.edit).toHaveBeenCalledWith(expect.objectContaining({ id: 'public-profile-id', userId: 'auth-account-id' }))
    expect(screen.getAllByRole('button', { name: 'Change profile photo' })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Add cover photo' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Upload cover photo')).toBeInTheDocument()
  })

  it('keeps an avatar upload mounted while the profile saves, surfaces rejection, and closes only after a successful retry', async () => {
    let reject!: (error: Error) => void
    state.update.mockImplementationOnce(() => { state.loading = true; return new Promise<void>((_resolve, fail) => { reject = fail }) })
    const view = render(<ProfileHeader />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Change profile photo' })[1])
    const file = await selectImage('Upload profile photo')
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(state.update).toHaveBeenCalledWith({ avatar: 'https://example.invalid/photo.png' }))
    view.rerender(<ProfileHeader />)
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(screen.getByLabelText('Upload profile photo')).toBeDisabled()
    expect(state.upload).toHaveBeenCalledWith(file, 'avatar', 'auth-account-id')
    await act(async () => { state.loading = false; reject(new Error('Database unavailable')) })
    view.rerender(<ProfileHeader />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable')
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(state.upload).toHaveBeenCalledTimes(1)
    expect(state.update).toHaveBeenCalledTimes(2)
  })

  it('persists the cover field and awaits completion without unmounting its open dialog during loading', async () => {
    let finish!: () => void
    state.update.mockImplementationOnce(() => { state.loading = true; return new Promise<void>(resolve => { finish = resolve }) })
    const view = render(<ProfileHeader />)
    fireEvent.click(screen.getByRole('button', { name: 'Add cover photo' }))
    const file = await selectImage('Upload cover photo')
    const dialog = screen.getByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(state.update).toHaveBeenCalledWith({ coverImage: 'https://example.invalid/photo.png' }))
    view.rerender(<ProfileHeader />)
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(screen.getByLabelText('Upload cover photo')).toBeDisabled()
    expect(state.upload).toHaveBeenCalledWith(file, 'cover', 'auth-account-id')
    await act(async () => { state.loading = false; finish() })
    view.rerender(<ProfileHeader />)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
