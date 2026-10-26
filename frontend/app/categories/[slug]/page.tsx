import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getCategoryBySlug } from '@/lib/api/api';
import { LoadingSubcategories } from './loading';
import { SubcategoryList } from '../../../components/categories/subcategory-list';

export const revalidate = 3600; // Revalidate every hour

type Props = {
  params: Promise<{ slug: string }>
}

export default async function CategoryPage({ params }: Props) {
  const { slug } = await params;
  if (!slug) {
    notFound();
  }

  try {
    const category = await getCategoryBySlug(slug);

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
