import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { CategoryTagsPicker } from '@/components/features/ads/category-tags-picker'

function pickerProps(overrides: Partial<React.ComponentProps<typeof CategoryTagsPicker>> = {}) {
  return {
    selectedCategory: 'Items', selectedSubcategory: '', selectedTags: [],
    analysis: { tags: [], smartTags: [] }, isLoadingTags: false,
    onCategorySelect: vi.fn(), onSubcategorySelect: vi.fn(), onToggleTag: vi.fn(),
    ...overrides,
  }
}

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

test('native selects pass canonical values while displaying understandable labels', async () => {
  const user = userEvent.setup()
  const props = pickerProps()
  render(<CategoryTagsPicker {...props} />)
  await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'Services')
  expect(props.onCategorySelect).toHaveBeenCalledWith('Services')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Listing type' }), 'Sell')
  expect(props.onSubcategorySelect).toHaveBeenCalledWith('Sell')
  expect(screen.getByRole('option', { name: 'I am selling an item' })).toHaveValue('Sell')
})

test('a suggested tag can be removed and added again by keyboard without duplicate chips', async () => {
  const user = userEvent.setup()
  function ControlledPicker() {
    const [tags, setTags] = React.useState(['phone'])
    return <CategoryTagsPicker {...pickerProps({ selectedTags: tags, analysis: { tags: ['phone'], smartTags: ['phone'] },
      onToggleTag: tag => setTags(current => current.includes(tag) ? current.filter(value => value !== tag) : [...current, tag]),
    })} />
  }
  render(<ControlledPicker />)
  expect(screen.getAllByRole('button', { name: 'phone' })).toHaveLength(1)
  const chip = screen.getByRole('button', { name: 'phone' })
  chip.focus()
  await user.keyboard('{Enter}')
  expect(chip).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByText('0/20 selected')).toBeInTheDocument()
  await user.keyboard(' ')
  expect(chip).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText('1/20 selected')).toBeInTheDocument()
})

test('Enter adds a trimmed custom tag without submitting the surrounding listing form', async () => {
  const user = userEvent.setup()
  const onAddTag = vi.fn()
  const onPublish = vi.fn()
  render(<form onSubmit={event => { event.preventDefault(); onPublish() }}>
    <CategoryTagsPicker {...pickerProps({ onAddTag })} />
    <button type="submit">Publish listing</button>
  </form>)
  await user.click(screen.getByText('Edit tags'))
  const input = screen.getByRole('textbox', { name: 'Your own tag' })
  await user.type(input, '  wooden  {Enter}')
  expect(onAddTag).toHaveBeenCalledExactlyOnceWith('wooden')
  expect(input).toHaveValue('')
  expect(onPublish).not.toHaveBeenCalled()
  await user.keyboard('{Enter}')
  expect(onAddTag).toHaveBeenCalledTimes(1)
  expect(onPublish).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Publish listing' }))
  expect(onPublish).toHaveBeenCalledTimes(1)
})

test('twenty selected tags block more additions but still allow removal', async () => {
  const user = userEvent.setup()
  function ControlledPicker() {
    const [tags, setTags] = React.useState(Array.from({ length: 19 }, (_, index) => `tag-${index}`))
    return <CategoryTagsPicker {...pickerProps({ selectedTags: tags, analysis: { tags: [], smartTags: ['suggestion'] },
      onAddTag: tag => setTags(current => [...current, tag]),
      onToggleTag: tag => setTags(current => current.includes(tag) ? current.filter(value => value !== tag) : [...current, tag]),
    })} />
  }
  render(<ControlledPicker />)
  await user.click(screen.getByText('Edit tags'))
  const input = screen.getByRole('textbox', { name: 'Your own tag' })
  await user.type(input, 'last{Enter}')
  expect(screen.getByText('20/20 selected')).toBeInTheDocument()
  await user.type(input, 'one more')
  expect(screen.getByRole('button', { name: 'Add tag' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'suggestion' })).toBeDisabled()
  await user.keyboard('{Enter}')
  expect(screen.queryByRole('button', { name: 'one more' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'last' }))
  expect(screen.getByRole('button', { name: 'Add tag' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'suggestion' })).toBeEnabled()
})

test('custom tags reject blanks and case-insensitive duplicates and cap input at fifty characters', async () => {
  const user = userEvent.setup()
  const onAddTag = vi.fn()
  render(<CategoryTagsPicker {...pickerProps({ selectedTags: ['wooden'], onAddTag })} />)
  await user.click(screen.getByText('Edit tags'))
  const input = screen.getByRole('textbox', { name: 'Your own tag' })
  const add = screen.getByRole('button', { name: 'Add tag' })
  await user.type(input, '   {Enter}')
  expect(add).toBeDisabled()
  await user.clear(input)
  await user.type(input, ' WOODEN {Enter}')
  expect(add).toBeDisabled()
  expect(onAddTag).not.toHaveBeenCalled()
  await user.clear(input)
  await user.type(input, 'a'.repeat(51))
  expect(input).toHaveValue('a'.repeat(50))
  await user.click(add)
  expect(onAddTag).toHaveBeenCalledExactlyOnceWith('a'.repeat(50))
})

test('category and listing-type errors are associated with their controls', () => {
  render(<CategoryTagsPicker {...pickerProps({ selectedCategory: '', categoryError: 'Choose a category.', subcategoryError: 'Choose a listing type.' })} />)
  expect(screen.getByRole('combobox', { name: 'Category' })).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByRole('combobox', { name: 'Category' })).toHaveAccessibleDescription('Choose a category.')
  expect(screen.getByRole('combobox', { name: 'Listing type' })).toBeDisabled()
  expect(screen.getByRole('combobox', { name: 'Listing type' })).toHaveAccessibleDescription('Choose a listing type.')
  expect(screen.getAllByRole('alert')).toHaveLength(2)
})
