# Contributing to NEEDS

Thank you for your interest in contributing!

## Development Workflow

1.  **Fork and Clone**: Fork the repository and clone it locally.
2.  **Create a Branch**: Create a new branch for your feature or fix.
    ```bash
    git checkout -b feature/my-new-feature
    ```
3.  **Make Changes**: Implement your changes. Ensure code style consistency.
4.  **Test**: Run tests to ensure no regressions.
    ```bash
    cd frontend
    pnpm test
    ```
5.  **Commit**: Write clear, descriptive commit messages.
6.  **Push**: Push your branch to your fork.
7.  **Pull Request**: Submit a Pull Request (PR) to the `main` branch.

## Code Style

- **TypeScript**: We use TypeScript for type safety. Ensure no `any` types where possible.
- **Linting**: Run `pnpm lint` to check for linting errors.
- **Formatting**: Code should be formatted consistent with the project's Prettier config.

## Project Structure

- `frontend/app`: Next.js App Router pages.
- `frontend/components`: React components (UI, Features, Layout).
- `frontend/lib`: Utilities, API clients, and services.
- `frontend/supabase`: Database configuration.

## Pull Request Guidelines

- Provide a clear description of what the PR does.
- Link to any relevant issues.
- Ensure CI checks pass.
- Request review from a maintainer.
