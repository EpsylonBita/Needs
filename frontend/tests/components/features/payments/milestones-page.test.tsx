import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ locale: 'en', row: {} as Record<string, unknown>, loadError: false, refreshError: false, enabled: true, flagMissing: false, flagError: false, update: vi.fn(), fetch: vi.fn(), profile: 'buyer' }));
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ locale: state.locale }) }));
vi.mock('@/lib/utils/csrf', () => ({ withCsrfHeaders: async (headers: Record<string, string>) => ({ ...headers, 'X-CSRF-Token': 'csrf' }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'auth-user' } } }), getSession: async () => ({ data: { session: { access_token: 'token' } } }) },
  from: (table: string) => {
    let mutation = false;
    const query = {
      select: () => query, eq: () => query, limit: () => query, or: () => query, order: () => query,
      update: (payload: unknown) => { mutation = true; state.update(payload); return query; },
      maybeSingle: async () => ({ data: state.flagMissing ? null : { enabled: state.enabled }, error: state.flagError ? new Error('Flag unavailable') : null }),
      single: async () => ({ data: table === 'profiles' ? { id: state.profile } : table === 'feature_flags' ? (state.flagMissing ? null : { enabled: state.enabled }) : state.row, error: table === 'feature_flags' && (state.flagMissing || state.flagError) ? new Error('Flag unavailable') : table === 'milestones' && state.refreshError ? new Error('Refresh failed') : null }),
      then: (resolve: (value: unknown) => unknown) => (mutation ? state.update.mock.results.at(-1)?.value || Promise.resolve({ error: null }) : Promise.resolve({ data: [state.row], error: state.loadError ? new Error('Offline') : null })).then(resolve),
    };
    return query;
  },
} }));
import MilestonesPage from '@/app/dashboard/milestones/page';

beforeEach(() => {
  vi.clearAllMocks(); state.locale = 'en'; state.profile = 'buyer'; state.loadError = false; state.refreshError = false; state.enabled = true; state.flagMissing = false; state.flagError = false;
  state.row = { id: 'milestone', listing_id: 'listing', title: 'First stage', amount: 25, status: 'requires_capture', stripe_payment_intent: 'pi_test', buyer_id: 'buyer', seller_id: 'seller', buyer_confirmed: false, seller_confirmed: true };
  state.update.mockResolvedValue({ error: null });
  state.fetch.mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', state.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Milestone reliability', () => {
  it('distinguishes load errors from an empty history and supports retry', async () => {
    state.loadError = true;
    render(<MilestonesPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    expect(screen.queryByText('No milestones yet')).not.toBeInTheDocument();
    state.loadError = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('First stage')).toBeInTheDocument();
  });

  it('allows only the current party to confirm and prevents repeated pending requests', async () => {
    let finish!: (result: unknown) => void;
    state.update.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<MilestonesPage />);
    const confirm = await screen.findByRole('button', { name: 'I received this stage' });
    expect(screen.queryByRole('button', { name: 'I completed this stage' })).not.toBeInTheDocument();
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(state.update).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
    state.row.buyer_confirmed = true;
    await act(async () => finish({ error: null }));
    expect(await screen.findByRole('button', { name: 'Your completion is confirmed' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Finalize payment' })).toBeEnabled();
  });

  it('requires a refresh before repeating an action whose state could not be read', async () => {
    state.refreshError = true;
    render(<MilestonesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'I received this stage' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Refresh before trying again');
    expect(screen.getByRole('button', { name: 'I received this stage' })).toBeDisabled();
    state.refreshError = false;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('button', { name: 'I received this stage' })).toBeEnabled();
  });

  it('localizes the status and reports accepted capture without claiming settlement', async () => {
    state.locale = 'el'; state.row.buyer_confirmed = true;
    render(<MilestonesPage />);
    expect(await screen.findByText('Αναμονή ολοκλήρωσης')).toBeInTheDocument();
    expect(screen.queryByText('requires_capture')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Οριστικοποίηση πληρωμής' }));
    await waitFor(() => expect(state.fetch).toHaveBeenCalledWith('/api/payments/capture', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token', 'X-CSRF-Token': 'csrf' }) })));
    expect(await screen.findByRole('status')).toHaveTextContent('επαληθεύεται');
    expect(screen.getByText('Αναμονή ολοκλήρωσης')).toBeInTheDocument();
  });

  it('keeps payment actions unavailable when the feature is disabled', async () => {
    state.enabled = false;
    render(<MilestonesPage />);
    expect(await screen.findByText(/currently unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'I received this stage' })).not.toBeInTheDocument();
  });
});


describe('Unconfigured milestone feature', () => {
  it('shows history with actions disabled when no feature flag was configured', async () => {
    state.flagMissing = true;
    render(<MilestonesPage />);
    expect(await screen.findByText('First stage')).toBeInTheDocument();
    expect(screen.getByText(/currently unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'I received this stage' })).not.toBeInTheDocument();
  });

  it('still reports a real feature flag query error', async () => {
    state.flagError = true;
    render(<MilestonesPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    expect(screen.queryByText('First stage')).not.toBeInTheDocument();
  });
});
