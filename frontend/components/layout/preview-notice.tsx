'use client';

import Link from 'next/link';
import operator from '@/config/legal-operator.json';
import { useI18n } from '@/contexts/i18n-context';

export function PreviewNotice() {
  const { t } = useI18n();
  if (operator.releaseStatus !== 'draft') return null;
  return <aside className="needs-shell my-4 rounded-xl border border-border bg-muted/50 px-4 py-3 text-xs leading-relaxed text-muted-foreground" aria-label={t('searchModern.previewNotice')}>
    {t('searchModern.previewNotice')} <Link href="/terms" className="inline-block min-h-6 font-medium text-primary underline underline-offset-4 focus-visible:outline focus-visible:outline-2">{t('searchModern.previewLink')}</Link>
  </aside>;
}
