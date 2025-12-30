'use client';

import Image from 'next/image';
import Link from 'next/link';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Subcategory } from '@/types/category';

interface SubcategoryListProps {
  subcategories: Subcategory[];
}

export function SubcategoryList({ subcategories }: SubcategoryListProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {subcategories.map((subcategory) => (
        <Link 
          key={subcategory._id} 
          href={`/categories/${subcategory.categoryId}/${subcategory.slug}`}
        >
          <Card className="hover:shadow-lg transition-shadow">
            {subcategory.imageUrl && (
              <div className="relative w-full h-48">
                <Image
                  src={subcategory.imageUrl}
                  alt={subcategory.name}
                  fill
                  className="object-cover rounded-t-lg"
                />
              </div>
            )}
            <CardHeader>
              <CardTitle>{subcategory.name}</CardTitle>
            </CardHeader>
            {subcategory.description && (
              <CardContent>
                <p className="text-muted-foreground">{subcategory.description}</p>
              </CardContent>
            )}
          </Card>
        </Link>
      ))}
    </div>
  );
} 
