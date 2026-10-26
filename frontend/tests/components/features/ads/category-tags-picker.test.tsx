import { render, screen } from '@testing-library/react'
import React from 'react'
import { CategoryTagsPicker } from '@/components/features/ads/category-tags-picker'

test('renders labeled category and listing type selects with suggested tags', () => {
  render(
    <CategoryTagsPicker
      selectedCategory={'Items'}
      selectedSubcategory={''}
      selectedTags={[]}
      analysis={{ tags: ['phone', 'laptop'], smartTags: [] }}
      isLoadingTags={false}
      onCategorySelect={() => {}}
      onSubcategorySelect={() => {}}
      onToggleTag={() => {}}
    />
  )
  expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue('Items')
  expect(screen.getByRole('combobox', { name: 'Listing type' })).toHaveValue('')
  expect(screen.getByRole('region', { name: 'Smart tags' })).toBeInTheDocument()
  expect(screen.getByText('phone')).toBeInTheDocument()
})
