import { StrictMode } from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ complete: vi.fn(), reset: vi.fn(), request: vi.fn(), resend: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: { id: 'user-one' } }) }));
vi.mock('@/lib/services/auth-email-service', () => ({ completeAuthEmailLink: mocks.complete, completePasswordReset: mocks.reset, requestPasswordReset: mocks.request, resendConfirmation: mocks.resend }));

import { AuthEmailPanel, AuthEmailRequestForm } from '@/components/auth/auth-email-panel';
import { savePendingPublication } from '@/lib/listings/publication-intent';

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  window.history.replaceState({}, '', '/auth/reset-password#access_token=temporary&refresh_token=temporary&type=recovery');
  mocks.complete.mockResolvedValue({ type: 'recovery', status: 'confirmed', recovery: { userId: 'user-one', expiresAt: Date.now() + 60000 } });
  mocks.reset.mockResolvedValue(undefined);
  mocks.request.mockResolvedValue(undefined);
  mocks.resend.mockResolvedValue(undefined);
});

describe('auth email pages', () => {
  it('offers the original publication action after verification, without publishing automatically', async () => {
    savePendingPublication({ intent: 'request', query: 'guitar', returnTo: '/search?q=guitar&distance=10' });
    mocks.complete.mockResolvedValue({ type: 'signup', status: 'confirmed' });
    render(<AuthEmailPanel mode="confirm" />);
    const continueAction = await screen.findByRole('link', { name: 'Continue where you left off' });
    expect(continueAction).toHaveAttribute('href', '/search?q=guitar&distance=10&resumeListing=1');
    expect(screen.queryByRole('button', { name: 'Publish listing' })).not.toBeInTheDocument();
  });
  it('consumes a one-time link once under StrictMode and removes callback credentials', async () => {
    render(<StrictMode><AuthEmailPanel mode="reset" /></StrictMode>);
    await screen.findByLabelText('New password');
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('');
  });

  it('offers a new link for expired recovery without rendering a password form', async () => {
    mocks.complete.mockRejectedValue(new Error('expired'));
    render(<AuthEmailPanel mode="reset" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or has expired');
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new email' })).toHaveAttribute('href', '/auth/forgot-password');
    expect(mocks.reset).not.toHaveBeenCalled();
  });

  it('validates password confirmation and shows success only after the update succeeds', async () => {
    render(<AuthEmailPanel mode="reset" />);
    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'NewPassword!1' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'DifferentPassword!1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match');
    expect(mocks.reset).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'NewPassword!1' } });
    mocks.reset.mockRejectedValueOnce(new Error('Password must be different'));
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('must be different');
    expect(screen.queryByText('Your password has been updated.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));
    await screen.findByText('Your password has been updated.');
  });

  it('shows second-address instructions for a pending secure email change', async () => {
    mocks.complete.mockResolvedValue({ type: 'email_change', status: 'pending' });
    render(<AuthEmailPanel mode="confirm" />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('both addresses'));
    expect(screen.queryByText('Your email has been confirmed.')).not.toBeInTheDocument();
  });

  it('requests reset email without claiming that an account exists and throttles repeat requests', async () => {
    render(<AuthEmailRequestForm mode="forgot" initialEmail="member@example.com" />);
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('status')).toHaveTextContent('If an account exists');
    expect(mocks.request).toHaveBeenCalledWith('member@example.com');
    expect(screen.getByRole('button', { name: /Try again in/ })).toBeDisabled();
  });

  it('reports resend provider failures and allows a retry', async () => {
    mocks.resend.mockRejectedValueOnce(new Error('Email service unavailable'));
    render(<AuthEmailRequestForm mode="resend" initialEmail="member@example.com" />);
    fireEvent.click(screen.getByRole('button', { name: 'Resend confirmation email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email service unavailable');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resend confirmation email' })).toBeEnabled());
  });
});
