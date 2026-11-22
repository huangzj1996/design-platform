/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

import type { DesignAiApi } from './shared/open-design-file';

declare global {
  interface Window {
    designAi?: DesignAiApi;
  }
}

export {};
