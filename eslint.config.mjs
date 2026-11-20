import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['**/.vite/', '**/dist/', '**/out/', '.husky/_/']),
  {
    files: ['**/*.{cjs,js,mjs,cts,mts,ts}'],
    extends: [js.configs.recommended],
  },
  {
    files: ['**/*.{cts,mts,ts}'],
    extends: [tseslint.configs.recommended],
  },
  {
    files: [
      '**/*.config.{cjs,js,mjs,cts,mts,ts}',
      '**/scripts/**/*.{cjs,js,mjs,cts,mts,ts}',
      'apps/desktop/src/{main,preload}.ts',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/desktop/src/renderer.ts'],
    languageOptions: { globals: globals.browser },
  },
);
