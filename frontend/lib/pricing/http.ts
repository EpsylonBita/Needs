import { z } from 'zod'
import { createHash } from 'node:crypto'
import { rateLimitEnhanced } from '@/lib/utils/rate-limit-enhanced'

export const subjectSchema = z.object({
  title: z.string().trim().min(3).max(200), description: z.string().trim().max(10000),
  mainCategory: z.enum(['Items', 'Services']), subCategory: z.enum(['Buy', 'Sell', 'Free', 'I want', 'I will', 'I can']),
  coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]).nullable(),
}).strict().refine(value => value.mainCategory === 'Items'
  ? ['Buy', 'Sell', 'Free'].includes(value.subCategory) : ['I want', 'I will', 'I can'].includes(value.subCategory))

export function pricingResponse(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function allowPricing(request: Request, suffix: string, userId?: string) {
  const address = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const key = createHash('sha256').update(userId || address.slice(0, 128)).digest('hex').slice(0, 32)
  return rateLimitEnhanced(`pricing:${suffix}:${key}`, userId ? 12 : 30, 60000, { failClosed: true })
}

export async function readSubject(request: Request) {
  const reader = request.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > 32768) return null
      chunks.push(value)
    }
    const result = subjectSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    return result.success ? result.data : null
  } catch { return null } finally { await reader.cancel().catch(() => undefined) }
}
