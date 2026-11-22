import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@design-ai/design-schema': fileURLToPath(
        new URL('./packages/design-schema/src/index.ts', import.meta.url),
      ),
      '@design-ai/editor-core': fileURLToPath(
        new URL('./packages/editor-core/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: [
      'packages/*/test/**/*.test.{ts,tsx}',
      'apps/*/test/**/*.test.{ts,tsx}',
    ],
    restoreMocks: true,
  },
});
