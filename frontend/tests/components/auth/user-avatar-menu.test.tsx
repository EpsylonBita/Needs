import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: { fullName: 'Maria Test', email: 'maria@example.com' }, logout: vi.fn() }) }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { UserAvatarMenu } from '@/components/auth/user-avatar-menu';

describe('account menu', () => {
  it('opens from the keyboard and links account settings to an existing page', async () => {
    render(<UserAvatarMenu />);
    const trigger = screen.getByRole('button', { name: 'Open account menu' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(await screen.findByRole('menuitem', { name: 'Profile & settings' })).toHaveAttribute('href', '/profile');
    expect(screen.getByRole('menuitem', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('menuitem', { name: 'Inbox' })).toHaveAttribute('href', '/chat');
    expect(screen.getByRole('menuitem', { name: 'My listings' })).toHaveAttribute('href', '/dashboard/listings');
    expect(screen.getByRole('menuitem', { name: 'My orders' })).toHaveAttribute('href', '/dashboard/orders');
    expect(screen.getByRole('menuitem', { name: 'Payments' })).toHaveAttribute('href', '/dashboard/payments');
    expect(screen.getByRole('menuitem', { name: 'Milestones' })).toHaveAttribute('href', '/dashboard/milestones');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
});
