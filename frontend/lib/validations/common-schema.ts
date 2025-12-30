import { z } from 'zod';

// Coordinates schema
export const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180)
});

// Address schema
export const addressSchema = z.object({
  street: z.string().min(1, { message: 'Street is required' }),
  city: z.string().min(1, { message: 'City is required' }),
  state: z.string().optional(),
  zipCode: z.string().min(1, { message: 'Zip code is required' }),
  country: z.string().min(1, { message: 'Country is required' }),
  coordinates: coordinatesSchema.optional()
});

// Date range schema
export const dateRangeSchema = z.object({
  startDate: z.string().datetime(),
  endDate: z.string().datetime()
}).refine(
  (data) => new Date(data.startDate) <= new Date(data.endDate),
  {
    message: 'End date must be after start date',
    path: ['endDate']
  }
);

// Image schema
export const imageSchema = z.object({
  id: z.string(),
  url: z.string().url({ message: 'Must be a valid URL' }),
  alt: z.string().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  blurDataUrl: z.string().optional()
});

// Map view schema
export const mapViewSchema = z.object({
  center: coordinatesSchema,
  zoom: z.number().min(1).max(20),
  bounds: z.object({
    ne: coordinatesSchema,
    sw: coordinatesSchema
  }).optional()
});

// File upload schema
export const uploadedFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().url(),
  size: z.number().positive(),
  type: z.string(),
  createdAt: z.string().datetime()
});

// Social media profile schema
export const socialMediaProfileSchema = z.object({
  platform: z.enum(['facebook', 'twitter', 'instagram', 'linkedin', 'youtube', 'tiktok']),
  url: z.string().url({ message: 'Must be a valid URL' }),
  username: z.string().optional()
});

// Contact info schema
export const contactInfoSchema = z.object({
  email: z.string().email({ message: 'Must be a valid email' }).optional(),
  phone: z.string().optional(),
  website: z.string().url({ message: 'Must be a valid URL' }).optional(),
  socialProfiles: z.array(socialMediaProfileSchema).optional()
});

// Create types from schemas
export type Coordinates = z.infer<typeof coordinatesSchema>;
export type Address = z.infer<typeof addressSchema>;
export type DateRange = z.infer<typeof dateRangeSchema>;
export type Image = z.infer<typeof imageSchema>;
export type MapView = z.infer<typeof mapViewSchema>;
export type UploadedFile = z.infer<typeof uploadedFileSchema>;
export type SocialMediaProfile = z.infer<typeof socialMediaProfileSchema>;
export type ContactInfo = z.infer<typeof contactInfoSchema>; 