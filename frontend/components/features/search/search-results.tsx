'use client';

import { useEffect, useState } from 'react';

import { useI18n } from '@/contexts/i18n-context'
import { useGeolocation } from '@/hooks/useGeolocation'
import { supabase } from '@/lib/supabase/client'

interface SearchResultsProps {
  query?: string;
  radiusMeters?: number;
}

type ListingCard = {
  id: string
  title: string
  description: string
  price: number
  main_category: string
  sub_category: string
}

export function SearchResults({ query, radiusMeters = 5000 }: SearchResultsProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<ListingCard[]>([]);
  const { location } = useGeolocation();
  const { t, formatCurrency } = useI18n();

  useEffect(() => {
    const run = async () => {
      setIsLoading(true);
      try {
        if (location) {
          const { data, error } = await supabase.rpc('nearby_listings', {
            lon: location.lng,
            lat: location.lat,
            radius_m: radiusMeters,
          });
          if (error) throw error;
          const rows = (data || []) as Array<{ id: string; title: string; description: string; price: number; main_category: string; sub_category: string }>
          const filtered = query
            ? rows.filter((l) =>
                (l.title || '').toLowerCase().includes(query.toLowerCase()) ||
                (l.description || '').toLowerCase().includes(query.toLowerCase())
              )
            : rows;
          setResults(filtered.map((l) => ({
            id: l.id,
            title: l.title,
            description: l.description,
            price: l.price,
            main_category: l.main_category,
            sub_category: l.sub_category,
          })));
        } else if (query) {
          const { data, error } = await supabase
            .from('listings')
            .select('id,title,description,price,main_category,sub_category')
            .ilike('title', `%${query}%`)
            .limit(50);
          if (error) throw error;
          setResults((data || []) as ListingCard[]);
        } else {
          setResults([]);
        }
      } catch (_e) {
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }
    run();
  }, [query, location, location?.lat, location?.lng, radiusMeters]);

  if (isLoading) {
    return (
      <div className="text-center text-muted-foreground">
        {t('search.searching','Searching...')}
      </div>
    );
  }

  if (!query && results.length === 0) {
    return (
      <div className="text-center text-muted-foreground">
        {t('search.enterSearchOrEnableLocation','Enter a search term or enable location to find nearby items and services')}
      </div>
    );
  }

  return (
    <div>
      {query && (
        <h2 className="text-2xl font-semibold mb-4">
          {t('search.resultsFor','Search results for:')} {query}
        </h2>
      )}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {results.map((r) => (
          <div key={r.id} className="p-4 rounded-md ring-1 ring-gray-200 dark:ring-gray-800">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{r.title}</h3>
              {typeof r.price === 'number' && (
                <span className="text-blue-600">{formatCurrency(r.price)}</span>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-2 line-clamp-3">{r.description}</p>
            <div className="mt-2 text-xs text-gray-400">
              {r.main_category} • {r.sub_category}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
