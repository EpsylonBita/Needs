'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';
 
import { SlidersHorizontal } from 'lucide-react';

import { AnimatedSearchInput } from "@/components/ui/animated-search-input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";

interface Category {
  id: string;
  name: string;
  subcategories: { id: string; name: string }[];
}

/**
 * AdvancedSearch component allows users to perform searches with advanced filtering options.
 * It includes a text input for the main search term, and a sheet that provides options for:
 * - Selecting a category and subcategory.
 * - Setting a distance range using a slider.
 *
 * The component updates the URL search parameters based on the selected filters and triggers
 * a navigation to the search results page with the applied filters.
 */
export function AdvancedSearch() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [category, setCategory] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [distance, setDistance] = useState([50]);

  // Mock categories - replace with API call in a production environment.
  const categories: Category[] = [
    {
      id: '1',
      name: 'Electronics',
      subcategories: [
        { id: '1-1', name: 'Phones' },
        { id: '1-2', name: 'Computers' },
      ]
    },
    // ... other categories can be added here
  ];

  const selectedCategory = categories.find(c => c.id === category);

  const handleSearch = () => {
    const params = new URLSearchParams();
    if (searchTerm) params.set('q', searchTerm);
    if (category) params.set('category', category);
    if (subcategory) params.set('subcategory', subcategory);
    if (distance) params.set('distance', distance[0].toString());

    router.push(`/search?${params.toString()}`);
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4">
      <div className="flex gap-2">
        {/* Main search input */}
        <div className="relative flex-1">
          <AnimatedSearchInput
            placeholder="What are you looking for?"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onSearch={handleSearch}
            className="w-full"
          />
        </div>

        {/* Advanced search options sheet */}
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="default">
              <SlidersHorizontal className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Advanced Search</SheetTitle>
            </SheetHeader>
            <div className="space-y-6 py-4">
              {/* Category selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Category</label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Subcategory selection (dependent on the selected category) */}
              {selectedCategory && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Subcategory</label>
                  <Select value={subcategory} onValueChange={setSubcategory}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select subcategory" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedCategory.subcategories.map((sub) => (
                        <SelectItem key={sub.id} value={sub.id}>
                          {sub.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Distance slider */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Distance (km)</label>
                <Slider
                  value={distance}
                  onValueChange={setDistance}
                  min={1}
                  max={100}
                  step={1}
                />
                <span className="text-sm text-muted-foreground">
                  Within {distance[0]} kilometers
                </span>
              </div>

              {/* Apply filters button */}
              <Button onClick={handleSearch} className="w-full">
                Apply Filters
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
