import { Suspense } from 'react';
import { getCategories } from '@/lib/api/api';
import { LoadingCategories } from './loading';
import { ClientCategoriesPage } from '@/components/categories/client-categories-page';

// Define metadata
export const metadata = {
  title: 'Categories | .needs',
  description: 'Browse all categories of products and services available on .needs',
};

// Force streaming for better UX
export const dynamic = 'force-dynamic';
export const revalidate = 3600; // Revalidate every hour

// Function to fetch categories with error handling
async function fetchCategories() {
  try {
    const categories = await getCategories();
    return categories;
  } catch (error) {
    console.error('Error fetching categories:', error);
    return [];
  }
}

export default async function CategoriesPage() {
  // Use Promise to enable streaming of UI before data is loaded
  const categoriesPromise = fetchCategories();

  return (
    <div className="container mx-auto px-4 py-8">
      <section className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Categories</h1>
        <p className="text-muted-foreground">
          Browse all categories of products and services available on our platform
        </p>
      </section>
      
      {/* Use Suspense to show a loading state while categories are being fetched */}
      <Suspense fallback={<LoadingCategories />}>
        <CategoriesContent categoriesPromise={categoriesPromise} />
      </Suspense>
    </div>
  );
}

// Separate component to handle the async data
async function CategoriesContent({ 
  categoriesPromise 
}: { 
  categoriesPromise: Promise<any[]> 
}) {
  const categories = await categoriesPromise;
  
  return <ClientCategoriesPage categories={categories} />;
} 