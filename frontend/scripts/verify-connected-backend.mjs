// Opt-in live integration check. Creates temporary accounts/rows and removes only
// its own resources in finally. Never sends mail or performs Stripe transactions.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

if (!process.argv.includes('--allow-test-writes')) throw new Error('Pass --allow-test-writes to run this temporary-data check.');
process.loadEnvFile('.env.local');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(new URL(url).hostname, 'qczrqxmewjsydrrvjdil.supabase.co', 'Unexpected project: review before testing');
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const makeClient = (key) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: randomUUID() } });
const admin = makeClient(process.env.SUPABASE_SERVICE_ROLE_KEY);
const anonymous = makeClient(publicKey);
const marker = `needs-verification-${randomUUID()}`;
const accounts = [];
const objects = [];
let listingId;
let chatId;
let channel;
const passed = [];
const checked = (result, label) => { if (result.error) throw new Error(`${label}: ${result.error.message}`); return result.data; };
const pass = (name) => { passed.push(name); console.log(`PASS ${name}`); };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBz0AAAAASUVORK5CYII=', 'base64');

try {
  for (let i = 0; i < 3; i++) {
    const email = `${marker}-${i}@example.com`;
    const password = `${randomUUID()}aA1!`;
    const created = checked(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { fullName: 'Temporary verification' } }), 'create temporary account');
    const account = { id: created.user.id, client: makeClient(publicKey), profileId: null };
    accounts.push(account);
    checked(await account.client.auth.signInWithPassword({ email, password }), 'sign in');
    let profile = checked(await account.client.from('profiles').select('id').eq('user_id', account.id).maybeSingle(), 'read profile');
    if (!profile) profile = checked(await account.client.from('profiles').insert({ user_id: account.id, display_name: 'Temporary verification' }).select('id').single(), 'create own profile');
    account.profileId = profile.id;
  }
  pass('authentication and profile creation');
  const [seller, buyer, outsider] = accounts;
  const forbiddenRole = await seller.client.from('profiles').update({ role: 'admin' }).eq('id', seller.profileId);
  assert.ok(forbiddenRole.error, 'Profile role must not be client-editable');
  pass('profile role protection');

  const listing = checked(await seller.client.from('listings').insert({
    seller_id: seller.profileId, title: marker, description: 'Temporary integration verification; automatically removed.',
    price: 0, main_category: 'Items', sub_category: 'Free', status: 'active',
    location: 'SRID=4326;POINT(23.7275 37.9838)', address: { label: 'Athens test location' }, contact_number: 'test-only',
  }).select('id').single(), 'create listing');
  listingId = listing.id;
  checked(await seller.client.from('listing_tags').insert({ listing_id: listingId, tag: marker }), 'save tags');
  const visible = checked(await anonymous.from('listings').select('id,listing_tags(tag)').eq('id', listingId).single(), 'public listing discovery');
  assert.equal(visible.listing_tags[0].tag, marker);
  const foreignTag = await outsider.client.from('listing_tags').insert({ listing_id: listingId, tag: 'forged' });
  assert.ok(foreignTag.error);
  const nearby = checked(await anonymous.rpc('nearby_listings_detailed', { lat: 37.9838, lon: 23.7275, radius_m: 5000 }), 'PostGIS search');
  assert.ok(nearby.some(row => row.id === listingId));
  pass('listing, tag ownership and real PostGIS search');

  for (const [bucket, path] of [
    ['listing-images', `${seller.id}/${listingId}/${marker}.png`],
    ['avatars', `${seller.id}/${marker}.png`],
  ]) {
    checked(await seller.client.storage.from(bucket).upload(path, png, { contentType: 'image/png' }), `upload ${bucket}`);
    objects.push({ bucket, path });
    checked(await seller.client.storage.from(bucket).download(path), `download ${bucket}`);
    const forgedPath = `${seller.id}/${bucket === 'listing-images' ? `${listingId}/` : ''}forged-${marker}.png`;
    const denied = await outsider.client.storage.from(bucket).upload(forgedPath, png, { contentType: 'image/png' });
    if (!denied.error) objects.push({ bucket, path: forgedPath });
    assert.ok(denied.error, 'Another user must not upload into the owner folder');
  }
  const image = objects[0];
  const imageUrl = seller.client.storage.from(image.bucket).getPublicUrl(image.path).data.publicUrl;
  const imageRow = checked(await seller.client.from('listing_images').insert({ listing_id: listingId, url: imageUrl, storage_path: image.path, main: false }).select('id').single(), 'image metadata');
  checked(await seller.client.rpc('set_main_listing_image', { p_listing_id: listingId, p_image_id: imageRow.id }), 'main image');
  pass('listing images, avatars and storage ownership');

  chatId = checked(await buyer.client.rpc('get_or_create_direct_chat', { p_listing_id: listingId }), 'open listing chat');
  assert.equal(checked(await buyer.client.rpc('get_or_create_direct_chat', { p_listing_id: listingId }), 'reuse chat'), chatId);
  const outsidersChats = checked(await outsider.client.from('chats').select('id').eq('id', chatId), 'outsider chat lookup');
  assert.equal(outsidersChats.length, 0);
  const unauthorizedMessage = await outsider.client.from('messages').insert({ chat_id: chatId, sender_id: outsider.profileId, content: marker });
  assert.ok(unauthorizedMessage.error);
  pass('chat membership and idempotent conversation');

  let received;
  const messageEvent = new Promise(resolve => { received = resolve; });
  await new Promise((resolve, reject) => {
    let subscribed = false;
    let replicationReady = false;
    const timer = setTimeout(() => reject(new Error(`Realtime readiness timed out (subscribed=${subscribed}, postgres_changes=${replicationReady})`)), 30000);
    const ready = () => { if (subscribed && replicationReady) { clearTimeout(timer); resolve(); } };
    const fail = message => { clearTimeout(timer); reject(new Error(message)); };
    channel = seller.client.channel(marker)
      // SUBSCRIBED alone can precede the database replication listener. Wait for
      // its readiness signal before writing, otherwise this check can lose INSERT.
      .on('system', {}, payload => {
        if (payload.extension !== 'postgres_changes') return;
        if (payload.status === 'ok') { replicationReady = true; ready(); }
        else if (payload.status === 'error') fail('Realtime postgres_changes reported an error');
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` }, payload => received(payload))
      .subscribe(status => {
        if (status === 'SUBSCRIBED') { subscribed = true; ready(); }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') fail(`Realtime ${status}`);
      });
  });
  const sentMessage = checked(await buyer.client.from('messages').insert({ chat_id: chatId, sender_id: buyer.profileId, content: marker }).select('id').single(), 'send test message');
  const readableMessage = checked(await seller.client.from('messages').select('id').eq('id', sentMessage.id).single(), 'subscriber message access');
  assert.equal(readableMessage.id, sentMessage.id, 'The subscriber must be allowed to read the message');
  let messageTimer;
  try {
    const payload = await Promise.race([messageEvent, new Promise((_, reject) => { messageTimer = setTimeout(() => reject(new Error('Realtime delivery timed out')), 15000); })]);
    assert.equal(payload.new.content, marker);
  } finally { clearTimeout(messageTimer); }
  pass('Realtime message delivery');

  const privateSupport = await anonymous.from('support_requests').select('id').limit(0);
  assert.ok(privateSupport.error);
  pass('private support data');
} finally {
  const cleanupErrors = [];
  const clean = async (label, operation) => { try { checked(await operation, label); } catch (error) { cleanupErrors.push(error.message); } };
  if (channel && accounts[0]) await accounts[0].client.removeChannel(channel);
  for (const object of objects) await clean('remove test image', admin.storage.from(object.bucket).remove([object.path]));
  if (chatId) await clean('remove test chat', admin.from('chats').delete().eq('id', chatId));
  if (listingId) await clean('remove test listing', admin.from('listings').delete().eq('id', listingId));
  for (const account of accounts) {
    await account.client.auth.signOut();
    await clean('remove temporary account', admin.auth.admin.deleteUser(account.id));
  }
  if (cleanupErrors.length) throw new Error(`Temporary resource cleanup requires attention: ${cleanupErrors.join('; ')}`);
  console.log(`CLEANUP complete; ${passed.length} live checks passed`);
}
