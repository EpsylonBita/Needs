# NEEDS Frontend

Next.js App Router frontend for the NEEDS platform.

## Documentation

- **[Setup Guide](../docs/SETUP.md)**: Full project setup instructions.
- **[Architecture](../docs/ARCHITECTURE.md)**: System architecture and data flow.
- **[Contributing](../docs/CONTRIBUTING.md)**: Contribution guidelines.

## Scripts

```bash
pnpm dev          # Start development server
pnpm build        # Build for production
pnpm start        # Start production server
pnpm lint         # Run ESLint
pnpm test         # Run tests
pnpm typecheck    # Run TypeScript check
```

## Environment Variables

See `../docs/SETUP.md` for required environment variables.

## Project Structure

```
frontend/
├── app/                  # Next.js App Router pages
├── components/           # React components
├── lib/                  # Utilities and services
├── supabase/             # Database config and migrations
└── ...
```
