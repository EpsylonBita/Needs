import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ContactClient from '@/components/pages/contact-client';

vi.mock('@/lib/utils/csrf', () => ({ getCsrfToken: vi.fn(async () => 'test-csrf') }));
const request = vi.fn();
beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({ ok: true, json: async () => ({ saved: true }) });
  vi.stubGlobal('fetch', request);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function fillForm() {
  fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'Maria' } });
  fireEvent.change(screen.getByLabelText('Last Name'), { target: { value: 'Test' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'maria@example.com' } });
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Listing question' } });
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Please help with my listing.' } });
}

describe('Contact form', () => {
  it('saves the submitted message with CSRF and confirms persistence without claiming email delivery', async () => {
    render(<ContactClient />);
    fillForm();
    fireEvent.submit(screen.getByRole('button', { name: 'Send Message' }).closest('form')!);
    expect(await screen.findByRole('status')).toHaveTextContent('saved');
    expect(screen.getByRole('status')).not.toHaveTextContent(/emailed|email sent/i);
    expect(request).toHaveBeenCalledWith('/api/contact', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'X-CSRF-Token': 'test-csrf' }) }));
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ firstName: 'Maria', email: 'maria@example.com', message: 'Please help with my listing.' });
  });

  it('keeps the message after a failed save', async () => {
    request.mockResolvedValue({ ok: false, json: async () => ({ error: 'Unable to save your message. Please try again.' }) });
    render(<ContactClient />);
    fillForm();
    fireEvent.submit(screen.getByRole('button', { name: 'Send Message' }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save');
    expect(screen.getByLabelText('Message')).toHaveValue('Please help with my listing.');
  });

  it('validates required fields before making a request', async () => {
    render(<ContactClient />);
    fireEvent.submit(screen.getByRole('button', { name: 'Send Message' }).closest('form')!);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });

  it('reuses its submission key after a lost response and reports pending notification honestly', async () => {
    request.mockRejectedValueOnce(new Error('Connection interrupted'));
    request.mockResolvedValueOnce({ ok: true, json: async () => ({ saved: true, notification: 'pending' }) });
    render(<ContactClient />);
    fillForm();
    const form = screen.getByRole('button', { name: 'Send Message' }).closest('form')!;
    fireEvent.submit(form);
    await screen.findByRole('alert');
    fireEvent.submit(form);
    expect(await screen.findByRole('status')).toHaveTextContent('notification is pending');
    const firstKey = request.mock.calls[0][1].headers['Idempotency-Key'];
    expect(firstKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(request.mock.calls[1][1].headers['Idempotency-Key']).toBe(firstKey);
  });

  it('uses a fresh key when the user changes a failed submission', async () => {
    request.mockRejectedValueOnce(new Error('Connection interrupted'));
    render(<ContactClient />);
    fillForm();
    const form = screen.getByRole('button', { name: 'Send Message' }).closest('form')!;
    fireEvent.submit(form);
    await screen.findByRole('alert');
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'An edited question' } });
    fireEvent.submit(form);
    await screen.findByRole('status');
    expect(request.mock.calls[1][1].headers['Idempotency-Key']).not.toBe(request.mock.calls[0][1].headers['Idempotency-Key']);
  });
});
