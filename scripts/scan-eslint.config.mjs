/**
 * Standalone flat config used ONLY by `scripts/scan-local.mjs`, to run the
 * scanner's `no-restricted-globals` / `no-console` rules over the compiled JS
 * that would actually be published.
 *
 * It is a real file rather than an inline `--config-json` payload because ESLint
 * 9.32 (the pinned version here) has no `--config-json` flag — it answers with
 * "Invalid option '--config-json' - perhaps you meant '--config-lookup'?". A file
 * also makes the rule set reviewable in a diff, which an inline JSON blob is not.
 *
 * Deliberately NOT the package's own `eslint.config.mjs`: that one is
 * TypeScript-aware and scoped to `nodes/`, `credentials/` and `src/`. This one
 * looks at shipped JavaScript, which is a different question — what a consumer
 * of the tarball would run inside n8n's process.
 */
export default [
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
    },
    rules: {
      // The scanner refuses these in a community node: they are how a node
      // escapes its sandbox or writes into the host's stdout. AST-resolved, so
      // the word "process" inside a description string is correctly ignored.
      'no-restricted-globals': [
        'error',
        'setTimeout',
        'setInterval',
        'process',
        'globalThis',
        'Buffer',
      ],
      'no-console': 'error',
    },
  },
];
