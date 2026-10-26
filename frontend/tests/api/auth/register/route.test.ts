import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ signUp: vi.fn(), profileWrite: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { signUp: mocks.signUp } }) }));
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: { from: mocks.profileWrite } }));
vi.mock('@/lib/utils/logger', () => ({ log: vi.fn() }));
vi.mock('@/lib/utils/rate-limit-enhanced', () => ({
  rateLimitEnhanced: async () => ({ allowed: true }),
  RateLimitConfigs: { REGISTER: { key: (ip: string) => ip, limit: 5, windowMs: 60000, message: 'Try later' } },
}));

import { POST } from '@/app/api/auth/register/route';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://needs.example');
  mocks.signUp.mockResolvedValue({ data: { user: { id: 'unconfirmed-id' }, session: null }, error: null });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('registration email contract', () => {
  it('uses the configured callback and reports that email confirmation is required', async () => {
    const response = await POST(new NextRequest('http://localhost/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'member@example.com', password: 'StrongPass123!', fullName: 'Member Name', phoneNumber: '+491234567890' }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ requiresEmailConfirmation: true });
    expect(mocks.signUp).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ emailRedirectTo: 'https://needs.example/auth/confirm' }) }));
    expect(mocks.profileWrite).not.toHaveBeenCalled();
  });
});
