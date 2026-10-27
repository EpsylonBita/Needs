// Read-only live smoke check. Requires development dependencies; never creates listings.
// node scripts/verify-retail-live.mjs "Sony WH-1000XM5 Black" "iPhone 16 128GB Pink"
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const titles = process.argv.slice(2)
if (!titles.length || titles.length > 5) {
  console.error('Pass one to five exact product titles, including known capacity and color.')
  process.exit(1)
}
const server = await createServer({
  root, configFile: false, logLevel: 'error', appType: 'custom',
  resolve: { alias: { '@': root } }, server: { middlewareMode: true },
})
try {
  const { getProductIdentity } = await server.ssrLoadModule('/lib/pricing/matching.ts')
  const { scrapeGreekRetail } = await server.ssrLoadModule('/lib/pricing/greek-retail.ts')
  for (const title of titles) {
    const identity = getProductIdentity({ title, description: '', mainCategory: 'Items', subCategory: 'Sell', coordinates: null })
    const started = Date.now()
    const result = identity ? await scrapeGreekRetail(identity) : { offers: [], checked: 0 }
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), title, query: identity?.query ?? null, elapsedMs: Date.now() - started, ...result }))
    if (!result.offers.length) process.exitCode = 1
  }
} finally { await server.close() }
