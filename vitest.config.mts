import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      '@design-ai/design-schema/legacy': fileURLToPath(
        new URL('./packages/design-schema/src/legacy.ts', import.meta.url),
      ),
      '@design-ai/design-schema': fileURLToPath(
        new URL('./packages/design-schema/src/index.ts', import.meta.url),
      ),
      '@design-ai/editor-core/leafer': fileURLToPath(
        new URL('./packages/editor-core/src/leafer.ts', import.meta.url),
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
