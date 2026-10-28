'use client';

import { Suspense, useId, useState } from 'react';
import Link from 'next/link';

import { ChevronDown, SlidersHorizontal } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { useI18n } from '@/contexts/i18n-context';
import { useSearchState } from '@/hooks/use-search-state';

import SearchFilters from './search-filters';
import SearchHeader from './search-header';
import { SearchResults } from './search-results';

export function ClientSearchPage({ category }: { category?: 'Items' | 'Services' }) {
  const { t } = useI18n();
  const search = useSearchState();
  const filterId = useId();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const categories = [
    { value: '', label: t('searchModern.all', 'All'), href: '/search' },
    { value: 'Items', label: t('searchModern.items', 'Items'), href: '/items' },
    { value: 'Services', label: t('searchModern.services', 'Services'), href: '/services' },
  ];
  const selectedCategory = category || search.category.value;
  const filterCount = Number(Boolean(search.subcategory.value)) + Number(search.tags.value.some(Boolean)) + Number(Boolean(search.coordinates.value));
  function categoryHref(href: string) {
    const params = new URLSearchParams();
    if (search.query.value) params.set('q', search.query.value);
    if (search.tags.value.some(Boolean)) params.set('tags', search.tags.value.filter(Boolean).join(','));
    if (search.coordinates.value) params.set('coordinates', search.coordinates.value);
    if (search.coordinates.value && search.locationLabel.value) params.set('location', search.locationLabel.value);
    if (search.distance.value !== 50) params.set('distance', String(search.distance.value));
    return href + (params.size ? '?' + params.toString() : '');
  }
  return <div className="needs-search-discovery">
    <SearchHeader title={category} />
    <div className="needs-search-toolbar">
      <div className="needs-search-categories" role="group" aria-label={t('searchModern.category', 'Category')}>
        {categories.map(option => category
          ? <Link key={option.value} href={categoryHref(option.href)} aria-current={selectedCategory === option.value ? 'page' : undefined}>{option.label}</Link>
          : <button key={option.value} type="button" aria-pressed={selectedCategory === option.value} onClick={() => { void search.category.set(option.value); }}>{option.label}</button>)}
      </div>
      <button type="button" aria-controls={filterId} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(open => !open)} className="needs-search-filter-toggle">
        <SlidersHorizontal size={18} aria-hidden="true" />{t('searchModern.filters', 'Filters')}
        {filterCount > 0 && <span className="needs-search-filter-count">{filterCount}</span>}
        <ChevronDown size={15} className={filtersOpen ? 'rotate-180' : ''} aria-hidden="true" />
      </button>
    </div>
    <div id={filterId} className={filtersOpen ? 'needs-search-filter-panel' : 'hidden'}>
      <SearchFilters fixedCategory={category} showLocationControl={false} />
    </div>
    <Suspense fallback={<Skeleton className="h-80 rounded-2xl" />}><SearchResults fixedCategory={category} /></Suspense>
  </div>;
}
