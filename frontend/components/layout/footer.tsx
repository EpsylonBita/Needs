"use client"
import Link from 'next/link'

import { Github, Linkedin, Twitter } from 'lucide-react'

import { Separator } from '@/components/ui/separator'
import { useI18n } from '@/contexts/i18n-context'

export function Footer() {
  const { t } = useI18n()
  return (
    <footer className="w-full bg-background border-t border-blue-100 dark:border-blue-900/40">
      <div className="container px-4 py-12 mx-auto">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-4">
          {/* Company Info */}
          <div className="space-y-4">
            <h3 className="text-xl font-semibold tracking-tight text-blue-600 dark:text-blue-400">.needs</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t('footer.companyTagline', 'Your one-stop shop for all your needs. Discover, connect, and fulfill your requirements.')}
            </p>
          </div>

          {/* Quick Links */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold tracking-wider text-blue-600 dark:text-blue-400 uppercase">{t('footer.quickLinks', 'Quick Links')}</h3>
            <ul className="space-y-3">
              <li>
                <Link 
                  href="/search" 
                  className="text-sm text-muted-foreground hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200"
                >
                  {t('footer.search', 'Search')}
                </Link>
              </li>
              <li>
                <Link 
                  href="/about" 
                  className="text-sm text-muted-foreground hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200"
                >
                  {t('footer.aboutUs', 'About Us')}
                </Link>
              </li>
              <li>
                <Link 
                  href="/contact" 
                  className="text-sm text-muted-foreground hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200"
                >
                  {t('footer.contact', 'Contact')}
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold tracking-wider text-blue-600 dark:text-blue-400 uppercase">{t('footer.legal', 'Legal')}</h3>
            <ul className="space-y-3">
              <li>
                <Link 
                  href="/privacy" 
                  className="text-sm text-muted-foreground hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200"
                >
                  {t('footer.privacyPolicy', 'Privacy Policy')}
                </Link>
              </li>
              <li>
                <Link 
                  href="/terms" 
                  className="text-sm text-muted-foreground hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200"
                >
                  {t('footer.termsOfService', 'Terms of Service')}
                </Link>
              </li>
            </ul>
          </div>

          {/* Social Links */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold tracking-wider text-blue-600 dark:text-blue-400 uppercase">{t('footer.connect', 'Connect With Us')}</h3>
            <div className="flex space-x-5">
              <Link 
                href="https://twitter.com" 
                className="text-muted-foreground hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200"
                aria-label="Twitter"
              >
                <Twitter className="h-5 w-5" />
              </Link>
              <Link 
                href="https://github.com" 
                className="text-muted-foreground hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200"
                aria-label="GitHub"
              >
                <Github className="h-5 w-5" />
              </Link>
              <Link 
                href="https://linkedin.com" 
                className="text-muted-foreground hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200"
                aria-label="LinkedIn"
              >
                <Linkedin className="h-5 w-5" />
              </Link>
            </div>
          </div>
        </div>

        <Separator className="my-12 bg-blue-100 dark:bg-blue-900/40" />
        
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} <span className="text-blue-600 dark:text-blue-400">.needs</span>. {t('footer.allRights', 'All rights reserved.')}
          </p>
        </div>
      </div>
    </footer>
  )
}
