self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try { await self.registration.unregister() } catch {}
    const clients = await self.clients.matchAll({ type: 'window' })
    for (const client of clients) { try { client.navigate(client.url) } catch {} }
  })())
})

self.addEventListener('fetch', () => {})