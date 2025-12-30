'use client';

import { useRouter } from 'next/navigation';

import { SlidersHorizontal } from 'lucide-react';
import { parseAsInteger, parseAsString, useQueryState } from 'nuqs';

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
import { useI18n } from '@/contexts/i18n-context';

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
 * The component uses nuqs for URL query state management, ensuring that search parameters
 * are synchronized with the URL for better UX and shareable search results.
 */
export function AdvancedSearch() {
  const router = useRouter();
  const { t } = useI18n();
  const [searchTerm, setSearchTerm] = useQueryState('q', parseAsString);
  const [category, setCategory] = useQueryState('category', parseAsString);
  const [subcategory, setSubcategory] = useQueryState('subcategory', parseAsString);
  const [distance, setDistance] = useQueryState('distance', parseAsInteger.withDefault(50));

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

  const selectedCategory = categories.find(c => c.id === (category || ''));

  const handleSearch = async () => {
    // Navigate to search page if we're not on it already
    // Parameters will be automatically reflected in URL due to nuqs
    if (!window.location.pathname.includes('/search')) {
      router.push('/search');
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4">
      <div className="flex gap-2">
        {/* Main search input */}
        <div className="relative flex-1">
          <AnimatedSearchInput
            placeholder={t('search.placeholder','What are you looking for?')}
            value={searchTerm || ''}
            onChange={(e) => setSearchTerm(e.target.value)}
            onSearch={handleSearch}
            className="w-full"
          />
        </div>

        {/* Advanced filters trigger */}
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon">
              <SlidersHorizontal className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>{t('search.advancedFilters','Advanced Filters')}</SheetTitle>
            </SheetHeader>
            <div className="grid gap-4 py-4">
              {/* Category selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('search.category','Category')}</label>
                <Select value={category || ''} onValueChange={setCategory}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('search.selectCategory','Select a category')} />
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

              {/* Subcategory selection */}
              {selectedCategory && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('search.subcategory','Subcategory')}</label>
                  <Select value={subcategory || ''} onValueChange={setSubcategory}>
                    <SelectTrigger>
                      <SelectValue placeholder={t('search.selectSubcategory','Select a subcategory')} />
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
                <label className="text-sm font-medium">{t('search.distanceKm','Distance (km)')}</label>
                <Slider
                  value={[distance]}
                  onValueChange={(value) => setDistance(value[0])}
                  min={1}
                  max={100}
                  step={1}
                />
                <span className="text-sm text-muted-foreground">
                  {t('search.withinDistance','Within {distance} kilometers').replace('{distance}', String(distance))}
                </span>
              </div>

              {/* Apply filters button */}
              <Button onClick={handleSearch} className="w-full">
                {t('search.applyFilters','Apply Filters')}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
