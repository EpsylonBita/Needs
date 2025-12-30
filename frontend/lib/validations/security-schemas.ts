import { z } from 'zod'

// Base validation schemas
export const emailSchema = z.string().email('Invalid email format')
export const passwordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')

// User validation schemas
export const userLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
})

export const userRegisterSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: z.string().min(2, 'Full name must be at least 2 characters').max(100),
  phoneNumber: z.string().optional(),
})

// Payment validation schemas
export const paymentIntentSchema = z.object({
  listing_id: z.string().uuid('Invalid listing ID'),
  amount: z.number().positive('Amount must be positive').max(100000, 'Amount too large'),
  currency: z.string().length(3, 'Currency must be 3 characters').default('usd'),
})

export const paymentWebhookSchema = z.object({
  id: z.string(),
  type: z.string(),
  data: z.object({
    object: z.record(z.any()),
  }),
})

// Listing validation schemas
export const listingCreateSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(200),
  description: z.string().min(10, 'Description must be at least 10 characters').max(2000),
  price: z.number().nonnegative('Price cannot be negative').max(1000000, 'Price too high'),
  main_category: z.enum(['Items', 'Services']),
  sub_category: z.enum(['Buy', 'Sell', 'Free', 'I want', 'I will', 'I can']),
  tags: z.array(z.string().max(50)).max(10, 'Maximum 10 tags allowed').optional(),
  coordinates: z.tuple([z.number(), z.number()]).optional(),
})

export const listingUpdateSchema = listingCreateSchema.partial()

// Admin validation schemas
export const adminCreateUserSchema = z.object({
  email: emailSchema,
  display_name: z.string().min(1, 'Display name is required').max(100),
  role: z.enum(['user', 'admin', 'moderator']).default('user'),
})

// Search validation schemas
export const searchParamsSchema = z.object({
  q: z.string().max(100).optional(),
  category: z.string().max(50).optional(),
  subcategory: z.string().max(50).optional(),
  page: z.number().int().positive().max(1000).default(1),
  limit: z.number().int().positive().max(100).default(20),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  radius: z.number().positive().max(1000).default(50),
})

// File upload validation
export const fileUploadSchema = z.object({
  file: z.object({
    size: z.number().max(5 * 1024 * 1024, 'File size must be less than 5MB'),
    type: z.string().refine(
      (type) => ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type),
      'Only JPEG, PNG, WebP, and GIF images are allowed'
    ),
  }),
})

// Validation helper functions
export function validateInput<T>(schema: z.ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data)
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ')
      throw new Error(`Validation failed: ${errorMessage}`)
    }
    throw error
  }
}

export function validateRequestBody<T>(schema: z.ZodSchema<T>, request: Request): Promise<T> {
  return request.json().then((body) => validateInput(schema, body))
}

// Rate limiting schemas
export const rateLimitSchema = z.object({
  key: z.string().max(100),
  limit: z.number().int().positive().max(1000),
  windowMs: z.number().int().positive().max(86400000), // 24 hours max
})

// Export all schemas
export const schemas = {
  userLoginSchema,
  userRegisterSchema,
  paymentIntentSchema,
  paymentWebhookSchema,
  listingCreateSchema,
  listingUpdateSchema,
  adminCreateUserSchema,
  searchParamsSchema,
  fileUploadSchema,
  rateLimitSchema,
}