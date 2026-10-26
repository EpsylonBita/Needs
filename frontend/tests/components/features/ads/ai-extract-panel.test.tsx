import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { AiExtractPanel } from '@/components/features/ads/ai-extract-panel'

test('calls onAnalyze when Extract details is clicked', async () => {
  const user = userEvent.setup()
  const onAnalyze = vi.fn()
  render(<AiExtractPanel nlpInput={'test input'} isAnalyzing={false} analysisSuccess={false} onChange={() => {}} onAnalyze={onAnalyze} />)
  const btn = screen.getByRole('button', { name: /Extract details/i })
  await user.click(btn)
  expect(onAnalyze).toHaveBeenCalled()
})
