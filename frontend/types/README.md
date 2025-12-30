# TypeScript Types Directory

This directory contains shared TypeScript interfaces and types used across the application.

## Structure

- `index.ts` - Barrel export file that exports all types
- `api.ts` - API-related types (requests, responses, pagination)
- `auth.ts` - Authentication and user-related types
- `common.ts` - Shared utility types used across the application
- `ui.ts` - UI component types and properties
- `category.ts` - Category-related types

## Usage

### Importing Types

Import types from the barrel file for cleaner imports:

```tsx
import { User, ApiResponse, MapView } from '@/types';
```

Or import specific types directly:

```tsx
import { User } from '@/types/auth';
```

### Type Validation with Zod

Types in this directory are complemented by Zod schemas in the `lib/validations` directory for runtime validation:

```tsx
import { User } from '@/types';
import { userSchema } from '@/lib/validations/auth-schema';

// Validate API response at runtime
const validateUser = (userData: unknown): User => {
  return userSchema.parse(userData);
};
```

## Best Practices

1. **Keep Types DRY**: Define types once in this directory rather than duplicating them
2. **Use Interfaces** for object shapes that might be extended
3. **Use Types** for unions, intersections, and mapped types
4. **Follow Naming Conventions**:
   - Use `PascalCase` for interface and type names
   - Use suffixes like `Props` for component props
   - Use suffixes like `State` for state types
   - Use prefixes like `is` or `has` for boolean properties
5. **Keep Types and Schemas in Sync**: When updating a type, make sure to update the corresponding Zod schema

## Adding New Types

When adding new types:

1. Create or update the appropriate file in this directory
2. Export the type from `index.ts`
3. Create corresponding Zod validation schemas when needed
4. Document complex types with JSDoc comments 