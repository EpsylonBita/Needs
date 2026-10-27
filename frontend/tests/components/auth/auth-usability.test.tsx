import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ login: vi.fn(), register: vi.fn(), close: vi.fn(), authenticated: vi.fn(), toast: vi.fn(), locale: 'en' }));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('next/dynamic', () => ({ default: () => function ListingDialog({ open }: { open: boolean }) { return open ? <div role="dialog" aria-label="Create a listing" /> : null; } }));
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ login: mocks.login, register: mocks.register }) }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/contexts/i18n-context', async () => {
  const { authContactMessages } = await import('@/locales/auth-contact-el');
  return { useI18n: () => ({ locale: mocks.locale, t: (key: string, fallback?: string) => mocks.locale === 'el' ? authContactMessages[key as keyof typeof authContactMessages] ?? fallback ?? key : fallback ?? key }) };
});

import { AuthDialog } from '@/components/auth/auth-dialog';
import { RegisterForm } from '@/components/auth/register-form';
import { NewListingButton } from '@/components/features/ads/new-listing-button';

beforeEach(() => { vi.resetAllMocks(); mocks.locale = 'en'; });

function fillRegistration() {
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Maria Test' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'maria@example.com' } });
  fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '+30 699 123 4567' } });
  fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'GoodPassword!1' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'GoodPassword!1' } });
}

describe('accessible authentication forms', () => {
  it('uses one named dialog and keeps form controls outside its heading in both modes', async () => {
    render(<AuthDialog isOpen onClose={mocks.close} />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByRole('heading')).toHaveLength(1);
    expect(within(dialog).getByRole('heading').querySelector('form')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Need an account? Sign up' }));
    await screen.findByLabelText('Full name');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(dialog).getAllByRole('heading')).toHaveLength(1);
    expect(dialog.querySelectorAll('form')).toHaveLength(1);
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('Password', { exact: true })).toHaveAttribute('autocomplete', 'new-password');
  });

  it('links validation to the invalid field and focuses the first invalid input', async () => {
    render(<RegisterForm isOpen onClose={mocks.close} />);
    fireEvent.submit(screen.getByRole('button', { name: 'Create account' }).closest('form')!);
    const name = screen.getByLabelText('Full name');
    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'));
    expect(name).toHaveFocus();
    expect(name).toHaveAccessibleDescription(/at least 2/);
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it('reveals and hides the login password without changing its value or submitting', () => {
    render(<AuthDialog isOpen onClose={mocks.close} />);
    const password = screen.getByLabelText('Password', { exact: true });
    fireEvent.change(password, { target: { value: 'GoodPassword!1' } });
    const reveal = screen.getByRole('button', { name: 'Show password' });
    expect(reveal).toHaveAttribute('type', 'button');
    expect(reveal).toHaveAttribute('aria-pressed', 'false');
    expect(password).toHaveAttribute('type', 'password');

    fireEvent.click(reveal);
    const hide = screen.getByRole('button', { name: 'Hide password' });
    expect(hide).toHaveAttribute('aria-pressed', 'true');
    expect(password).toHaveAttribute('type', 'text');
    expect(password).toHaveValue('GoodPassword!1');
    expect(password).toHaveAttribute('autocomplete', 'current-password');

    fireEvent.click(hide);
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveValue('GoodPassword!1');
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveAttribute('aria-pressed', 'false');
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it('toggles signup password fields independently without changing values or submitting', () => {
    render(<AuthDialog isOpen initialMode="signup" onClose={mocks.close} />);
    const password = screen.getByLabelText('Password', { exact: true });
    const confirmation = screen.getByLabelText('Confirm password');
    fireEvent.change(password, { target: { value: 'GoodPassword!1' } });
    fireEvent.change(confirmation, { target: { value: 'GoodPassword!1' } });
    const reveal = screen.getByRole('button', { name: 'Show password' });
    const revealConfirmation = screen.getByRole('button', { name: 'Show password confirmation' });
    expect(reveal).toHaveAttribute('type', 'button');
    expect(revealConfirmation).toHaveAttribute('type', 'button');
    expect(revealConfirmation).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(reveal);
    expect(password).toHaveAttribute('type', 'text');
    expect(confirmation).toHaveAttribute('type', 'password');
    fireEvent.click(revealConfirmation);
    expect(confirmation).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password confirmation' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password');
    expect(confirmation).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide password confirmation' }));
    expect(confirmation).toHaveAttribute('type', 'password');
    expect(password).toHaveValue('GoodPassword!1');
    expect(confirmation).toHaveValue('GoodPassword!1');
    expect(password).toHaveAttribute('autocomplete', 'new-password');
    expect(confirmation).toHaveAttribute('autocomplete', 'new-password');
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it('locks password visibility during login and re-enables it after a failed request', async () => {
    let reject!: (reason: Error) => void;
    mocks.login.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    render(<AuthDialog isOpen onClose={mocks.close} />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'maria@example.com' } });
    const password = screen.getByLabelText('Password', { exact: true });
    fireEvent.change(password, { target: { value: 'GoodPassword!1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);
    await waitFor(() => expect(mocks.login).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeDisabled();
    expect(password).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    for (const name of ['Forgot password?', 'Resend confirmation']) {
      const link = screen.getByRole('link', { name });
      expect(link).toHaveAttribute('aria-disabled', 'true');
      expect(link).toHaveAttribute('tabindex', '-1');
      expect(fireEvent.click(link)).toBe(false);
    }

    reject(new Error('Invalid login credentials'));
    await screen.findByRole('alert');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Hide password' })).toBeEnabled());
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/auth/forgot-password');
    expect(screen.getByRole('link', { name: 'Resend confirmation' })).toHaveAttribute('href', '/auth/resend');
    expect(password).toHaveValue('GoodPassword!1');
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it('locks signup inputs while submitting and does not imply authentication before email confirmation', async () => {
    let finish!: (value: { requiresEmailConfirmation: boolean }) => void;
    mocks.register.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<AuthDialog isOpen initialMode="signup" onClose={mocks.close} onAuthenticated={mocks.authenticated} />);
    fillRegistration();
    fireEvent.submit(screen.getByRole('button', { name: 'Create account' }).closest('form')!);
    await waitFor(() => expect(mocks.register).toHaveBeenCalledTimes(1));
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ phoneNumber: '+306991234567' }));
    expect(screen.getByLabelText('Email')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Already have an account? Sign in' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Show password' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Show password confirmation' })).toBeDisabled();
    finish({ requiresEmailConfirmation: true });
    await waitFor(() => expect(mocks.close).toHaveBeenCalledTimes(1));
    expect(mocks.authenticated).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Check your email to confirm your account before signing in.' }));
  });

  it('shows Greek form labels, recovery links and validation together', async () => {
    mocks.locale = 'el';
    render(<AuthDialog isOpen onClose={mocks.close} />);
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Καλώς ήρθες ξανά');
    expect(screen.getByRole('link', { name: 'Ξέχασες τον κωδικό;' })).toHaveAttribute('href', '/auth/forgot-password');
    fireEvent.submit(screen.getByRole('button', { name: 'Σύνδεση' }).closest('form')!);
    expect(await screen.findByText('Συμπλήρωσε μια έγκυρη διεύθυνση email.')).toBeInTheDocument();
    expect(screen.getByLabelText('Κωδικός')).toHaveAccessibleDescription('Συμπλήρωσε τον κωδικό σου.');
  });

  it('keeps success feedback when signing in without an immediate continuation', async () => {
    mocks.login.mockResolvedValue(undefined);
    render(<AuthDialog isOpen onClose={mocks.close} />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'maria@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'GoodPassword!1' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);
    await waitFor(() => expect(mocks.close).toHaveBeenCalledTimes(1));
    expect(mocks.toast).toHaveBeenCalledWith({ title: 'Login successful', description: 'You have been logged in successfully.' });
  });

  it('continues an authenticated signup without covering the next workflow with a success toast', async () => {
    mocks.register.mockResolvedValue({ requiresEmailConfirmation: false });
    render(<AuthDialog isOpen initialMode="signup" onClose={mocks.close} onAuthenticated={mocks.authenticated} />);
    fillRegistration();
    fireEvent.submit(screen.getByRole('button', { name: 'Create account' }).closest('form')!);
    await waitFor(() => expect(mocks.authenticated).toHaveBeenCalledTimes(1));
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('continues a new listing action only after the actual sign-in succeeds', async () => {
    mocks.login.mockRejectedValueOnce(new Error('Invalid login credentials'));
    mocks.login.mockResolvedValueOnce(undefined);
    render(<NewListingButton />);
    fireEvent.click(screen.getByRole('button', { name: 'New listing' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'maria@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'GoodPassword!1' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('incorrect');
    expect(screen.queryByRole('dialog', { name: 'Create a listing' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled());
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);
    expect(await screen.findByRole('dialog', { name: 'Create a listing' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Welcome back' })).not.toBeInTheDocument();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});
