/**
 * Authentication-related TypeScript types
 */

// User profile type
export interface User {
  id: string;
  email: string;
  name?: string;
  username?: string;
  profileImage?: string;
  bio?: string;
  role: UserRole;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
}

// User roles
export type UserRole = 'user' | 'admin' | 'moderator';

// Auth state
export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

// Login credentials
export interface LoginCredentials {
  email: string;
  password: string;
  rememberMe?: boolean;
}

// Registration data
export interface RegistrationData {
  email: string;
  password: string;
  name?: string;
  username?: string;
  acceptTerms: boolean;
}

// Password reset request
export interface PasswordResetRequest {
  email: string;
}

// Password reset with token
export interface PasswordReset {
  token: string;
  password: string;
  confirmPassword: string;
}

// JWT Token payload
export interface JwtPayload {
  sub: string; // user id
  email: string;
  role: UserRole;
  iat: number; // issued at
  exp: number; // expiration time
}

// Auth token response
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
} 