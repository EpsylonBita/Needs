import { describe, expect, it } from 'vitest'
import { DEMO_LISTING_IDS, DEMO_PROJECT_ID, isDemoListing } from '@/lib/listings/demo-policy'

describe('verified demonstration identities', () => {
  const backend = `https://${DEMO_PROJECT_ID}.supabase.co`
  it('recognizes only the eight sourced IDs in their configured project', () => {
    expect(DEMO_LISTING_IDS).toHaveLength(8)
    for (const id of DEMO_LISTING_IDS) {
      expect(isDemoListing(id, backend)).toBe(true)
      expect(isDemoListing(id.toUpperCase(), backend)).toBe(true)
    }
    for (const id of ['real-listing', 'Demo listing', '', undefined]) expect(isDemoListing(id, backend)).toBe(false)
  })
  it('does not carry the registry into another environment or a lookalike host', () => {
    for (const backend of ['https://another-project.supabase.co', 'https://qczrqxmewjsydrrvjdil.supabase.co.evil.invalid', 'http://127.0.0.1:54321', 'invalid', '']) {
      expect(isDemoListing(DEMO_LISTING_IDS[0], backend)).toBe(false)
    }
  })
})
