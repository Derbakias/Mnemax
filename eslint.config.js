// ESLint reads the code and points out likely mistakes.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import maxInlineUtilities from './eslint-rules/max-inline-utilities.js';

// The React hooks checks. Breaking the main hooks rule stays an error;
// every other check only warns for now, until we tidy those spots up.
const hooks = reactHooks.configs.flat.recommended;
const hookWarnings = Object.fromEntries(Object.keys(hooks.rules).map((rule) => [rule, 'warn']));

export default defineConfig([
  // Folders that are built, downloaded, or not our web code.
  globalIgnores(['dist', 'release', 'src-tauri', 'node_modules', '.planning', '.claude']),
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    extends: [js.configs.recommended, tseslint.configs.recommended, hooks],
    rules: {
      ...hookWarnings,
      'react-hooks/rules-of-hooks': 'error',
      // Always wrap if, else and loop bodies in { } braces.
      curly: ['error', 'all'],
      // Taking a field out with `{ field: _, ...rest }` is fine.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  // Tests break saved data on purpose to check it's caught, so they may use loose types.
  { files: ['**/__tests__/**'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
  // A className lists at most 6 classes inline; longer lists go in a styles object (see the rule's file).
  {
    files: ['src/**/*.tsx'],
    plugins: { local: { rules: { 'max-inline-utilities': maxInlineUtilities } } },
    rules: { 'local/max-inline-utilities': ['error', 6] },
  },
  // The app runs in a browser.
  { files: ['src/**'], languageOptions: { globals: globals.browser } },
  // Build tools run in Node.
  {
    files: ['vite.config.ts', 'scripts/**', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
]);
