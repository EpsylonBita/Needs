import { render, screen } from '@testing-library/react'
import React from 'react'
import { AdBasicInfoForm } from '@/components/features/ads/ad-basic-info-form'

function mockRegister() {
  return ((name: string) => ({ name, onChange: () => {}, onBlur: () => {}, ref: () => {} })) as any
}

test('renders basic inputs and placeholders', () => {
  render(<AdBasicInfoForm register={mockRegister()} errors={{}} />)
  expect(screen.getByLabelText(/Title/i)).toBeInTheDocument()
  expect(screen.getByLabelText(/Description/i)).toBeInTheDocument()
  expect(screen.getByLabelText(/Set Price/i)).toBeInTheDocument()
  expect(screen.getByLabelText(/Contact Number/i)).toBeInTheDocument()
})