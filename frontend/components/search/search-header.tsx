'use client';

import { Input } from "@/components/ui/input";
import { useSearchState } from "@/hooks/use-search-state";

export default function SearchHeader() {
  const { query } = useSearchState();

  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">Search</h1>
      <Input
        type="search"
        placeholder="Search..."
        value={query.value}
        onChange={(e) => query.set(e.target.value)}
      />
    </div>
  );
} 
