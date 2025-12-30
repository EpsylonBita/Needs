'use client';

import { useState } from 'react';

import { motion } from 'framer-motion';

import { Map } from '@/components/features/map/map-component';
import { useI18n } from '@/contexts/i18n-context';
import { supabase } from '@/lib/supabase/client'

import { AdvancedSearchForm, AdvancedSearchFilters } from './advanced-search-form';
import { SearchBar } from './search-bar';

// Example results structure
interface SearchResult {
  id: string;
  title: string;
  description: string;
  price: number;
  location: {
    coordinates: [number, number];
    address: string;
  };
  sellerId?: string;
  sellerRating?: number;
}

// Initial example results
const initialResults = [
  {
    id: '1',
    title: 'City Center Location',
    description: 'Prime location in the heart of the city',
    price: 1500,
    location: {
      coordinates: [23.7275, 37.9838] as [number, number],
      address: 'Central Athens'
    }
  },
  {
    id: '2',
    title: 'South Area Spot',
    description: 'Peaceful southern neighborhood',
    price: 1200,
    location: {
      coordinates: [23.7245, 37.9765] as [number, number],
      address: 'South Athens'
    }
  }
];

export function SearchHeroSection() {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>(initialResults);
  const [isSearching, setIsSearching] = useState(false);
  const [isAdvancedSearchOpen, setIsAdvancedSearchOpen] = useState(false);
  const [_advancedFilters, setAdvancedFilters] = useState<AdvancedSearchFilters | null>(null);
  const { t } = useI18n();

  const handleSearch = async () => {
    setIsSearching(true);
    try {
      if (navigator.geolocation) {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject)
        })
        const { longitude, latitude } = pos.coords
        const { data, error } = await supabase.rpc('nearby_listings_detailed', { lon: longitude, lat: latitude, radius_m: 5000 })
        if (error) throw error
        let mapped: SearchResult[] = (data || []).map((l: { id: string; title: string; description: string; price: number; lon: number; lat: number; seller_id?: string }) => ({
          id: l.id,
          title: l.title,
          description: l.description,
          price: l.price,
          location: { coordinates: [l.lon, l.lat] as [number, number], address: '' },
          sellerId: l.seller_id,
        }))
        if (searchQuery) {
          mapped = mapped.filter(r =>
            (r.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
            (r.description || '').toLowerCase().includes(searchQuery.toLowerCase())
          )
        }
        const sellerIds = Array.from(new Set(mapped.map(m => m.sellerId).filter(Boolean)))
        if (sellerIds.length > 0) {
          const { data: revs } = await supabase
            .from('reviews')
            .select('seller_id, rating')
            .in('seller_id', sellerIds)
          const sumBySeller: Record<string, number> = {}
          const countBySeller: Record<string, number> = {}
          ;(revs || []).forEach((r: { seller_id: string; rating?: number }) => {
            const sid = r.seller_id
            sumBySeller[sid] = (sumBySeller[sid] || 0) + Number(r.rating || 0)
            countBySeller[sid] = (countBySeller[sid] || 0) + 1
          })
          mapped.forEach(m => {
            if (m.sellerId && countBySeller[m.sellerId]) {
              m.sellerRating = sumBySeller[m.sellerId] / countBySeller[m.sellerId]
            }
          })
        }
        setResults(mapped)
      } else {
        setResults(initialResults)
      }
    } catch (error) {
      console.error('Error searching:', error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleAdvancedSearch = (filters: AdvancedSearchFilters) => {
    setAdvancedFilters(filters);
    handleSearch();
  };


  return (
    <section className="relative w-full bg-gradient-to-b from-white to-gray-50 py-12 md:py-16 pt-[72px]">
      <div className="container mx-auto px-4">
        {/* Search Container */}
        <div className="max-w-3xl mx-auto text-center space-y-8 mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="relative"
          >
            <div suppressHydrationWarning>
              <SearchBar 
                onSearch={(search) => {
                  setSearchQuery(search);
                  handleSearch();
                }}
                isSearching={isSearching}
                onAdvancedSearch={() => setIsAdvancedSearchOpen(true)}
              />
            </div>

            {/* Advanced Search Form */}
            <AdvancedSearchForm
              isOpen={isAdvancedSearchOpen}
              onClose={() => setIsAdvancedSearchOpen(false)}
              onApply={handleAdvancedSearch}
            />
          </motion.div>
        </div>

        {/* Map Container */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="max-w-6xl mx-auto"
        >
          <div className="bg-transparent rounded-xl overflow-hidden">
            <div className="p-4 border-b bg-white/10 backdrop-blur-md border-white/20 shadow-lg">
              <h3 className="text-lg font-semibold text-gray-900">
                {t("search.listingsFound", `${results.length} Listings Found`).replace("{count}", String(results.length))}
              </h3>
              <p className="text-sm text-gray-500">
                {results.length > 0 
                  ? t('search.clickMarkers')
                  : t('search.noListings')}
              </p>
            </div>
            <div className="h-[400px] bg-transparent">
              <Map results={results} live />
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
