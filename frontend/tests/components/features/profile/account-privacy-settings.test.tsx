import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AccountPrivacySettings } from '@/components/features/profile/account-privacy-settings'
import { AccountPrivacyError } from '@/lib/services/account-privacy-service'

const context = vi.hoisted(() => ({ user: { id: 'owner-id' } as { id: string } | null, locale: 'en', status: vi.fn(), request: vi.fn(), cancel: vi.fn(), export: vi.fn(), confirm: vi.fn() }))
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: context.user }) }))
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ locale: context.locale }) }))
vi.mock('@/lib/services/account-privacy-service', () => ({
  AccountPrivacyError: class AccountPrivacyError extends Error { constructor(public code: string, message: string) { super(message) } },
  getAccountPrivacyStatus: context.status, requestAccountDeletion: context.request,
  cancelAccountDeletion: context.cancel, exportAccountData: context.export, confirmAccountPassword: context.confirm,
}))
const empty = { request: null, blockers: { active_orders: 0, open_disputes: 0, pending_refunds: 0, active_milestones: 0, financial_history: false } }
const pending = { ...empty, request: { id: 'request-id', status: 'pending', created_at: '2026-10-26', updated_at: '2026-10-26', reviewed_at: null, response: null }, blockers: { ...empty.blockers, active_orders: 1, open_disputes: 1, financial_history: true } }
beforeEach(() => {
  vi.clearAllMocks()
  context.user = { id: 'owner-id' }; context.locale = 'en'
  context.status.mockResolvedValue(empty); context.request.mockResolvedValue(pending)
  context.cancel.mockResolvedValue({ ...pending, request: { ...pending.request, status: 'cancelled' } })
  context.confirm.mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe('account privacy settings', () => {
  it('requires explicit confirmation and reports a saved request without implying deletion', async () => {
    render(<AccountPrivacySettings />)
    const submit = await screen.findByRole('button', { name: 'Submit deletion request' })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Type DELETE to request deletion'), { target: { value: 'DELETE' } })
    fireEvent.click(submit)
    expect(await screen.findByText('Your request was saved. Your account has not been deleted.')).toBeVisible()
    expect(context.request).toHaveBeenCalledWith('owner-id')
    expect(screen.getByText('Awaiting review')).toBeVisible()
    expect(screen.getByText('Orders: 1 · Disputes: 1 · Refunds: 0 · Milestones: 0')).toBeVisible()
    expect(screen.getByText(/Financial history needs a retention review/)).toBeVisible()
  })
  it('cancels only the current request and displays the saved administrator response', async () => {
    context.status.mockResolvedValue({ ...pending, request: { ...pending.request, status: 'needs_information', response: 'Please resolve the open order before review.' } })
    render(<AccountPrivacySettings />)
    expect(await screen.findByText('Please resolve the open order before review.')).toBeVisible()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel request' }))
    expect(context.cancel).toHaveBeenCalledWith('owner-id', 'request-id')
    expect(await screen.findByText('Your request was cancelled.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Submit deletion request' })).toBeDisabled()
  })
  it('keeps the request unsaved after a failed mutation', async () => {
    context.request.mockRejectedValue(new Error('Could not save your request.'))
    render(<AccountPrivacySettings />)
    fireEvent.change(await screen.findByLabelText('Type DELETE to request deletion'), { target: { value: 'DELETE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit deletion request' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save your request.')
    expect(screen.queryByText('Awaiting review')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit deletion request' })).toBeEnabled()
  })
  it('requires a current password when the server requires recent authentication and retries the selected action', async () => {
    context.request.mockRejectedValueOnce(new AccountPrivacyError('REAUTH_REQUIRED', 'Sign in again')).mockResolvedValueOnce(pending)
    render(<AccountPrivacySettings />)
    fireEvent.change(await screen.findByLabelText('Type DELETE to request deletion'), { target: { value: 'DELETE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit deletion request' }))
    const password = await screen.findByLabelText('Current password')
    expect(screen.getByRole('button', { name: 'Confirm and continue' })).toBeDisabled()
    fireEvent.change(password, { target: { value: 'current-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    expect(await screen.findByText('Your request was saved. Your account has not been deleted.')).toBeVisible()
    expect(context.confirm).toHaveBeenCalledWith('owner-id', 'current-password')
    expect(context.request).toHaveBeenCalledTimes(2)
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument()
  })
  it('ignores private results after an account switch', async () => {
    let resolveExport!: (value: object) => void
    context.export.mockImplementation(() => new Promise(resolve => { resolveExport = resolve }))
    const { rerender } = render(<AccountPrivacySettings />)
    await screen.findByLabelText('Type DELETE to request deletion')
    fireEvent.click(screen.getByRole('button', { name: 'Download JSON' }))
    await waitFor(() => expect(context.export).toHaveBeenCalledWith('owner-id'))
    context.user = { id: 'another-account' }; rerender(<AccountPrivacySettings />)
    await act(async () => resolveExport({ private: 'old account data' }))
    expect(screen.queryByText('Your data file is ready to download.')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
