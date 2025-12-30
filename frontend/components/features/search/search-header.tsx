'use client';

import { Input } from "@/components/ui/input";
import { useI18n } from '@/contexts/i18n-context';
import { useSearchState } from "@/hooks/use-search-state";

export default function SearchHeader() {
  const { query } = useSearchState();
  const { t } = useI18n();

  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">{t('search.header','Search')}</h1>
      <Input
        type="search"
        placeholder={t('search.inputPlaceholder','Search...')}
        value={query.value}
        onChange={(e) => query.set(e.target.value)}
      />
    </div>
  );
}
