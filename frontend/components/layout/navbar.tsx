"use client";
import React, { useState, useEffect, useCallback } from "react";

import Image from "next/image";
import Link from "next/link";

import { AnimatePresence, motion } from "framer-motion";
import { Bell, Menu as MenuIcon, UserCircle, X } from "lucide-react";

import { AuthDialog } from "@/components/auth/auth-dialog";
import { Button } from "@/components/ui/button";
import { LanguageToggle } from "@/components/ui/language-toggle";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { useI18n } from "@/contexts/i18n-context";
import { supabase } from "@/lib/supabase/client";

import { UserAvatarMenu } from "../auth/user-avatar-menu";

// Define event interface for TypeScript
interface LoginSuccessEvent extends Event {
  detail: { email: string };
}


/**
 * MenuItem Component
 *
 * Renders a single interactive menu item that displays children on hover.
 */
export const MenuItem = ({
  setActive,
  active,
  item,
  children,
}: {
  setActive: (item: string | null) => void; // setActive now accepts null for consistency
  active: string | null;
  item: string;
  children?: React.ReactNode;
}) => {
  // useCallback is used to memoize the handler, though in this simple case it might be optional
  const handleMouseEnter = useCallback(() => {
    setActive(item);
  }, [setActive, item]);

  return (
    <div onMouseEnter={handleMouseEnter} className="relative">
      <motion.p
        transition={{ duration: 0.3 }}
        className="cursor-pointer text-black hover:opacity-[0.9] dark:text-white"
      >
        {item}
      </motion.p>
      {active !== null && (
        <motion.div
          initial={{ opacity: 0, scale: 0.85, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", mass: 0.5, damping: 11.5, stiffness: 100, restDelta: 0.001, restSpeed: 0.001 }}
        >
          {active === item && (
            <div className="absolute top-[calc(100%_+_1.2rem)] left-1/2 transform -translate-x-1/2 pt-4">
              <motion.div
                transition={{ type: "spring", mass: 0.5, damping: 11.5, stiffness: 100, restDelta: 0.001, restSpeed: 0.001 }}
                layoutId="active"
                className="bg-white dark:bg-black backdrop-blur-sm rounded-2xl overflow-hidden border border-black/[0.2] dark:border-white/[0.2] shadow-xl"
              >
                <motion.div layout className="w-max h-full p-4">
                  {children}
                </motion.div>
              </motion.div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
};

/**
 * Menu Component
 *
 * Container for MenuItem components, managing the active state of menu items.
 */
export const Menu = ({
  setActive,
  children,
}: {
  setActive: (item: string | null) => void;
  children: React.ReactNode;
}) => {
  // useCallback is used to memoize the handler, though in this simple case it might be optional
  const handleMouseLeave = useCallback(() => {
    setActive(null);
  }, [setActive]);

  return (
    <nav
      onMouseLeave={handleMouseLeave}
      className="relative rounded-full border border-transparent dark:bg-black dark:border-white/[0.2] bg-white shadow-input flex justify-center space-x-4 px-8 py-6"
    >
      {children}
    </nav>
  );
};

/**
 * ProductItem Component
 *
 * Displays a product item with an image, title, and description, linking to a detail page.
 */
export const ProductItem = ({
  title,
  description,
  href,
  src,
}: {
  title: string;
  description: string;
  href: string;
  src: string;
}) => {
  return (
    <Link href={href} className="flex space-x-2">
      <Image
        src={src}
        width={140}
        height={70}
        alt={title}
        className="flex-shrink-0 rounded-md shadow-2xl"
      />
      <div>
        <h4 className="text-xl font-bold mb-1 text-black dark:text-white">
          {title}
        </h4>
        <p className="text-neutral-700 text-sm max-w-[10rem] dark:text-neutral-300">
          {description}
        </p>
      </div>
    </Link>
  );
};

/**
 * HoveredLink Component
 *
 * A simple link component with specific styling for hover effects.
 */
export const HoveredLink = ({ children, ...rest }: React.ComponentPropsWithoutRef<typeof Link>) => {
  return (
    <Link
      {...rest}
      className="text-neutral-700 dark:text-neutral-200 hover:text-black dark:hover:text-white transition-colors duration-200"
    >
      {children}
    </Link>
  );
};

/**
 * Navbar Component
 *
 * Main navigation bar component, handling authentication, mobile menu, and navigation links.
 */
export function Navbar(): React.ReactElement {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const { user } = useAuth();
  const [forceUpdate, setForceUpdate] = useState(0);
  const [localStorageUser, setLocalStorageUser] = useState<{ email?: string } | null>(null);
  const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const { toast } = useToast();
  const [isAdmin, setIsAdmin] = useState(false);
  const { t } = useI18n();

  // Add scroll listener
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 0);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Add listener for successful login events
  useEffect(() => {
    const handleLoginSuccess = (event: Event) => {
      const loginEvent = event as LoginSuccessEvent;
      console.log('Login success event detected in navbar for user:', loginEvent.detail?.email);
      // Force re-render to update login button
      setForceUpdate(prev => prev + 1);
    };
    
    window.addEventListener('auth:login-success', handleLoginSuccess);
    return () => window.removeEventListener('auth:login-success', handleLoginSuccess);
  }, []);

  // Whenever user state changes, log it
  useEffect(() => {
    console.log('Navbar detected user state change:', !!user);
  }, [user]);

  // Notifications: fetch unread and subscribe
  useEffect(() => {
    const ac = new AbortController()
    const setup = async () => {
      const u = await supabase.auth.getUser();
      const uid = u.data.user?.id;
      if (!uid) return;
      const s = await supabase.auth.getSession();
      const at = s.data.session?.access_token || '';
      if (at) {
        try {
          const chk = await fetch('/api/admin/check', { headers: { Authorization: `Bearer ${at}` }, signal: ac.signal });
          setIsAdmin(chk.ok);
        } catch (e: unknown) {
          const err = e as { name?: string } | Error
          if ((err as { name?: string }).name === 'AbortError' || String(err).includes('AbortError')) {
            return;
          }
          setIsAdmin(false);
        }
      } else {
        setIsAdmin(false);
      }
      const { data: meRows } = await supabase
        .from('profiles')
        .select('id')
        .eq('user_id', uid)
        .order('created_at', { ascending: true })
        .limit(1);
      const myId = (meRows || [])[0]?.id;
      if (!myId) return;
      const { data: rows } = await supabase
        .from('notifications')
        .select('id')
        .eq('user_id', myId)
        .eq('read', false);
      setUnreadCount((rows || []).length);
      const channel = supabase
        .channel(`notif-${myId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${myId}` } as any, (payload: { eventType: 'INSERT' | 'UPDATE'; new?: { read?: boolean; payload?: unknown }; old?: { read?: boolean } }) => {
          if (payload.eventType === 'INSERT') {
            setUnreadCount((c) => c + 1);
            toast({ title: 'New notification', description: JSON.stringify(payload.new?.payload || {}), });
          } else if (payload.eventType === 'UPDATE') {
            const read = !!payload.new?.read;
            const wasUnread = !payload.old?.read && payload.new?.read;
            if (wasUnread || read) setUnreadCount((c) => Math.max(0, c - 1));
          }
        })
        .subscribe();
      return () => { supabase.removeChannel(channel); };
    };
    setup();
    return () => { ac.abort(); };
  }, [user, toast]);

  // Check for directly stored user data in localStorage as backup
  useEffect(() => {
    // Only run in browser environment
    if (typeof window === 'undefined') return;
    
    // Only run if user is null - don't override existing auth context
    if (!user) {
      try {
        const userEventData = localStorage.getItem('userEvent.login');
        if (userEventData) {
          const parsed = JSON.parse(userEventData);
          const { user: localUser, timestamp } = parsed;
          const ageInMinutes = (Date.now() - timestamp) / (1000 * 60);
          
          // Only use if data is less than 30 minutes old
          if (ageInMinutes < 30 && localUser) {
            console.log('Found direct login data in localStorage:', localUser);
            setLocalStorageUser(localUser);
            setForceUpdate(prev => prev + 1);
          }
        }
      } catch (error) {
        console.error('Error checking localStorage for user data:', error);
      }
    }
  }, [user]);

  // Toggles the mobile menu open/close state
  const toggleMobileMenu = useCallback(() => {
    setIsMobileMenuOpen((prev) => !prev);
  }, []);

  return (
    <>
      <nav 
        className={`fixed top-0 left-0 right-0 z-[100] flex items-center justify-center p-4 transition-all duration-300 ${
          isScrolled 
            ? "bg-white/80 dark:bg-black/80 backdrop-blur-md shadow-md" 
            : "bg-transparent"
        }`}
      >
        {/* Burger icon on the left - Mobile menu toggle */}
        <div className="absolute left-4">
          <button
            onClick={toggleMobileMenu}
            className="flex items-center"
            aria-label={isMobileMenuOpen ? t('navbar.closeMenu', 'Close menu') : t('navbar.openMenu', 'Open menu')}
          >
            {isMobileMenuOpen ? (
              <X className="w-10 h-10 md:w-8 md:h-8 cursor-pointer text-blue-500 hover:text-white transition-all duration-300 hover:scale-110 hover:drop-shadow-lg [text-shadow:_0_0_5px_rgb(255_255_255_/_40%)]" />
            ) : (
              <MenuIcon className="w-6 h-6 md:w-8 md:h-8 cursor-pointer text-blue-500 hover:text-white transition-all duration-300 hover:scale-110 hover:drop-shadow-lg [text-shadow:_0_0_5px_rgb(255_255_255_/_40%)]" />
            )}
          </button>
        </div>

        {/* Centered home button/logo with glowing effect */}
        <Link href="/" className="transition duration-300 hover:scale-105">
          <span className="text-4xl md:text-4xl font-bold filter transition duration-300 hover:drop-shadow-[0_0_15px_rgba(59,130,246,0.85)]">
            <span className={`${isScrolled ? 'text-black dark:text-white' : 'text-black dark:text-white'}`}>.</span>
            <span className="text-blue-500 font-extrabold">needs</span>
          </span>
        </Link>

        {/* User authentication section on the right */}
        <div className="absolute right-4 flex items-center gap-2">
          {/* Theme toggle button */}
          <ThemeToggle 
            size="sm"
            variant="ghost"
            className="mr-2 text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
          />
          <LanguageToggle className="mr-1 text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300" />
          {isAdmin && (
            <Link href="/dashboard/admin" className="relative inline-flex items-center" aria-label={t('navbar.admin','Admin')}>
              <span className="inline-block h-5 w-5 rounded-sm bg-purple-600" />
            </Link>
          )}
          {/* Notifications */}
          <Link href="/dashboard/notifications" className="relative inline-flex items-center" aria-label={t('navbar.notifications','Notifications')}>
            <Bell className="h-5 w-5 text-blue-500" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 text-[10px] px-1.5 py-0.5 rounded-full bg-red-600 text-white">{unreadCount}</span>
            )}
          </Link>
          
          {/* Login button - only show when not logged in */}
          {!user && !localStorageUser && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsAuthDialogOpen(true)}
              className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
            >
              <UserCircle className="h-5 w-5 mr-1" />
              {t("navbar.login", "Login")}
            </Button>
          )}
          
          {/* User authentication section */}
          {user ? (
            <UserAvatarMenu key={`user-${forceUpdate}-${user.id}`} />
          ) : localStorageUser ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-blue-500">{t('navbar.loggedInAs','Logged in as')} {localStorageUser.email}</span>
              <button 
                onClick={() => {
                  // Only access localStorage on the client side
                  if (typeof window !== 'undefined') {
                    // Clear localStorage data
                    localStorage.removeItem('userEvent.login');
                    // Reset local state
                    setLocalStorageUser(null);
                    // Force re-render
                    setForceUpdate(prev => prev + 1);
                  }
                }}
                className="text-sm text-red-500 hover:text-red-700"
              >
                {t("navbar.logout", "Log out")}
              </button>
            </div>
          ) : (
            null
          )}
        </div>
      </nav>

      {/* Mobile Menu - Compact & Snappy */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="fixed top-16 left-4 w-56 z-50 backdrop-blur-3xl bg-white/30 dark:bg-gray-900/20 rounded-xl shadow-2xl shadow-black/30 border border-white/20 dark:border-gray-700/30"
          >
            <div className="p-1.5 space-y-0.5 bg-gradient-to-b from-white/10 to-transparent">
              {[
                { title: t("navbar.home", "Home"), href: "/" },
                { title: t("navbar.items", "Items"), href: "/items" },
                { title: t("navbar.services", "Services"), href: "/services" },
                { title: t("navbar.about", "About"), href: "/about" }
              ].map((item, index) => (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.04 }}
                >
                  <Link
                    href={item.href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="group flex items-center px-4 py-2.5 rounded-lg transition-all duration-300
                               hover:bg-white/25 dark:hover:bg-gray-800/30
                               active:scale-[0.98] transform-gpu
                               border border-transparent hover:border-white/30 dark:hover:border-gray-700/20"
                  >
                    <span className="text-sm font-medium text-gray-800/95 dark:text-gray-200/95 
                                   group-hover:text-blue-700 dark:group-hover:text-blue-300
                                   tracking-tight transition-colors">
                      {item.title}
                    </span>
                  </Link>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Auth Dialog */}
      <AuthDialog 
        isOpen={isAuthDialogOpen}
        onClose={() => setIsAuthDialogOpen(false)}
        initialMode="signin"
      />
    </>
  );
}
