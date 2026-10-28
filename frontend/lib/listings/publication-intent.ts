import { clearAuthContinuationFor, safeInternalPath, saveAuthContinuation } from '@/lib/auth/return-path';

export type PublicationIntent = 'request' | 'offer';
export interface PublicationDraft {
  query?: string;
  category?: string;
  tags?: string[];
  coordinates?: string;
  location?: string;
}
export interface PendingPublication extends PublicationDraft {
  intent?: PublicationIntent;
  returnTo: string;
  accountId?: string;
  expiresAt?: number;
}
const draftKey = 'needs.pending-publication';

export function publicationSelection(intent?: PublicationIntent, category?: string) {
  if (!intent) return { category: '', subcategory: '' };
  const selected = category === 'Services' ? 'Services' : 'Items';
  return { category: selected, subcategory: selected === 'Services' ? (intent === 'request' ? 'I want' : 'I will') : (intent === 'request' ? 'Buy' : 'Sell') };
}

export function publicationCoordinates(value?: string): [number, number] | null {
  if (!value || !/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(value)) return null;
  const [lng, lat] = value.split(',').map(Number);
  return Math.abs(lng) <= 180 && Math.abs(lat) <= 90 ? [lng, lat] : null;
}

function normalize(draft: PendingPublication): PendingPublication {
  return {
    intent: draft.intent === 'request' || draft.intent === 'offer' ? draft.intent : undefined,
    query: typeof draft.query === 'string' ? draft.query.trim().slice(0, 200) : '',
    category: draft.category === 'Services' || draft.category === 'Items' ? draft.category : '',
    tags: Array.isArray(draft.tags) ? draft.tags.filter((tag): tag is string => typeof tag === 'string' && !!tag.trim()).map(tag => tag.trim().slice(0, 50)).slice(0, 20) : [],
    coordinates: publicationCoordinates(draft.coordinates) ? draft.coordinates : undefined,
    location: typeof draft.location === 'string' ? draft.location.trim().slice(0, 300) : '',
    returnTo: safeInternalPath(draft.returnTo, '/'),
  };
}

export function publicationResumePath(draft: PendingPublication): string {
  const url = new URL(safeInternalPath(draft.returnTo, '/'), 'https://needs.internal');
  url.searchParams.set('resumeListing', '1');
  return url.pathname + url.search + url.hash;
}

export function savePendingPublication(draft: PendingPublication, accountId: string | null = null): PendingPublication {
  const normalized = normalize(draft);
  const expiresAt = Date.now() + 86400000;
  try { localStorage.setItem(draftKey, JSON.stringify({ version: 2, accountId, draft: normalized, expires: expiresAt })); } catch { /* The current dialog can continue without browser storage. */ }
  saveAuthContinuation(publicationResumePath(normalized), accountId);
  return { ...normalized, expiresAt, ...(accountId ? { accountId } : {}) };
}
/** The active auth dialog must obey the same deadline even when storage is disabled. */
export function isPublicationDraftCurrent(draft: PendingPublication, accountId?: string | null): boolean {
  return (draft.expiresAt === undefined || (Number.isFinite(draft.expiresAt) && draft.expiresAt > Date.now()))
    && (!draft.accountId || draft.accountId === accountId);
}
export function readPendingPublication(accountId: string | null = null): PendingPublication | null {
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey) || 'null');
    if (!saved) return null;
    // Older unbound records cannot distinguish a guest from a previous account.
    if (saved.version !== 2 || !saved.draft || !Number.isFinite(saved.expires) || saved.expires <= Date.now()) { clearPendingPublication(); return null; }
    if (saved.accountId && saved.accountId !== accountId) return null;
    return { ...normalize(saved.draft), expiresAt: saved.expires, ...(saved.accountId ? { accountId: saved.accountId } : {}) };
  } catch { return null; }
}
/** Bind only on successful authentication, preserving the original expiry. */
export function bindPendingPublication(accountId: string): void {
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey) || 'null');
    if (!saved) return;
    if (!readPendingPublication(accountId)) { clearPendingPublication(); return; }
    localStorage.setItem(draftKey, JSON.stringify({ ...saved, accountId }));
  } catch { /* Optional browser storage. */ }
}
export function clearPendingPublication(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey) || 'null');
    localStorage.removeItem(draftKey);
    if (saved?.draft?.returnTo) clearAuthContinuationFor(publicationResumePath(saved.draft));
  } catch { /* Optional browser storage. */ }
}
