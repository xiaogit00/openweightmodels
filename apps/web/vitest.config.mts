import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `next build` copies the workspace into `.next/standalone`; never run the
    // copied test files there.
    exclude: ['**/node_modules/**', '**/.next/**', '**/dist/**'],
  },
});
