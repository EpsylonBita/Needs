/**
 * UI Components Barrel File
 * 
 * This file exports all UI components to enable clean imports throughout the application.
 * Components are organized by category for better maintainability.
 * 
 * Example usage:
 * ```tsx
 * import { Button, Card, Dialog } from "@/components/ui";
 * ```
 */

// Barrel exports for all Shadcn UI components
// These exports make components available throughout the application.
// Organized alphabetically for easier maintenance.

// --- Form Components ---
export * from './accordion';
export * from './alert';
export * from './alert-dialog';
export * from './badge';
export * from './button';
export * from './calendar';
export * from './card';
export * from './checkbox';
export * from './dialog';
export * from './dropdown-menu';
export * from './form';
export * from './input';
export * from './label';
export * from './popover';
export * from './select';
export * from './separator';
export * from './slider';
export * from './tabs';
export * from './textarea';

// --- Feedback Components ---
export * from './skeleton';
export * from './toast';
export * from './toaster';
export * from './use-toast';

// --- Layout Components ---
export * from './aspect-ratio';
export * from './command';
export * from './scroll-area';
export * from './sheet';

// --- Data Display Components ---
export * from './avatar';

// --- Custom/Extended UI Components ---
export * from './animated-search-input';
export * from './aurora-background';
export * from './icons';
export * from './navbar-menu';
export * from './optimized-image';

// Export component types only where they exist
export type { ButtonProps } from './button';
export type { InputProps } from './input';
export type { TextareaProps } from './textarea';
