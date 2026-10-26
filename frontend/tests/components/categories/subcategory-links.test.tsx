import { render, screen } from '@testing-library/react'
import { SubcategoryList } from '@/components/categories/subcategory-list'
import { getCategories } from '@/lib/api/api'

test('every category card opens existing discovery routes with its exact listing-type filter', async () => {
  const categories = await getCategories()
  render(<SubcategoryList subcategories={categories.flatMap(category => category.subcategories)} />)

  const destinations = [
    ['Buy', '/items', 'Buy'], ['Sell', '/items', 'Sell'], ['Free', '/items', 'Free'],
    ['I want', '/services', 'I want'], ['I will', '/services', 'I will'], ['I can', '/services', 'I can'],
  ]
  for (const [label, route, type] of destinations) {
    const link = screen.getByRole('link', { name: label })
    const url = new URL(link.getAttribute('href')!, 'http://localhost')
    expect(url.pathname).toBe(route)
    expect(url.searchParams.get('subcategory')).toBe(type)
  }
})
