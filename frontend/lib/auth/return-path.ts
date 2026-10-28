/** Only same-origin absolute paths may cross route or authentication boundaries. */
export function safeInternalPath(value: string | null | undefined, fallback = '/search'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(decoded)) return fallback;
    const url = new URL(value, 'https://needs.internal');
    return url.origin === 'https://needs.internal' ? url.pathname + url.search + url.hash : fallback;
  } catch { return fallback; }
}

const continuationKey = 'needs.auth-continuation';
export function saveAuthContinuation(destination: string, accountId: string | null = null): void {
  try { localStorage.setItem(continuationKey, JSON.stringify({ version: 2, accountId, destination: safeInternalPath(destination, '/dashboard'), expires: Date.now() + 86400000 })); } catch { /* Storage can be disabled; in-page continuation remains available. */ }
}
export function readAuthContinuation(accountId: string | null = null): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(continuationKey) || 'null');
    if (!saved) return null;
    if (saved.version !== 2 || !Number.isFinite(saved.expires) || saved.expires <= Date.now()) { clearAuthContinuation(); return null; }
    return saved.accountId && saved.accountId !== accountId ? null : safeInternalPath(saved.destination, '/dashboard');
  } catch { return null; }
}
/** Claim a guest continuation after successful auth without extending its lifetime. */
export function bindAuthContinuation(accountId: string): void {
  try {
    const saved = JSON.parse(localStorage.getItem(continuationKey) || 'null');
    if (!saved) return;
    if (!readAuthContinuation(accountId)) { clearAuthContinuation(); return; }
    localStorage.setItem(continuationKey, JSON.stringify({ ...saved, accountId }));
  } catch { /* Optional browser storage. */ }
}
export function clearAuthContinuation(): void {
  try { localStorage.removeItem(continuationKey); } catch { /* Optional storage. */ }
}
export function clearAuthContinuationFor(destination: string): void {
  try {
    const saved = JSON.parse(localStorage.getItem(continuationKey) || 'null');
    if (saved?.destination === destination) clearAuthContinuation();
  } catch { /* Optional browser storage. */ }
}
