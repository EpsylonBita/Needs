'use client';

import { Suspense, lazy } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { Category } from '@/types/category';

// Dynamically import the CategoryGrid for better code splitting
const CategoryGrid = lazy(() => import('./category-grid').then(mod => ({ default: mod.CategoryGrid })));

interface ClientCategoriesPageProps {
  categories: Category[];
}

/**
 * ClientCategoriesPage - A client component that wraps the category grid
 * 
 * Features:
 * - Uses lazy loading for better code splitting and performance
 * - Wraps the CategoryGrid in a Suspense boundary for loading states
 * - This separation allows the parent page.tsx to be a server component
 * 
 * @param categories The list of categories to display
 */
export function ClientCategoriesPage({ categories }: ClientCategoriesPageProps) {
  return (
    <Suspense fallback={
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[300px] w-full rounded-md" />
        ))}
      </div>
    }>
      <CategoryGrid categories={categories} />
    </Suspense>
  );
} 
