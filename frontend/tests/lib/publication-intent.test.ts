import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindPendingPublication, clearPendingPublication, publicationResumePath, publicationSelection, readPendingPublication, savePendingPublication } from '@/lib/listings/publication-intent';
import { bindAuthContinuation, readAuthContinuation, safeInternalPath } from '@/lib/auth/return-path';

beforeEach(() => { localStorage.clear(); vi.useRealTimers(); });

describe('publication continuation', () => {
  it('does not expose an account-bound draft to another account or a signed-out visitor', () => {
    savePendingPublication({ query: 'private draft', returnTo: '/search?q=private' }, 'account-a');
    expect(readPendingPublication('account-a')?.query).toBe('private draft');
    expect(readPendingPublication('account-b')).toBeNull();
    expect(readPendingPublication()).toBeNull();
  });
  it.each([
    ['request', 'Items', 'Buy'], ['offer', 'Items', 'Sell'],
    ['request', 'Services', 'I want'], ['offer', 'Services', 'I will'],
  ] as const)('uses the existing %s / %s listing type', (intent, category, subcategory) => {
    expect(publicationSelection(intent, category)).toEqual({ category, subcategory });
  });

  it('keeps an editable search draft and the original search URL through an email round trip', () => {
    const draft = savePendingPublication({ intent: 'request', query: '  κιθάρα  ', category: 'Items', tags: [' acoustic '], location: 'Αθήνα', coordinates: '23.7275,37.9838', returnTo: '/search?q=κιθάρα&distance=10&page=2' });
    expect(readPendingPublication()).toEqual({ ...draft, query: 'κιθάρα', tags: ['acoustic'] });
    const destination = new URL(readAuthContinuation()!, 'https://needs.internal');
    expect(destination.pathname).toBe('/search');
    expect(destination.searchParams.get('q')).toBe('κιθάρα');
    expect(destination.searchParams.get('page')).toBe('2');
    expect(destination.searchParams.get('resumeListing')).toBe('1');
  });

  it('bounds stored context and rejects invalid centers or external return destinations', () => {
    const draft = savePendingPublication({ intent: 'request', query: 'a'.repeat(300), category: 'bad', tags: Array.from({ length: 30 }, () => 'x'.repeat(80)), coordinates: '181,91', returnTo: '//external.test' });
    expect(draft.query).toHaveLength(200);
    expect(draft.tags).toHaveLength(20);
    expect(draft.tags?.[0]).toHaveLength(50);
    expect(draft.coordinates).toBeUndefined();
    expect(publicationResumePath(draft)).toBe('/?resumeListing=1');
    clearPendingPublication();
    expect(readPendingPublication()).toBeNull();
  });

  it('expires the saved action after a day', () => {
    vi.useFakeTimers();
    savePendingPublication({ returnTo: '/search', intent: 'offer' });
    vi.advanceTimersByTime(86400001);
    expect(readPendingPublication()).toBeNull();
    expect(readAuthContinuation()).toBeNull();
  });
  it('claims the guest draft after auth without extending the original 24-hour expiry', () => {
    vi.useFakeTimers();
    savePendingPublication({ returnTo: '/search?q=guitar', query: 'guitar', intent: 'request' });
    vi.advanceTimersByTime(86399000);
    bindPendingPublication('account-a'); bindAuthContinuation('account-a');
    expect(readPendingPublication('account-a')).toMatchObject({ query: 'guitar', intent: 'request', accountId: 'account-a' });
    expect(readAuthContinuation('account-a')).toContain('resumeListing=1');
    expect(readAuthContinuation('account-b')).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(readPendingPublication('account-a')).toBeNull();
    expect(readAuthContinuation('account-a')).toBeNull();
    expect(localStorage.getItem('needs.pending-publication')).toBeNull();
  });
  it('clears an old account draft on a new account login and discards unverifiable legacy records', () => {
    savePendingPublication({ returnTo: '/search?q=private', query: 'private' }, 'account-a');
    bindPendingPublication('account-b'); bindAuthContinuation('account-b');
    expect(readPendingPublication('account-b')).toBeNull();
    expect(readAuthContinuation('account-b')).toBeNull();
    localStorage.setItem('needs.pending-publication', JSON.stringify({ draft: { query: 'legacy private', returnTo: '/' }, expires: Date.now() + 86400000 }));
    expect(readPendingPublication()).toBeNull();
  });
});

describe('safe internal destinations', () => {
  it.each(['https://outside.test', '//outside.test', '/\\outside.test', '/%5coutside.test', '/%2foutside.test', '/%0d%0aoutside.test', '/bad%zz', '/\n/outside.test'])('rejects %j', destination => {
    expect(safeInternalPath(destination, '/dashboard')).toBe('/dashboard');
  });
  it('retains filters and encoded nested internal destinations', () => {
    expect(safeInternalPath('/login?redirectTo=%2Fsearch%3Fq%3Dguitar')).toBe('/login?redirectTo=%2Fsearch%3Fq%3Dguitar');
  });
});
