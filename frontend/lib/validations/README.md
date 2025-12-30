# Zod Validation Schemas

This directory contains Zod validation schemas used for runtime data validation across the application.

## Structure

- `index.ts` - Barrel export file that exports all schemas
- `auth-schema.ts` - Authentication and user-related schemas
- `common-schema.ts` - Shared utility schemas used across the application
- `api-schema.ts` - API-related schemas (requests, responses, pagination)

## Usage

### Basic Validation

```tsx
import { loginSchema } from '@/lib/validations';

// Validate form data
try {
  const validatedData = loginSchema.parse({
    email: 'user@example.com',
    password: 'password123'
  });
  // Proceed with validated data
} catch (error) {
  // Handle validation errors
  if (error instanceof z.ZodError) {
    const formattedErrors = error.errors.map(err => ({
      field: err.path.join('.'),
      message: err.message
    }));
    console.error(formattedErrors);
  }
}
```

### With React Hook Form

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema } from '@/lib/validations';
import type { LoginCredentials } from '@/types';

const LoginForm = () => {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginCredentials>({
    resolver: zodResolver(loginSchema)
  });

  const onSubmit = (data: LoginCredentials) => {
    // Validated data ready to use
    console.log(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      {/* Form fields */}
    </form>
  );
};
```

### API Response Validation

```tsx
import { validateApiResponse } from '@/lib/validations/api-schema';
import { categorySchema } from '@/lib/validations/api-schema';

// Validate API response
const fetchCategory = async (id: string) => {
  const response = await fetch(`/api/categories/${id}`);
  const data = await response.json();
  
  const result = validateApiResponse(data, categorySchema);
  
  if (result.success) {
    return result.data;
  } else {
    throw new Error(result.error);
  }
};
```

## Best Practices

1. **Consistent Error Messages**: Use descriptive and user-friendly error messages
2. **TypeScript Integration**: Export types derived from schemas using `z.infer`
3. **Keep in Sync with Types**: When updating a schema, update the corresponding TypeScript type
4. **Reuse Schemas**: Compose complex schemas from simpler ones
5. **Refinements**: Use `.refine()` for custom validation logic that depends on multiple fields

## Adding New Schemas

When adding new schemas:

1. Create or update the appropriate file in this directory
2. Export the schema from `index.ts`
3. Export TypeScript types using `z.infer<typeof schemaName>`
4. Add appropriate error messages and validation rules 