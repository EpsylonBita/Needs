'use client';

import { useState } from 'react';

import { motion } from "framer-motion";
import { Search, ChevronRight } from 'lucide-react';

interface SearchBarProps {
  onSearch: (searchQuery: string, locationQuery?: string) => void;
  isSearching?: boolean;
  onAdvancedSearch?: () => void;
}

export function SearchBar({ 
  onSearch, 
  className = '',
  isSearching: _isSearching = false,
  onAdvancedSearch
}: SearchBarProps & { className?: string }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [locationQuery] = useState<string | undefined>(undefined);

  const handleSearch = () => {
    onSearch(searchQuery, locationQuery);
  };

  const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (event) => {
    if (event.key === 'Enter') {
      handleSearch();
    }
  };

  return (
    <div className={`w-full ${className}`}>
      <div className="relative group" suppressHydrationWarning>
        <motion.input
          type="text"
          name="search"
          placeholder="What are you looking for?"
          className="block w-full px-8 py-5 mx-auto text-lg text-gray-900 bg-white/10 rounded-full shadow-lg shadow-blue-500/20 border border-blue-50/40 outline-none transition-all duration-300 ease-in-out backdrop-blur-md hover:bg-white/20 hover:shadow-blue-500/30 hover:border-blue-200/60 focus:bg-white/20 focus:shadow-blue-500/30 focus:border-blue-200/60 focus:scale-[1.02]"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            if (e.target.value) {
              handleSearch();
            }
          }}
          onKeyDown={handleKeyDown}
          whileHover={{ scale: 1.02 }}
          whileFocus={{ scale: 1.05 }}
        />
        <Search className="absolute right-16 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400/80" />
        <button
          className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-gray-500 transition-all duration-300 bg-white/10 rounded-full backdrop-blur border border-black/5 hover:text-blue-600 hover:bg-white/20 hover:scale-105 hover:transform"
          onClick={() => onAdvancedSearch?.()}
          title="Advanced search options"
        >
          <ChevronRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
        </button>
      </div>
    </div>
  );
}
