/**
 * Common TypeScript types used across the application
 */

// Location coordinate type
export interface Coordinates {
  latitude: number;
  longitude: number;
}

// Address type
export interface Address {
  street: string;
  city: string;
  state?: string;
  zipCode: string;
  country: string;
  coordinates?: Coordinates;
}

// Date range type
export interface DateRange {
  startDate: string;
  endDate: string;
}

// Image type
export interface Image {
  id: string;
  url: string;
  alt?: string;
  width?: number;
  height?: number;
  blurDataUrl?: string;
}

// Error type
export interface AppError {
  message: string;
  code?: string;
  field?: string;
}

// Validation result
export interface ValidationResult {
  isValid: boolean;
  errors: AppError[];
}

// Map related types
export interface MapView {
  center: Coordinates;
  zoom: number;
  bounds?: {
    ne: Coordinates;
    sw: Coordinates;
  };
}

// File upload types
export interface UploadedFile {
  id: string;
  name: string;
  url: string;
  size: number;
  type: string;
  createdAt: string;
}

// Social media profile
export interface SocialMediaProfile {
  platform: 'facebook' | 'twitter' | 'instagram' | 'linkedin' | 'youtube' | 'tiktok';
  url: string;
  username?: string;
}

// Contact information
export interface ContactInfo {
  email?: string;
  phone?: string;
  website?: string;
  socialProfiles?: SocialMediaProfile[];
} 