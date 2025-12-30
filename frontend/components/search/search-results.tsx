'use client';

import { useEffect, useState } from 'react';

interface SearchResultsProps {
  query?: string;
}

export function SearchResults({ query }: SearchResultsProps) {
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (query) {
      setIsLoading(true);
      // Simulate API call
      setTimeout(() => {
        setIsLoading(false);
      }, 1000);
    }
  }, [query]);

  if (isLoading) {
    return (
      <div className="text-center text-muted-foreground">
        Searching...
      </div>
    );
  }

  if (!query) {
    return (
      <div className="text-center text-muted-foreground">
        Enter a search term to find items and services
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-4">
        Search results for: {query}
      </h2>
      {/* Add your search results implementation here */}
      <div className="text-muted-foreground">
        Search results will be displayed here
      </div>
    </div>
  );
} 