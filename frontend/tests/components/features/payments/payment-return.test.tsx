import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ locale: 'en', fetch: vi.fn(), payment: {} as Record<string, unknown>, refreshed: null as Record<string, unknown> | null, refreshError: false, loadError: false }));
vi.mock('@/contexts/i18n-context', () => ({ useI18n: () => ({ locale: state.locale }) }));
vi.mock('@/lib/utils/csrf', () => ({ withCsrfHeaders: async (headers: Record<string, string>) => ({ ...headers, 'X-CSRF-Token': 'csrf' }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'auth-buyer' } } }), getSession: async () => ({ data: { session: { access_token: 'token' } } }) },
  from: (table: string) => {
    const query = {
      select: () => query, eq: () => query, limit: () => query, or: () => query, order: () => query,
      single: async () => ({ data: table === 'profiles' ? { id: 'buyer' } : state.refreshed || state.payment, error: table === 'payments' && state.refreshError ? new Error('Offline') : null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [state.payment], error: state.loadError ? new Error('Offline') : null }).then(resolve),
    };
    return query;
  },
} }));
import PaymentReturnPage from '@/app/payments/return/page';

beforeEach(() => {
  vi.clearAllMocks(); state.locale = 'en'; state.refreshed = null; state.refreshError = false; state.loadError = false;
  state.payment = { id: 'payment', status: 'requires_capture', amount: 25, currency: 'eur', buyer_id: 'buyer', seller_id: 'seller', stripe_payment_intent: 'pi_test', buyer_confirmed: true, seller_confirmed: true };
  state.fetch.mockResolvedValue({ ok: true, status: 202, json: async () => ({ captured: false, pending: true, status: 'verification_pending' }) });
  vi.stubGlobal('fetch', state.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Payment return localization and verification', () => {
  it('shows accepted 202 capture as pending, locks submission, and refreshes verified completion', async () => {
    render(<PaymentReturnPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Finalize payment' }));
    expect(await screen.findByRole('status')).toHaveTextContent('still being verified');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Awaiting completion')).toBeInTheDocument();
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finalize payment' })).toBeDisabled();
    state.payment.status = 'completed';
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    expect(await screen.findByText('Completed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finalize payment' })).not.toBeInTheDocument();
    expect(state.fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves successful capture and reads its actual stored status', async () => {
    state.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ captured: true, pending: false }) });
    state.refreshed = { ...state.payment, status: 'completed' };
    render(<PaymentReturnPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Finalize payment' }));
    expect(await screen.findByText('Completed')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('localizes status, currency, actions and pending feedback in Greek', async () => {
    state.locale = 'el';
    render(<PaymentReturnPage />);
    expect(await screen.findByText('Αναμονή ολοκλήρωσης')).toBeInTheDocument();
    expect(screen.getByText(/25,00.*€/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Κατάσταση πληρωμής' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Οι πληρωμές μου' })).toHaveAttribute('href', '/dashboard/payments');
    fireEvent.click(screen.getByRole('button', { name: 'Οριστικοποίηση πληρωμής' }));
    expect(await screen.findByRole('status')).toHaveTextContent('επαληθεύεται ακόμη');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('requires_capture')).not.toBeInTheDocument();
  });

  it('does not claim captured when the post-request refresh fails', async () => {
    state.refreshError = true;
    render(<PaymentReturnPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Finalize payment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('request was received');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Payment captured');
    expect(screen.getByRole('button', { name: 'Finalize payment' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh status' })).toBeEnabled();
  });

  it('handles structured capture failures without presenting pending or success', async () => {
    state.locale = 'el';
    state.fetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: { message: 'This older request payment needs administrator review before it can be captured.' } }) });
    render(<PaymentReturnPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Οριστικοποίηση πληρωμής' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('έλεγχο από διαχειριστή');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('Αναμονή ολοκλήρωσης')).toBeInTheDocument();
  });

  it('blocks duplicate capture requests while a request is pending', async () => {
    let finish!: (response: unknown) => void;
    state.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<PaymentReturnPage />);
    const capture = await screen.findByRole('button', { name: 'Finalize payment' });
    fireEvent.click(capture); fireEvent.click(capture);
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Refresh status' })).toBeDisabled();
    await act(async () => finish({ ok: true, status: 202, json: async () => ({ pending: true }) }));
    expect(await screen.findByRole('status')).toHaveTextContent('still being verified');
  });

  it('shows localized load errors instead of a false empty history', async () => {
    state.locale = 'el'; state.loadError = true;
    render(<PaymentReturnPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Οι πληρωμές δεν φορτώθηκαν');
    expect(screen.queryByText('Δεν υπάρχουν πρόσφατες πληρωμές')).not.toBeInTheDocument();
    state.loadError = false;
    fireEvent.click(screen.getByRole('button', { name: 'Ανανέωση κατάστασης' }));
    expect(await screen.findByText('Αναμονή ολοκλήρωσης')).toBeInTheDocument();
  });
});
