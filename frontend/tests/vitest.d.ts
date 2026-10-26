import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'
import 'vitest'

// Vitest 5 separates the assertion return type from the received value type.
// Extend its supported matcher seam while jest-dom's adapter targets Vitest 4.
declare module 'vitest' {
  // Declaration merging requires an interface, rather than a type alias.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown>
    extends TestingLibraryMatchers<T, R> {}
}
