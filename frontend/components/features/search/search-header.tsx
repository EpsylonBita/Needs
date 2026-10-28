'use client';

import { useId } from 'react';

import { Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/contexts/i18n-context';
import { useSearchState } from '@/hooks/use-search-state';
import { SearchLocation } from './search-location';

export default function SearchHeader({ title }: { title?: string }) {
  const { query } = useSearchState();
  const { t } = useI18n();
  const id = useId();
  const heading = title === 'Items' ? t('searchModern.items', 'Items') : title === 'Services' ? t('searchModern.services', 'Services') : title || t('searchModern.title', 'Search your neighborhood');
  return <header className="needs-search-heading">
    <div><h1>{heading}</h1><p>{t('searchModern.description', 'Items and services, closer to you.')}</p></div>
    <div className="needs-search-query">
      <Label htmlFor={id} className="sr-only">{t('search.header', 'Search')}</Label>
      <div className="needs-search-query-field"><Search size={21} aria-hidden="true" /><Input id={id} type="search" placeholder={t('searchModern.placeholder', 'What are you looking for?')} value={query.value} onChange={event => query.set(event.target.value)} aria-describedby={`${id}-hint`} maxLength={200} />{query.value && <Button type="button" variant="ghost" size="icon" onClick={() => query.set('')} aria-label={t('searchModern.clearSearch', 'Clear search')}><X className="h-4 w-4" aria-hidden="true" /></Button>}</div>
      <p id={`${id}-hint`} className="mt-2 text-xs text-muted-foreground">{t('searchModern.liveSearch', 'Results update as you type.')}</p>
    </div>
    <SearchLocation />
  </header>;
}
