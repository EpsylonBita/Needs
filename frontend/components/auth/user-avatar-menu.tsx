'use client';

import { useState } from 'react';
import Link from 'next/link';

import { LayoutDashboard, List, LogOut, MessageSquare, Receipt, Settings, Target, Wallet } from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { useI18n } from '@/contexts/i18n-context';

export function UserAvatarMenu() {
  const { user, logout } = useAuth();
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const name = user.fullName?.trim() || t('auth.menu.member', 'Needs member');
  const initials = name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();

  async function handleLogout() {
    if (busy) return;
    setBusy(true);
    try {
      await logout();
      toast({ title: t('auth.menu.loggedOut', 'Logged out'), description: t('auth.menu.loggedOutDescription', 'You have been successfully logged out.') });
    } catch {
      toast({ title: t('auth.menu.logoutError', 'Unable to log out'), description: t('auth.menu.logoutErrorDescription', 'Please try again.'), variant: 'destructive' });
    } finally { setBusy(false); }
  }

  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" disabled={busy} aria-label={t('auth.menu.open', 'Open account menu')} className="flex h-11 w-11 items-center justify-center rounded-full outline-none ring-offset-background transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50">
        <Avatar className="h-9 w-9 border border-primary/15"><AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">{initials}</AvatarFallback></Avatar>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-64 rounded-xl border-border p-2 shadow-lg">
      <DropdownMenuLabel className="px-3 py-3 font-normal"><p className="truncate text-sm font-semibold">{name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{user.email}</p></DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild className="min-h-11 rounded-lg px-3"><Link href="/dashboard"><LayoutDashboard className="mr-2 h-4 w-4" aria-hidden="true" />{t('auth.menu.dashboard', 'Dashboard')}</Link></DropdownMenuItem>
      <DropdownMenuItem asChild className="min-h-11 rounded-lg px-3"><Link href="/chat"><MessageSquare className="mr-2 h-4 w-4" aria-hidden="true" />{t('auth.menu.inbox', locale === 'el' ? 'Μηνύματα' : 'Inbox')}</Link></DropdownMenuItem>
      <DropdownMenuItem asChild className="min-h-11 rounded-lg px-3"><Link href="/dashboard/listings"><List className="mr-2 h-4 w-4" aria-hidden="true" />{t('auth.menu.listings', locale === 'el' ? 'Οι αγγελίες μου' : 'My listings')}</Link></DropdownMenuItem>
      <DropdownMenuItem asChild className="min-h-11 rounded-lg px-3"><Link href="/dashboard/orders"><Receipt className="mr-2 h-4 w-4" aria-hidden="true" />{t('auth.menu.orders', locale === 'el' ? 'Οι συμφωνίες μου' : 'My orders')}</Link></DropdownMenuItem>
      <DropdownMenuItem asChild className="min-h-11 rounded-lg px-3"><Link href="/dashboard/payments"><Wallet className="mr-2 h-4 w-4" aria-hidden="true" />{t('auth.menu.payments', locale === 'el' ? 'Πληρωμές' : 'Payments')}</Link></DropdownMenuItem>
      <DropdownMenuItem asChild className="min-h-11 rounded-lg px-3"><Link href="/dashboard/milestones"><Target className="mr-2 h-4 w-4" aria-hidden="true" />{t('auth.menu.milestones', locale === 'el' ? 'Στάδια εργασίας' : 'Milestones')}</Link></DropdownMenuItem>
      <DropdownMenuItem asChild className="min-h-11 rounded-lg px-3"><Link href="/profile"><Settings className="mr-2 h-4 w-4" aria-hidden="true" />{t('auth.menu.settings', 'Profile & settings')}</Link></DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={busy} onSelect={() => { void handleLogout(); }} className="min-h-11 rounded-lg px-3 text-destructive focus:text-destructive"><LogOut className="mr-2 h-4 w-4" aria-hidden="true" />{t('auth.menu.logout', 'Log out')}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
