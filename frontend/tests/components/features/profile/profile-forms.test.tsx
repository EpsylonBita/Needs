import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ locale: 'en', userId: 'member', update: vi.fn(), upload: vi.fn(), toast: vi.fn(), success: vi.fn(), push: vi.fn() }))
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ locale: state.locale }) }))
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: { id: state.userId } }) }))
vi.mock('@/lib/services/profile-service', () => ({ profileService: { updateProfile: state.update, uploadPhoto: state.upload } }))
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: state.toast }) }))
vi.mock('sonner', () => ({ toast: { success: state.success, error: vi.fn() } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }))
// eslint-disable-next-line @next/next/no-img-element -- Use a deterministic image element in the Next Image mock.
vi.mock('next/image', () => ({ default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }))

import { EditProfileDialog } from '@/components/features/profile/edit-profile-dialog'
import { UploadPhotoDialog } from '@/components/features/profile/upload-photo-dialog'

const profile = { fullName: 'New member', email: 'member@example.com', title: null, location: null, bio: null, avatar: null }
beforeEach(() => {
  vi.resetAllMocks()
  state.locale = 'en'
  state.userId = 'member'
  state.update.mockResolvedValue({ ...profile, fullName: 'Changed name' })
  state.upload.mockResolvedValue({ url: 'https://example.com/photo.png' })
})
afterEach(cleanup)

describe('profile editing', () => {
  it('does not save an open form into a different account after switching', async () => {
    const view = render(<EditProfileDialog defaultValues={profile} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }))
    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'First account changes' } })
    state.userId = 'second-member'
    view.rerender(<EditProfileDialog defaultValues={{ ...profile, fullName: 'Second member' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Your account changed')
    expect(state.update).not.toHaveBeenCalled()
  })

  it('does not refresh another account or announce success from an older pending save', async () => {
    let finish!: (value: unknown) => void
    state.update.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const refresh = vi.fn()
    const view = render(<EditProfileDialog defaultValues={profile} onUpdate={refresh} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(state.update).toHaveBeenCalled())
    state.userId = 'second-member'
    view.rerender(<EditProfileDialog defaultValues={{ ...profile, fullName: 'Second member' }} onUpdate={refresh} />)
    await act(async () => finish({ ...profile, userId: 'member' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Your account changed')
    expect(refresh).not.toHaveBeenCalled()
    expect(state.toast).not.toHaveBeenCalled()
  })

  it('saves a new member name while optional fields are empty', async () => {
    render(<EditProfileDialog defaultValues={profile} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }))
    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Changed name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(state.update).toHaveBeenCalledWith(expect.objectContaining({ fullName: 'Changed name', title: '', location: '', bio: '' }), 'member'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(state.toast).toHaveBeenCalledTimes(1)
  })

  it('does not announce an older save after the account changes during profile refresh', async () => {
    let finish!: () => void
    const refresh = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const view = render(<EditProfileDialog defaultValues={profile} onUpdate={refresh} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    state.userId = 'second-member'
    view.rerender(<EditProfileDialog defaultValues={{ ...profile, fullName: 'Second member' }} onUpdate={refresh} />)
    await act(async () => finish())
    expect(await screen.findByRole('alert')).toHaveTextContent('Your account changed')
    expect(state.toast).not.toHaveBeenCalled()
  })

  it('keeps the form and entered values when profile persistence rejects', async () => {
    state.update.mockRejectedValue(new Error('Database unavailable'))
    render(<EditProfileDialog defaultValues={{ ...profile, title: 'Teacher', location: 'Athens', bio: 'A short biography.' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }))
    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Changed name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable')
    expect(screen.getByLabelText('Full Name')).toHaveValue('Changed name')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(state.toast).not.toHaveBeenCalled()
  })

  it.each([
    ['Full Name', '   '], ['Full Name', 'n'.repeat(101)], ['Email', 'invalid'],
    ['Professional Title', 't'.repeat(101)], ['Location', 'l'.repeat(161)], ['Bio', 'b'.repeat(1001)],
  ])('rejects an invalid or oversized %s before persistence', async (field, value) => {
    render(<EditProfileDialog defaultValues={profile} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }))
    fireEvent.change(screen.getByLabelText(new RegExp(`^${field}`)), { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(state.update).not.toHaveBeenCalled()
  })

  it('uses Greek labels and explains pending confirmation after an email change', async () => {
    state.locale = 'el'
    state.update.mockResolvedValue({ ...profile, emailChangePending: true })
    render(<EditProfileDialog defaultValues={profile} />)
    fireEvent.click(screen.getByRole('button', { name: 'Επεξεργασία προφίλ' }))
    expect(screen.getByLabelText('Ονοματεπώνυμο')).toBeRequired()
    expect(screen.getByLabelText(/Επαγγελματικός τίτλος/)).not.toBeRequired()
    expect(screen.getByRole('button', { name: 'Κλείσιμο' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Αποθήκευση αλλαγών' }))
    await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Το προφίλ αποθηκεύτηκε. Έλεγξε το email σου για να επιβεβαιώσεις τη νέα διεύθυνση.' })))
  })

  it('preserves the partial-save explanation when only the email update fails', async () => {
    state.locale = 'el'
    state.update.mockRejectedValue(new Error('Profile saved, but the email change failed: provider unavailable'))
    render(<EditProfileDialog defaultValues={profile} />)
    fireEvent.click(screen.getByRole('button', { name: 'Επεξεργασία προφίλ' }))
    fireEvent.click(screen.getByRole('button', { name: 'Αποθήκευση αλλαγών' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Το προφίλ αποθηκεύτηκε, αλλά η αλλαγή email απέτυχε')
    expect(state.toast).not.toHaveBeenCalled()
  })
})

describe('profile photo persistence', () => {
  it('never invokes the profile callback after an upload finishes for a previous account', async () => {
    let finish!: (value: unknown) => void
    state.upload.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const persist = vi.fn()
    const close = vi.fn()
    const view = render(<UploadPhotoDialog open onOpenChange={close} onUpload={persist} type="avatar" />)
    fireEvent.change(screen.getByLabelText('Upload profile photo'), { target: { files: [new File(['image'], 'photo.png', { type: 'image/png' })] } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(state.upload).toHaveBeenCalled())
    state.userId = 'second-member'
    view.rerender(<UploadPhotoDialog open onOpenChange={close} onUpload={persist} type="avatar" />)
    await act(async () => finish({ url: 'https://example.com/first-account.png' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Your account changed')
    expect(persist).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })

  it('waits for the profile save before closing and leaves success feedback to its owner', async () => {
    let finish!: () => void
    const persist = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const close = vi.fn()
    render(<UploadPhotoDialog open onOpenChange={close} onUpload={persist} type="avatar" />)
    fireEvent.change(screen.getByLabelText('Upload profile photo'), { target: { files: [new File(['image'], 'photo.png', { type: 'image/png' })] } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(persist).toHaveBeenCalledWith('https://example.com/photo.png'))
    expect(close).not.toHaveBeenCalled()
    expect(state.success).not.toHaveBeenCalled()
    await act(async () => finish())
    expect(close).toHaveBeenCalledWith(false)
    expect(state.success).not.toHaveBeenCalled()
  })

  it('keeps a failed profile save open and retries the saved upload without uploading twice', async () => {
    const persist = vi.fn().mockRejectedValueOnce(new Error('Database unavailable')).mockResolvedValueOnce(undefined)
    const close = vi.fn()
    render(<UploadPhotoDialog open onOpenChange={close} onUpload={persist} type="avatar" />)
    const file = new File(['image'], 'photo.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Upload profile photo'), { target: { files: [file] } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable')
    expect(close).not.toHaveBeenCalled()
    expect(state.success).not.toHaveBeenCalled()
    expect(state.upload).toHaveBeenCalledWith(file, 'avatar', 'member')
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(close).toHaveBeenCalledWith(false))
    expect(state.upload).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledTimes(2)
  })

  it('shows storage errors in Greek without invoking profile persistence', async () => {
    state.locale = 'el'
    state.upload.mockRejectedValue(new Error('Storage unavailable'))
    const persist = vi.fn()
    const close = vi.fn()
    render(<UploadPhotoDialog open onOpenChange={close} onUpload={persist} type="cover" />)
    fireEvent.change(screen.getByLabelText('Ανέβασμα εικόνας εξωφύλλου'), { target: { files: [new File(['image'], 'cover.png', { type: 'image/png' })] } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Αποθήκευση αλλαγών' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Αποθήκευση αλλαγών' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Δεν ήταν δυνατή η αποθήκευση της φωτογραφίας')
    expect(persist).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })

  it('rejects non-images and oversized files before any upload', async () => {
    render(<UploadPhotoDialog open onOpenChange={vi.fn()} onUpload={vi.fn()} type="avatar" />)
    const input = screen.getByLabelText('Upload profile photo')
    fireEvent.change(input, { target: { files: [new File(['text'], 'text.txt', { type: 'text/plain' })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('up to 5 MB')
    const large = new File(['image'], 'large.png', { type: 'image/png' })
    Object.defineProperty(large, 'size', { value: 5 * 1024 * 1024 + 1 })
    fireEvent.change(input, { target: { files: [large] } })
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
    expect(state.upload).not.toHaveBeenCalled()
  })

  it.each(['image/svg+xml', 'image/heic'])('rejects unsupported %s in both photo selectors', async mime => {
    const view = render(<UploadPhotoDialog open onOpenChange={vi.fn()} onUpload={vi.fn()} type="cover" />)
    fireEvent.change(screen.getByLabelText('Upload cover photo'), { target: { files: [new File(['image'], 'photo', { type: mime })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('JPG, PNG, WebP or GIF')
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
    expect(state.upload).not.toHaveBeenCalled()
    view.unmount()
    render(<EditProfileDialog defaultValues={profile} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }))
    fireEvent.change(screen.getByLabelText('Upload profile photo'), { target: { files: [new File(['image'], 'photo', { type: mime })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('JPG, PNG, WebP or GIF')
    expect(state.update).not.toHaveBeenCalled()
  })
})
