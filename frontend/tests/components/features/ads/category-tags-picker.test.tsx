import { render, screen } from '@testing-library/react'
import React from 'react'
import { CategoryTagsPicker } from '@/components/features/ads/category-tags-picker'

test('renders category and subcategory select', () => {
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
  expect(screen.getAllByText(/Category/i).length).toBeGreaterThan(0)
  expect(screen.getAllByText(/Subcategory/i).length).toBeGreaterThan(0)
  expect(screen.getByText('phone')).toBeInTheDocument()
})