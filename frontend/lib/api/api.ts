import type { Category } from '@/types/category'

const CATEGORIES: Category[] = [
  {
    _id: 'items',
    name: 'Items',
    slug: 'items',
    description: 'Physical goods listed for sale or free.',
    imageUrl: '',
    subcategories: [
      { _id: 'buy', name: 'Buy', slug: 'buy', description: '', imageUrl: '', categoryId: 'items' },
      { _id: 'sell', name: 'Sell', slug: 'sell', description: '', imageUrl: '', categoryId: 'items' },
      { _id: 'free', name: 'Free', slug: 'free', description: '', imageUrl: '', categoryId: 'items' },
    ],
  },
  {
    _id: 'services',
    name: 'Services',
    slug: 'services',
    description: 'On-demand services offered or requested.',
    imageUrl: '',
    subcategories: [
      { _id: 'i-want', name: 'I want', slug: 'i-want', description: '', imageUrl: '', categoryId: 'services' },
      { _id: 'i-will', name: 'I will', slug: 'i-will', description: '', imageUrl: '', categoryId: 'services' },
      { _id: 'i-can', name: 'I can', slug: 'i-can', description: '', imageUrl: '', categoryId: 'services' },
    ],
  },
]

export async function getCategories(): Promise<Category[]> {
  return CATEGORIES
}

export async function getCategoryBySlug(slug: string): Promise<Category> {
  const found = CATEGORIES.find((c) => c.slug === slug)
  if (!found) throw new Error('Category not found')
  return found
}