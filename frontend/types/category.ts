export interface Category {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  imageUrl?: string;
  subcategories: Subcategory[];
}

export interface Subcategory {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  imageUrl?: string;
  categoryId: string;
} 