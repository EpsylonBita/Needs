import React from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ user: null as null | { id: string }, loading: false, unread: undefined as number | undefined }));
vi.mock('@/lib/notifications/use-unread-notifications', () => ({ useUnreadNotifications: () => ({ data: state.unread === undefined ? undefined : { count: state.unread } }) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('next/dynamic', () => ({ default: () => ({ open, onOpenChange, initialDraft }: { open: boolean; onOpenChange: (open: boolean) => void; initialDraft?: { query?: string } }) => open ? <div role="dialog" aria-label="Create listing" data-draft-title={initialDraft?.query ?? ''}><button onClick={() => onOpenChange(false)}>Close creation</button></div> : null }));
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: state.user, isLoading: state.loading }) }));
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ t: (key: string, fallback?: string) => key === 'auth.close' ? 'Κλείσιμο' : fallback || key }) }));
vi.mock('@/components/auth/auth-dialog', () => ({ AuthDialog: ({ isOpen, onClose, onAuthenticated }: { isOpen: boolean; onClose: () => void; onAuthenticated: () => void }) => isOpen ? <div role="dialog" aria-label="Sign in"><button onClick={() => { state.user = { id: 'user-1' }; onAuthenticated(); }}>Complete sign in</button><button onClick={onClose}>Cancel sign in</button></div> : null }));
vi.mock('@/components/auth/user-avatar-menu', () => ({ UserAvatarMenu: () => <button>Account</button> }));
vi.mock('@/components/features/ads/new-listing-button', () => ({ NewListingButton: () => null }));
vi.mock('@/components/ui/language-toggle', () => ({ LanguageToggle: () => <button>Language</button> }));
vi.mock('@/lib/supabase/client', () => {
  const chain = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: null }) };
  for (const method of ['select', 'eq', 'order', 'limit'] as const) chain[method].mockReturnValue(chain);
  return { supabase: { from: vi.fn(() => chain), auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) }, channel: vi.fn(), removeChannel: vi.fn() } };
});

import { Navbar } from '@/components/layout/navbar';
import { savePendingPublication } from '@/lib/listings/publication-intent';

beforeEach(() => { state.user = null; state.loading = false; state.unread = undefined; localStorage.clear(); window.history.replaceState({}, '', '/'); });
afterEach(cleanup);

describe('mobile navigation actions', () => {
  it.each([86399999, 86400000])('checks the original deadline when resumed auth finishes after %s ms', async elapsed => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const start = Date.now();
      savePendingPublication({ intent: 'request', query: 'guitar', returnTo: '/search?q=guitar' });
      window.history.replaceState({}, '', '/search?q=guitar&resumeListing=1');
      render(<Navbar />);
      await screen.findByRole('dialog', { name: 'Sign in' });
      vi.setSystemTime(start + elapsed);
      await userEvent.click(screen.getByRole('button', { name: 'Complete sign in' }));
      expect(await screen.findByRole('dialog', { name: 'Create listing' })).toHaveAttribute('data-draft-title', elapsed < 86400000 ? 'guitar' : '');
    } finally { vi.useRealTimers(); }
  });
  it('resumes the saved publication after a confirmed email returns to the search route', async () => {
    savePendingPublication({ intent: 'request', query: 'guitar', returnTo: '/search?q=guitar' });
    state.user = { id: 'user-1' };
    window.history.replaceState({}, '', '/search?q=guitar&resumeListing=1');
    render(<Navbar />);
    expect(await screen.findByRole('dialog', { name: 'Create listing' })).toBeInTheDocument();
    expect(window.location.search).toBe('?q=guitar');
  });
  it('uses the shared unread result without inventing a badge on load failure', async () => {
    state.user = { id: 'user-1' };
    state.unread = 2;
    const view = render(<Navbar />);
    await act(async () => {});
    const bell = screen.getByRole('link', { name: 'Notifications' });
    expect(within(bell).getByText('2')).toBeInTheDocument();
    state.unread = 0;
    view.rerender(<Navbar />);
    expect(within(bell).queryByText('2')).toBeNull();
    state.unread = undefined;
    view.rerender(<Navbar />);
    expect(bell.querySelector('.needs-notification-count')).toBeNull();
  });
  it('closes navigation and continues from sign-in to listing creation for a guest', async () => {
    render(<Navbar />);
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'New listing' }));
    expect(screen.getByRole('dialog', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.queryByRole('dialog', { name: 'Create listing' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Complete sign in' }));
    expect(screen.getByRole('dialog', { name: 'Create listing' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('opens creation directly for an authenticated user', async () => {
    state.user = { id: 'user-1' };
    render(<Navbar />);
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'New listing' }));
    expect(screen.getByRole('dialog', { name: 'Create listing' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('does not revive a cancelled publication when signing in later', async () => {
    render(<Navbar />);
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'New listing' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel sign in' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await userEvent.click(screen.getByRole('button', { name: 'Complete sign in' }));
    expect(screen.queryByRole('dialog', { name: 'Create listing' })).not.toBeInTheDocument();
  });

  it('provides a localized, 44px close control and restores focus to the menu trigger', async () => {
    render(<Navbar />);
    const trigger = screen.getByRole('button', { name: 'Open menu' });
    await userEvent.click(trigger);
    const close = screen.getByRole('button', { name: 'Κλείσιμο' });
    expect(close).toHaveClass('h-11', 'w-11');
    await userEvent.click(close);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('does not start creation while the authenticated session is still loading', async () => {
    state.loading = true;
    render(<Navbar />);
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'New listing' })).toBeDisabled();
  });
});
