'use client';

import { useState } from 'react';

import { motion } from 'framer-motion';

import { Map } from '@/components/features/map/map-component';

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
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedSearchFilters | null>(null);

  const handleSearch = async () => {
    setIsSearching(true);
    try {
      // Here you would typically make an API call to get real results
      // For now, we'll simulate a search by filtering the initial results
      const filteredResults = initialResults.filter(result => {
        const matchesSearch = searchQuery ? 
          (result.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
           result.description.toLowerCase().includes(searchQuery.toLowerCase()))
          : true;

        const matchesLocation = true;

        // Apply advanced filters if they exist
        if (advancedFilters) {
          // Add your advanced filtering logic here
          // This is just an example
          return matchesSearch && matchesLocation;
        }

        return matchesSearch && matchesLocation;
      });

      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 500));
      setResults(filteredResults);
    } catch (error) {
      console.error('Error searching:', error);
      // You might want to show an error message to the user here
    } finally {
      setIsSearching(false);
    }
  };

  const handleAdvancedSearch = (filters: AdvancedSearchFilters) => {
    setAdvancedFilters(filters);
    handleSearch();
  };

  

  return (
    <section className="relative w-full bg-transparent py-12 md:py-16 pt-[72px]">
      <div className="container mx-auto px-4 bg-transparent">
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
                {results.length} Listings Found
              </h3>
              <p className="text-sm text-gray-500">
                {results.length > 0 
                  ? 'Click on markers to see listing details.'
                  : 'No listings found for your search criteria. Try adjusting your search.'}
              </p>
            </div>
            <div className="h-[400px] bg-transparent">
              <Map results={results} />
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
