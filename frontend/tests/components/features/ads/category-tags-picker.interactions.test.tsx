import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { CategoryTagsPicker } from '@/components/features/ads/category-tags-picker'

test('toggles tag selection via button click', async () => {
  const user = userEvent.setup()
  const onToggleTag = vi.fn()
  render(
    <CategoryTagsPicker
      selectedCategory={'Items'}
      selectedSubcategory={''}
      selectedTags={[]}
      analysis={{ tags: ['phone'], smartTags: [] }}
      isLoadingTags={false}
      onCategorySelect={() => {}}
      onSubcategorySelect={() => {}}
      onToggleTag={onToggleTag}
    />
  )
  const tagBtn = screen.getByRole('button', { name: /phone/i })
  await user.click(tagBtn)
  expect(onToggleTag).toHaveBeenCalledWith('phone')
})