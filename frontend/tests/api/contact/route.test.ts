import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/contact/route';
import { proxy } from '../../../proxy';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  rate: vi.fn(),
  delivery: vi.fn(),
  dispatch: vi.fn(),
  state: 'pending',
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock('@/lib/utils/rate-limit-enhanced', () => ({ rateLimitEnhanced: mocks.rate }));
vi.mock('@/lib/utils/logger', () => ({ log: vi.fn() }));
vi.mock('@/lib/email/contact-email-transport', () => ({ configuredContactEmailDelivery: mocks.delivery }));
vi.mock('@/lib/email/contact-notification', () => ({ dispatchContactNotifications: mocks.dispatch }));

const validMessage = { firstName: 'Maria', lastName: 'Test', email: 'maria@example.com', subject: 'Listing question', message: 'Please help with my listing.' };
const request = (body: unknown, key = '11111111-1111-4111-8111-111111111111') => new NextRequest('http://localhost/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '127.0.0.1', 'Idempotency-Key': key }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://contact-test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'server-test-key');
  mocks.state = 'pending';
  mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ single: async () => ({ data: { notification_status: mocks.state }, error: null }) }) }) });
  mocks.rpc.mockResolvedValue({ data: [{ request_id: '22222222-2222-4222-8222-222222222222', notification_status: 'pending' }], error: null });
  mocks.rate.mockResolvedValue({ allowed: true });
  mocks.delivery.mockReturnValue(null);
  mocks.dispatch.mockResolvedValue({ configured: true, claimed: 1, accepted: 0, pending: 1 });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('Contact message persistence', () => {
  it('persists a validated message and confirms only a successful save', async () => {
    const response = await POST(request({ ...validMessage, firstName: ' Maria ' }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ saved: true, notification: 'unavailable' });
    expect(mocks.rpc).toHaveBeenCalledWith('submit_support_request', expect.objectContaining({
      p_submission_key: '11111111-1111-4111-8111-111111111111', p_payload_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_first_name: 'Maria', p_last_name: 'Test', p_email: 'maria@example.com', p_subject: 'Listing question', p_message: 'Please help with my listing.',
    }));
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it.each([{}, { ...validMessage, email: 'bad-email' }, { ...validMessage, message: 'short' }, { ...validMessage, subject: 'x'.repeat(201) }])('rejects invalid form data', async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('returns a failure rather than claiming an unavailable database saved the message', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'private database diagnostic' } });
    const response = await POST(request(validMessage));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Unable to save your message. Please try again.' });
  });

  it('limits anonymous submissions before persisting data', async () => {
    mocks.rate.mockResolvedValue({ allowed: false, retryAfter: 60 });
    const response = await POST(request(validMessage));
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('is protected by the existing CSRF middleware', async () => {
    const response = await proxy(request(validMessage));
    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('keeps a durable save successful when email delivery or configuration fails', async () => {
    mocks.delivery.mockReturnValue({ to: 'support@example.com' });
    mocks.dispatch.mockRejectedValue(new Error('private provider failure'));
    const response = await POST(request(validMessage));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ saved: true, notification: 'pending' });
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.dispatch.mock.invocationCallOrder[0]);
    mocks.delivery.mockImplementation(() => { throw new Error('private config failure'); });
    expect(await (await POST(request(validMessage))).json()).toMatchObject({ saved: true, notification: 'unavailable' });
  });

  it('reports notification acceptance only after persisted acknowledgement', async () => {
    mocks.delivery.mockReturnValue({ to: 'support@example.com' });
    mocks.state = 'accepted';
    expect(await (await POST(request(validMessage))).json()).toMatchObject({ saved: true, notification: 'accepted' });
  });

  it('rejects invalid/reused submission keys and hashes the normalized content', async () => {
    expect((await POST(request(validMessage, 'bad-key'))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    await POST(request(validMessage));
    const hash = mocks.rpc.mock.calls[0][1].p_payload_hash;
    await POST(request({ ...validMessage, firstName: ' Maria ' }));
    expect(mocks.rpc.mock.calls[1][1].p_payload_hash).toBe(hash);
    mocks.rpc.mockResolvedValue({ error: { code: '22023' } });
    expect((await POST(request({ ...validMessage, subject: 'Changed subject' }))).status).toBe(409);
  });
});
