import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores(['.next/**', '.next-e2e/**', 'playwright-report/**', 'test-results/**', 'node_modules/**', 'out/**', 'build/**', 'next-env.d.ts', '**/*.tsbuildinfo', 'coverage/**', 'eslint_report.json']),
  {
    files: ['**/*.{ts,tsx,mts}'],
    rules: {
      'react/prop-types': 'off',
      'react/no-unescaped-entities': 'off',
      'react-hooks/exhaustive-deps': 'warn',
      // React Compiler is not enabled. Keep its optimization diagnostics visible
      // while retaining rules-of-hooks and all other correctness checks as errors.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/error-boundaries': 'warn',
      'react-hooks/immutability': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
    },
  },
  {
    files: ['**/*.{js,cjs}'],
    // These Node configuration and maintenance scripts intentionally use CommonJS.
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
]);
