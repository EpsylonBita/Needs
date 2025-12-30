import { Suspense } from 'react';
import { getCategoryBySlug } from '@/lib/api/api';
import { SubcategoryList } from '../../../components/categories/subcategory-list';
import { LoadingSubcategories } from './loading';
import { notFound } from 'next/navigation';

export const revalidate = 3600; // Revalidate every hour

type Props = {
  params: { slug: string }
}

export default async function CategoryPage({ params }: Props) {
  if (!params.slug) {
    notFound();
  }

  try {
    const category = await getCategoryBySlug(params.slug);

    return (
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-4">{category.name}</h1>
        {category.description && (
          <p className="text-muted-foreground mb-8">{category.description}</p>
        )}
        <Suspense fallback={<LoadingSubcategories />}>
          <SubcategoryList subcategories={category.subcategories} />
        </Suspense>
      </div>
    );
  } catch (error) {
    notFound();
  }
} 