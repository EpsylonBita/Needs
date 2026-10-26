'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { Bell, Menu } from 'lucide-react';
import { AuthDialog } from '@/components/auth/auth-dialog';
import { UserAvatarMenu } from '@/components/auth/user-avatar-menu';
import { NewListingButton } from '@/components/features/ads/new-listing-button';
import { Button } from '@/components/ui/button';
import { LanguageToggle } from '@/components/ui/language-toggle';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger, SheetClose } from '@/components/ui/sheet';
import { useAuth } from '@/contexts/auth-context';
import { useI18n } from '@/contexts/i18n-context';
import { supabase } from '@/lib/supabase/client';
import { useUnreadNotifications } from '@/lib/notifications/use-unread-notifications';
const CreateAdDialog = dynamic(() => import('@/components/features/ads/create-ad-dialog').then(module => module.CreateAdDialog));
export function Navbar() {
  const { user, isLoading } = useAuth();
  const { t } = useI18n();
  const pathname = usePathname();
  const [signIn, setSignIn] = useState(false);
  const [menu, setMenu] = useState(false);
  const [create, setCreate] = useState(false);
  const [createAfterLogin, setCreateAfterLogin] = useState(false);
  const [adminAccess, setAdminAccess] = useState({ userId: '', admin: false });
  const notifications = useUnreadNotifications();
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    async function subscribe() {
      const { data: session } = await supabase.auth.getSession();
      if (controller.signal.aborted) return;
      const token = session.session?.access_token;
      const admin = token ? await fetch('/api/admin/check', { headers: { Authorization: 'Bearer ' + token }, signal: controller.signal }).then(response => response.ok) : false;
      if (controller.signal.aborted) return;
      setAdminAccess({ userId: userId!, admin });
    }
    void subscribe().catch(() => { /* Optional badges must not block navigation. */ });
    return () => { controller.abort(); };
  }, [userId]);
  const links = [
    { href: '/items', label: t('navbar.items', 'Items') },
    { href: '/services', label: t('navbar.services', 'Services') },
  ];
  const current = adminAccess.userId === userId ? adminAccess : null;
  const unreadCount = notifications.data?.count;
  return <>
    <header className={'needs-header' + (pathname === '/' ? ' needs-header--home' : '')}><nav className="needs-shell needs-nav" aria-label={t('modern.navigation', 'Main navigation')}>
      <Link href="/" className="needs-logo" aria-label=".needs"><span>.</span>needs</Link>
      <div className="needs-nav-links">{links.map(link => <Link key={link.href} href={link.href}
        aria-current={pathname === link.href ? 'page' : undefined}>{link.label}</Link>)}</div>
      <div className="needs-nav-actions">
        <ThemeToggle variant="ghost" className="needs-icon-button" />
        <div className="hidden sm:block"><LanguageToggle /></div>
        {user ? <>
          {current?.admin && <Link className="hidden lg:inline-flex needs-nav-admin" href="/dashboard/admin">{t('navbar.admin', 'Admin')}</Link>}
          <Link href="/dashboard/notifications" className="needs-icon-button relative" aria-label={t('navbar.notifications', 'Notifications')}>
            <Bell className="h-5 w-5" />{unreadCount !== undefined && unreadCount > 0 && <span className="needs-notification-count">{Math.min(unreadCount, 99)}</span>}
          </Link>
          <UserAvatarMenu />
        </> : <Button variant="ghost" className="hidden sm:inline-flex" disabled={isLoading} onClick={() => setSignIn(true)}>{t('navbar.login', 'Sign in')}</Button>}
        <div className="hidden lg:block"><NewListingButton /></div>
        <Sheet open={menu} onOpenChange={setMenu}>
          <SheetTrigger asChild><Button variant="ghost" size="icon" className="lg:hidden" aria-label={t('navbar.openMenu', 'Open menu')}><Menu className="h-5 w-5" /></Button></SheetTrigger>
          <SheetContent side="right" closeLabel={t('auth.close', 'Close')} className="w-[min(90vw,360px)]">
            <SheetHeader><SheetTitle className="needs-logo"><span>.</span>needs</SheetTitle>
              <SheetDescription>{t('modern.footer.tagline', 'Your neighborhood, in one place.')}</SheetDescription></SheetHeader>
            <div className="needs-mobile-links">{[...links, { href: '/search', label: t('search.header', 'Search') }, { href: '/contact', label: t('footer.contact', 'Contact') }].map(link =>
              <SheetClose asChild key={link.href}><Link href={link.href} aria-current={pathname === link.href ? 'page' : undefined}>{link.label}</Link></SheetClose>)}</div>
            <div className="flex items-center justify-between border-t pt-5"><LanguageToggle />
              {!user && <Button variant="outline" onClick={() => { setMenu(false); setSignIn(true); }}>{t('navbar.login', 'Sign in')}</Button>}</div>
            <Button className="mt-5 w-full" disabled={isLoading} onClick={() => {
              setMenu(false);
              if (user) setCreate(true);
              else { setCreateAfterLogin(true); setSignIn(true); }
            }}>{t('modern.newListing', 'New listing')}</Button>
          </SheetContent>
        </Sheet>
      </div>
    </nav></header>
    <AuthDialog isOpen={signIn} onClose={() => { setSignIn(false); setCreateAfterLogin(false); }} onAuthenticated={() => {
      setSignIn(false);
      if (createAfterLogin) setCreate(true);
      setCreateAfterLogin(false);
    }} />
    {create && <CreateAdDialog open={create} onOpenChange={setCreate} />}
  </>;
}
