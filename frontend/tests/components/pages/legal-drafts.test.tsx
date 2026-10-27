import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LegalDraftPage from '@/components/pages/legal-draft-page'

const state = vi.hoisted(() => ({ locale: 'en' }))
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ locale: state.locale }) }))
afterEach(cleanup)

describe('Legal draft publication boundary', () => {
  it.each(['el', 'en'])('keeps both %s documents marked as drafts with inactive mock contacts', locale => {
    state.locale = locale
    for (const kind of ['terms', 'privacy'] as const) {
      const { unmount } = render(<LegalDraftPage kind={kind} />)
      expect(screen.getByText(locale === 'el' ? 'ΠΡΟΣΧΕΔΙΟ — ΔΟΚΙΜΑΣΤΙΚΑ ΣΤΟΙΧΕΙΑ' : 'DRAFT — MOCK DETAILS')).toBeInTheDocument()
      expect(screen.getByRole('note')).toHaveTextContent('MOCK')
      expect(screen.getByText('support@needs.invalid')).toBeInTheDocument()
      expect(screen.getByText('privacy@needs.invalid')).toBeInTheDocument()
      expect(screen.getAllByRole('link')).toHaveLength(1)
      expect(screen.getByRole('link')).toHaveAttribute('href', '/contact')
      unmount()
    }
  })
})
