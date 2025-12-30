import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { ImageUploader } from '@/components/features/ads/image-uploader'

test('renders previews and triggers remove', async () => {
  const user = userEvent.setup()
  const onRemove = vi.fn()
  render(<ImageUploader imagePreviews={["/a.jpg"]} onRemove={onRemove} onChange={() => {}} />)
  const btn = await screen.findByRole('button', { name: /Remove image/i })
  await user.click(btn)
  expect(onRemove).toHaveBeenCalledWith(0)
})