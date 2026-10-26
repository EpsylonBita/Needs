import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { configuredContactEmailDelivery } from '@/lib/email/contact-email-transport';
import { dispatchContactNotifications } from '@/lib/email/contact-notification';
import { withApiErrorHandler } from '@/lib/utils/error-handler';
import { rateLimitEnhanced } from '@/lib/utils/rate-limit-enhanced';
import { contactSchema } from './validation';
import type { ContactNotificationState } from '@/lib/email/contact-notification';

export const POST = withApiErrorHandler(async (request: NextRequest) => {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  const rate = await rateLimitEnhanced(`contact:${ip}`, 5, 60 * 60 * 1000, {
    failClosed: true,
    message: 'Too many messages. Please try again later.',
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: rate.message || 'Too many messages. Please try again later.' }, {
      status: 429,
      headers: rate.retryAfter ? { 'Retry-After': String(rate.retryAfter) } : {},
    });
  }
  if (Number(request.headers.get('content-length')) > 24000) {
    return NextResponse.json({ error: 'Your message is too long.' }, { status: 413 });
  }
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 12000) return NextResponse.json({ error: 'Your message is too long.' }, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'Invalid message data.' }, { status: 400 });
  }
  const parsed = contactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Please check your message.' }, { status: 400 });
  }
  const submissionKey = request.headers.get('Idempotency-Key') || randomUUID();
  if (!z.string().uuid().safeParse(submissionKey).success) {
    return NextResponse.json({ error: 'Invalid message submission key.' }, { status: 400 });
  }
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Support storage is unavailable');
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { firstName, lastName, email, subject, message } = parsed.data;
    const { data, error } = await supabase.rpc('submit_support_request', {
      p_submission_key: submissionKey,
      p_payload_hash: createHash('sha256').update(JSON.stringify(parsed.data)).digest('hex'),
      p_first_name: firstName, p_last_name: lastName, p_email: email, p_subject: subject, p_message: message,
    });
    if (error?.code === '22023') return NextResponse.json({ error: 'This submission key belongs to another message. Please submit your edited message again.' }, { status: 409 });
    if (error) throw error;
    const saved = data?.[0] as { request_id: string; notification_status: ContactNotificationState } | undefined;
    if (!saved?.request_id) throw new Error('Support storage did not confirm the save');
    let delivery: ReturnType<typeof configuredContactEmailDelivery> = null;
    try { delivery = configuredContactEmailDelivery(); }
    catch { /* A provider configuration problem must not undo a confirmed save. */ }
    let state = saved.notification_status;
    if (state !== 'accepted' && delivery) {
      try {
        await dispatchContactNotifications(supabase, delivery, { requestId: saved.request_id, limit: 1 });
        const current = await supabase.from('support_requests').select('notification_status').eq('id', saved.request_id).single();
        if (!current.error && current.data) state = current.data.notification_status as ContactNotificationState;
      } catch { /* The message is durable; a later dispatcher retry can finish notification. */ }
    }
    const notification = state === 'accepted' ? 'accepted' : !delivery || state === 'failed' ? 'unavailable' : 'pending';
    const feedback = notification === 'accepted'
      ? 'Your message has been saved and the support email notification has been sent.'
      : notification === 'pending'
        ? 'Your message has been saved. The support email notification is pending.'
        : 'Your message has been saved. Email notifications are currently unavailable.';
    return NextResponse.json({ saved: true, requestId: saved.request_id, notification, message: feedback }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Unable to save your message. Please try again.' }, { status: 503 });
  }
});
