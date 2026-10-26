'use client';
import Link from 'next/link';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { useI18n } from '@/contexts/i18n-context';
export function Footer() {
  const { t } = useI18n();
  return <footer className="needs-footer"><div className="needs-shell needs-footer-inner">
    <div><Link href="/" className="needs-logo"><span>.</span>needs</Link><p>{t('modern.footer.tagline', 'Your neighborhood, in one place.')}</p></div>
    <nav aria-label={t('modern.footer.navigation', 'Footer navigation')}>
      <Link href="/search">{t('footer.search', 'Search')}</Link><Link href="/about">{t('navbar.about', 'About')}</Link>
      <Link href="/contact">{t('footer.contact', 'Contact')}</Link><Link href="/privacy">{t('footer.privacyPolicy', 'Privacy')}</Link>
      <Link href="/terms">{t('footer.termsOfService', 'Terms')}</Link>
    </nav>
    <div className="needs-footer-meta"><small>© {new Date().getFullYear()} Needs</small><ThemeToggle size="sm" variant="ghost" /></div>
  </div></footer>;
}
