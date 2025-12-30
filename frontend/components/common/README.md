# Common Components

This directory contains common components that are used across the application but don't fit into other categories.

## Directories

- `examples/` - Example components for demonstration purposes

## Usage

Import components from this directory using the following pattern:

```tsx
import { ComponentName } from '@/components/common/path-to-component';
```

## Guidelines

- Components in this directory should be reusable across multiple features
- They should not be specific to a single feature or domain
- If a component becomes specific to a feature, move it to the appropriate feature directory 