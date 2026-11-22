import type { DesignAiApi } from '../electron-preload/contract';

declare global {
  interface Window {
    designAi?: DesignAiApi;
  }
}

export {};
