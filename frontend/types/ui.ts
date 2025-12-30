/**
 * UI-related TypeScript types
 */

// Common UI component props
export interface BaseProps {
  className?: string;
  id?: string;
  testId?: string;
}

// Component size variants
export type SizeVariant = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

// Component color variants
export type ColorVariant = 
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'muted';

// Common button variants
export type ButtonVariant = 
  | 'default'
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'link'
  | 'destructive';

// Common input variants
export type InputVariant = 'default' | 'filled' | 'outline' | 'unstyled';

// Modal/dialog sizes
export type ModalSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'full';

// Toast/notification types
export type ToastType = 'default' | 'success' | 'error' | 'warning' | 'info';

// Position for elements like toasts, popovers, etc.
export type Position = 
  | 'top'
  | 'top-right'
  | 'top-left'
  | 'bottom'
  | 'bottom-right'
  | 'bottom-left'
  | 'left'
  | 'right';
  
// Common breakpoints for responsive design
export type Breakpoint = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'; 