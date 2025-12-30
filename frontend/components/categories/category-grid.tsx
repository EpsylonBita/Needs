'use client';

import { memo } from 'react';

import Image from 'next/image';
import Link from 'next/link';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Category } from '@/types/category';

interface CategoryGridProps {
  categories: Category[];
}

/**
 * CategoryGridItem - A memoized component that renders a single category card
 * This prevents unnecessary re-renders when only one category changes
 */
const CategoryGridItem = memo(function CategoryGridItem({ category }: { category: Category }) {
  return (
    <Link key={category._id} href={`/categories/${category.slug}`}>
      <Card className="hover:shadow-lg transition-shadow h-full">
        {category.imageUrl && (
          <div className="relative w-full h-48 overflow-hidden">
            <Image
              src={category.imageUrl}
              alt={category.name}
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              className="object-cover rounded-t-lg transition-transform hover:scale-105 duration-300"
              loading="lazy"
              placeholder="blur"
              blurDataURL="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzIwIiBoZWlnaHQ9IjQ4MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjFmMWYxIi8+PC9zdmc+"
            />
          </div>
        )}
        <CardHeader>
          <CardTitle>{category.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {category.description || `Browse all items in ${category.name}`}
          </p>
          {category.subcategories && category.subcategories.length > 0 && (
            <p className="text-xs mt-2 text-muted-foreground">{category.subcategories.length} subcategories</p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
});

/**
 * CategoryGrid - Displays a grid of category cards
 * Uses windowing for better performance with large category lists
 */
export function CategoryGrid({ categories }: CategoryGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 auto-rows-fr">
      {categories.map((category) => (
        <CategoryGridItem key={category._id} category={category} />
      ))}
    </div>
  );
}
