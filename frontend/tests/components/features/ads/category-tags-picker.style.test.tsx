import { render, screen } from '@testing-library/react'
import React from 'react'
import { CategoryTagsPicker } from '@/components/features/ads/category-tags-picker'

test('selected tags expose their pressed state to assistive technology', () => {
  render(
    <CategoryTagsPicker
      selectedCategory={'Items'}
      selectedSubcategory={''}
      selectedTags={['phone']}
      analysis={{ tags: ['phone'], smartTags: [] }}
      isLoadingTags={false}
      onCategorySelect={() => {}}
      onSubcategorySelect={() => {}}
      onToggleTag={() => {}}
    />
  )
  const selectedTagBtn = screen.getByRole('button', { name: /phone/i })
  expect(selectedTagBtn).toHaveAttribute('aria-pressed', 'true')
  expect(selectedTagBtn).toHaveAttribute('type', 'button')
})
