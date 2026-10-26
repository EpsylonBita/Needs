export type AuthEmailPath = '/auth/confirm' | '/auth/reset-password';

export function authEmailRedirectUrl(path: AuthEmailPath, origin?: string): string {
  const base = origin || (typeof window !== 'undefined' ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL);
  if (!base) throw new Error('The application URL is not configured');
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('The application URL is invalid');
  return new URL(path, url.origin).toString();
}

export function handlesAuthEmailUrl(pathname: string): boolean {
  return ['/auth/confirm', '/auth/reset-password'].includes(pathname.replace(/\/$/, ''));
}
