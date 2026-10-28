/**
 * Verified seed identity, not a title/price/profile heuristic.
 * Source: needs-runtime-backups/demo-athens-20261014-manifest.json and
 * create-demo-profile-20261014.mjs; verified against the configured project.
 * Existing descriptions explicitly say these examples are not for transactions.
 * Keep this project binding when adding other environments or seed batches.
 */
export const DEMO_PROJECT_ID = 'qczrqxmewjsydrrvjdil'
export const DEMO_BATCH = 'needs-demo-athens-20261014'
export const DEMO_LISTING_IDS = [
  '84cb699f-6bcd-46d1-8a48-b011ccb69bb9',
  'b471ea17-951b-4b69-b1b7-4adca7a9f834',
  '16c556c6-4413-48be-bc03-cd4de48b46df',
  '9747633d-79e7-404f-a2e5-b64e365d33bb',
  '8588184d-d6e1-4b66-aa11-5eb3128de7d2',
  '3de235ad-2a89-4ae0-a101-14495078ce04',
  'a03c17b8-51f5-47ab-ad11-d86427c89e87',
  '6f193a95-70ca-4cea-9d45-7e4d790fe1d4',
] as const
const demoIds: ReadonlySet<string> = new Set(DEMO_LISTING_IDS)

export function isDemoListing(id: string | null | undefined, backendUrl = process.env.NEXT_PUBLIC_SUPABASE_URL): boolean {
  if (!id || !demoIds.has(id.toLowerCase()) || !backendUrl) return false
  try { return new URL(backendUrl).hostname === `${DEMO_PROJECT_ID}.supabase.co` } catch { return false }
}

export const DEMO_TRANSACTION_ERROR = 'This demo listing is not available for transactions.'
export const demoListingCopy = {
  en: { badge: 'Demo listing', unavailable: 'Not available for transactions', explanation: 'This listing is an example. You can explore it, but cannot start a conversation or transaction for it.' },
  el: { badge: 'Δοκιμαστική αγγελία', unavailable: 'Δεν διατίθεται για συναλλαγή', explanation: 'Αυτή η αγγελία είναι δείγμα. Μπορείς να την εξερευνήσεις, αλλά δεν μπορείς να ξεκινήσεις συνομιλία ή συναλλαγή για αυτήν.' },
} as const
