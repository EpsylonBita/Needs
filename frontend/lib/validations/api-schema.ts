import { z } from 'zod';

// API response schema - generic wrapper for all API responses
export const apiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) => 
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: z.object({
      message: z.string(),
      code: z.string().optional(),
      details: z.unknown().optional()
    }).optional(),
    meta: z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
      total: z.number().optional(),
      totalPages: z.number().optional()
    }).optional()
  });

// Pagination params schema
export const paginationParamsSchema = z.object({
  page: z.number().positive().optional().default(1),
  limit: z.number().positive().max(100).optional().default(10),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).optional().default('asc')
});

// Search params schema
export const searchParamsSchema = paginationParamsSchema.extend({
  query: z.string().optional(),
  filters: z.record(z.unknown()).optional(),
  near: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    radius: z.number().positive().optional().default(10)
  }).optional()
});

// Category schema for API validation
export const categorySchema = z.object({
  _id: z.string(),
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
  imageUrl: z.string().url().optional(),
  subcategories: z.array(
    z.object({
      _id: z.string(),
      name: z.string().min(1),
      slug: z.string().min(1),
      description: z.string().optional(),
      imageUrl: z.string().url().optional(),
      categoryId: z.string()
    })
  )
});

// Error response schema
export const apiErrorSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
  status: z.number().optional(),
  details: z.unknown().optional()
});

// Create validations for specific endpoints
export const createCategoryBodySchema = z.object({
  name: z.string().min(1, { message: 'Name is required' }),
  slug: z.string().min(1, { message: 'Slug is required' }),
  description: z.string().optional(),
  imageUrl: z.string().url().optional()
});

// Type helpers
export type ApiResponse<T> = z.infer<ReturnType<typeof apiResponseSchema<z.ZodType<T>>>>;
export type PaginationParams = z.infer<typeof paginationParamsSchema>;
export type SearchParams = z.infer<typeof searchParamsSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type Category = z.infer<typeof categorySchema>;

// Helper function to validate API responses
export function validateApiResponse<T>(
  responseData: unknown, 
  schema: z.ZodType<T>
): { success: boolean; data?: T; error?: string } {
  try {
    const parsedData = apiResponseSchema(schema).parse(responseData);
    return { success: true, data: parsedData.data as T };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors.map(e => e.message).join(', ') };
    }
    return { success: false, error: 'Invalid response data' };
  }
} 