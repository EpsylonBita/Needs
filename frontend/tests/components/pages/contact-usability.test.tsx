import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/utils/csrf', () => ({ getCsrfToken: vi.fn(async () => 'test-csrf') }));
import ContactClient from '@/components/pages/contact-client';

const request = vi.fn();
beforeEach(() => { request.mockReset(); vi.stubGlobal('fetch', request); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('contact usability', () => {
  it('provides honest support guidance and self-service links without fictional contact details', () => {
    render(<ContactClient />);
    expect(screen.getByRole('complementary', { name: 'Support information' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/auth/forgot-password');
    expect(screen.getByRole('link', { name: 'Resend confirmation' })).toHaveAttribute('href', '/auth/resend');
    expect(document.body).not.toHaveTextContent(/San Francisco|555|support@needs\.com|123 Main Street|epsylon2010/i);
  });

  it('focuses the first invalid input and associates its specific error', async () => {
    render(<ContactClient />);
    fireEvent.submit(screen.getByRole('button', { name: 'Send Message' }).closest('form')!);
    const name = screen.getByLabelText('First Name');
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Enter your first name (up to 100 characters).');
    expect(await screen.findByRole('alert')).toHaveTextContent('highlighted fields');
    expect(request).not.toHaveBeenCalled();
  });

  it('disables inputs during a request, prevents duplicate submission and focuses the saved result', async () => {
    let finish!: (value: unknown) => void;
    request.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<ContactClient />);
    for (const [label, value] of [['First Name', 'Maria'], ['Last Name', 'Test'], ['Email', 'maria@example.com'], ['Subject', 'A listing question'], ['Message', 'Please help with my listing.']]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    const form = screen.getByRole('button', { name: 'Send Message' }).closest('form')!;
    fireEvent.submit(form);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Email')).toBeDisabled();
    expect(screen.getByLabelText('Message')).toBeDisabled();
    expect(form).toHaveAttribute('aria-busy', 'true');
    fireEvent.submit(form);
    expect(request).toHaveBeenCalledTimes(1);
    finish({ ok: true, json: async () => ({ saved: true, notification: 'pending' }) });
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('notification is pending');
    await waitFor(() => expect(status).toHaveFocus());
    expect(screen.getByLabelText('Message')).toHaveValue('');
  });

  it('uses unique label targets if multiple instances are rendered', () => {
    render(<><ContactClient /><ContactClient /></>);
    const emails = screen.getAllByLabelText('Email');
    expect(emails).toHaveLength(2);
    expect(emails[0].id).not.toBe(emails[1].id);
    expect(emails[0]).toHaveAttribute('autocomplete', 'email');
  });
});
