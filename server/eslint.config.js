import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**'] },

  js.configs.recommended,

  // Server code + build scripts run in Node (ESM).
  {
    files: ['src/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  // Browser code (Sala + phone). ES modules served as-is, no build step.
  {
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, webkitAudioContext: 'readonly' },
    },
  },

  // Tests run in Node with the built-in node:test runner.
  {
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  // A first pass shouldn't fail the build on unused vars; no-undef (the rule
  // that catches a typo'd DOM lookup or a missing global) stays an error.
  // Empty catch blocks are idiomatic best-effort cleanup all over this
  // codebase (try { ctx.close() } catch {}), so allow them — no-empty still
  // flags a genuinely empty if/for/while, which would be a real bug.
  {
    rules: {
      'no-unused-vars': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
