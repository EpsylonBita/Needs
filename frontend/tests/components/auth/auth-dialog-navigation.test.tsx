import { useState, type AnchorHTMLAttributes } from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ pathname: '/', navigate: (_path: string) => {}, close: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname, useRouter: () => ({ replace: (path: string) => navigation.navigate(path) }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} href={href} onClick={event => { event.preventDefault(); navigation.navigate(String(href)); }}>{children}</a> }));
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ login: vi.fn(), register: vi.fn() }) }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/services/auth-email-service', () => ({ completeAuthEmailLink: vi.fn(), completePasswordReset: vi.fn(), requestPasswordReset: vi.fn(), resendConfirmation: vi.fn() }));

import { AuthDialog } from '@/components/auth/auth-dialog';
import { AuthEmailPanel } from '@/components/auth/auth-email-panel';
import { AuthDialog as FeatureAuthDialog } from '@/components/features/auth/auth-dialog';

function PersistentLayout({ feature = false }: { feature?: boolean }) {
  const [open, setOpen] = useState(true);
  const [path, setPath] = useState('/');
  navigation.navigate = next => { navigation.pathname = next; setPath(next); };
  const Dialog = feature ? FeatureAuthDialog : AuthDialog;
  return <>
    <button onClick={() => setOpen(true)}>Open sign in</button>
    <Dialog isOpen={open} onClose={() => { navigation.close(); setOpen(false); }} />
    {path === '/auth/forgot-password' && <AuthEmailPanel mode="forgot" />}
    {path === '/auth/resend' && <AuthEmailPanel mode="resend" />}
  </>;
}

beforeEach(() => {
  navigation.pathname = '/';
  navigation.close.mockClear();
});

describe.each([false, true])('persistent login dialog navigation (feature=%s)', feature => {
  it.each([
    ['Forgot password?', 'Reset your password'],
    ['Resend confirmation', 'Confirm your email'],
  ])('closes the previous dialog after %s opens the email page', async (link, title) => {
    render(<PersistentLayout feature={feature} />);
    expect(navigation.close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('link', { name: link }));
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
    expect(screen.getByRole('dialog')).toHaveAccessibleName(title);
    expect(navigation.close).toHaveBeenCalledTimes(1);
  });
});
