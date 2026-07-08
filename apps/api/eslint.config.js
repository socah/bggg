const tseslint = require('typescript-eslint');

// ESLint 9+ replaced the old .eslintrc cascade with this "flat config"
// format — a plain array of config objects, applied in order. This file was
// missing entirely before (the project's `lint` script only appeared to
// work when a global ESLint happened to be on PATH; a fresh clone would
// fail with no config found, as it did in this session).
module.exports = tseslint.config(
  {
    // Compiled output is generated, not source — never lint it.
    ignores: ['dist/**'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // NestJS's constructor-injection pattern relies on parameter
      // properties (e.g. `constructor(private readonly x: X) {}`) where the
      // parameter is never referenced by name elsewhere in the file — the
      // recommended rule would otherwise flag every injected dependency as
      // an unused variable.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
);
