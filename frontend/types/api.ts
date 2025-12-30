/**
 * API-related TypeScript types
 */

// Base API response structure
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code?: string;
    details?: unknown;
  };
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

// Pagination parameters for requests
export interface PaginationParams {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

// Search parameters
export interface SearchParams extends PaginationParams {
  query?: string;
  filters?: Record<string, unknown>;
  near?: {
    lat: number;
    lng: number;
    radius?: number; // in km
  };
}

// Base error type
export interface ApiError {
  message: string;
  code?: string;
  status?: number;
  details?: unknown;
}

// HTTP methods type
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; 