'use client';

import { useI18n } from '@/contexts/i18n-context';

export function SkipLink() {
  const { locale } = useI18n();
  return <a href="#main-content" className="needs-skip-link">{locale === 'el' ? 'Μετάβαση στο περιεχόμενο' : 'Skip to content'}</a>;
}
