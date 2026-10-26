import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parseWitResponse } from '@/lib/services/wit-service'
import { validateApiResponse } from '@/lib/validations/api-schema'
import { registrationSchema } from '@/lib/validations/auth-schema'
import { validateInput } from '@/lib/validations/security-schemas'

describe('validation contracts after Zod upgrade', () => {
  it('preserves dynamic entity keys while rejecting invalid entity values', () => {
    const payload = { text: 'chair', intents: [], entities: { category: [{ confidence: 0.9, value: 'chair', type: 'value' }] } }
    expect(parseWitResponse(payload).entities.category[0].value).toBe('chair')
    expect(() => parseWitResponse({ ...payload, entities: { category: 'invalid' } })).toThrow()
  })

  it('keeps the explicit terms acceptance requirement and user-facing message', () => {
    const result = registrationSchema.safeParse({ email: 'maria@example.com', password: 'SafePassword123', confirmPassword: 'SafePassword123', acceptTerms: false })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({ path: ['acceptTerms'], message: 'You must accept the terms and conditions' }))
  })

  it('formats validation failures without throwing from removed error properties', () => {
    expect(validateApiResponse({ success: true, data: 'wrong' }, z.number())).toMatchObject({ success: false, error: expect.any(String) })
    expect(() => validateInput(z.object({ title: z.string().min(3) }), { title: '' })).toThrow(/Validation failed: title:/)
  })
})
