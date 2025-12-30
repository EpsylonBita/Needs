# Frontend Context Organization

This directory contains all the React Context providers used in the application. The contexts are organized using a consistent structure and naming convention.

## Directory Structure

```
contexts/
├── __tests__/              # Unit tests for contexts
│   └── auth-context.test.tsx
├── auth-context.tsx        # Authentication context
├── index.ts                # Barrel file for exports
├── profile-context.tsx     # User profile context
├── providers.tsx           # Centralized provider composition
├── README.md               # This file
├── socket-context.tsx      # WebSocket context
└── test-wrapper.tsx        # Test utilities for contexts
```

## Usage

### Importing Contexts

Import hooks and providers directly from the barrel file:

```tsx
import { useAuth, useProfile, useSocket } from '@/contexts';
```

### Using the Centralized Provider

The application uses a centralized provider that composes all context providers in the correct order:

```tsx
import { ContextProviders } from '@/contexts/providers';

function App() {
  return (
    <ContextProviders>
      <YourApp />
    </ContextProviders>
  );
}
```

### Testing Components with Contexts

Use the `TestProviders` wrapper in unit tests:

```tsx
import { render } from '@testing-library/react';
import { TestProviders } from '@/contexts/test-wrapper';
import YourComponent from './your-component';

describe('YourComponent', () => {
  it('renders correctly', () => {
    render(
      <TestProviders>
        <YourComponent />
      </TestProviders>
    );
    // Your test assertions
  });

  it('works with specific contexts only', () => {
    render(
      <TestProviders withAuth withProfile={false} withSocket={false}>
        <YourComponent />
      </TestProviders>
    );
    // Your test assertions
  });
});
```

## Context Implementation Pattern

All contexts follow a consistent implementation pattern:

1. Define interfaces for context state and actions
2. Create and export a provider component
3. Create and export a hook to use the context
4. Include proper TypeScript types and documentation

Example:

```tsx
// State interface
interface AuthContextState {
  user: User | null;
  isLoading: boolean;
  error: string | null;
}

// Actions interface
interface AuthContextActions {
  login: (data: LoginData) => Promise<void>;
  logout: () => Promise<void>;
}

// Combined value interface
interface AuthContextValue extends AuthContextState, AuthContextActions {}

// Provider props interface
interface AuthProviderProps {
  children: ReactNode;
}

// Create the context
const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Provider component
export function AuthProvider({ children }: AuthProviderProps) {
  // Implementation...
}

// Consumer hook
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
``` 