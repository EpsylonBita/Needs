import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Calendar } from '@/components/ui/calendar'

describe('calendar after DayPicker upgrade', () => {
  it('keeps date selection and month navigation functional', () => {
    const select = vi.fn()
    render(<Calendar mode="single" defaultMonth={new Date(2026, 9, 1)} onSelect={select} />)
    fireEvent.click(screen.getByRole('button', { name: /October 14/ }))
    const selected = select.mock.calls[0][0] as Date
    expect([selected.getFullYear(), selected.getMonth(), selected.getDate()]).toEqual([2026, 9, 14])
    fireEvent.click(screen.getByRole('button', { name: /next month/i }))
    expect(screen.getByText('November 2026')).toBeInTheDocument()
  })
})
