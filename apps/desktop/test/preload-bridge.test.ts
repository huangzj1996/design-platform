import { createBlankDocument } from '@design-ai/editor-core';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CLOSE_REQUEST_CHANNEL,
  CONFIRM_CLOSE_CHANNEL,
  CREATE_DESIGN_FILE_CHANNEL,
  OPEN_DESIGN_FILE_CHANNEL,
  SAVE_DESIGN_FILE_CHANNEL,
  type DesignAiApi,
  type SaveDesignFileInput,
} from '../src/electron-preload/contract';

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn<(name: string, api: DesignAiApi) => void>(),
  invoke: vi.fn(),
  on: vi.fn(),
  send: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: {
    invoke: electron.invoke,
    on: electron.on,
    send: electron.send,
    removeListener: electron.removeListener,
  },
}));

let exposedName: string;
let exposedApi: DesignAiApi;
let exposeCalls: number;

beforeAll(async () => {
  await import('../src/electron-preload/preload');
  exposeCalls = electron.exposeInMainWorld.mock.calls.length;
  [exposedName, exposedApi] = electron.exposeInMainWorld.mock.calls[0];
});

describe('preload bridge', () => {
  it('exposes the design API as window.designAi', () => {
    expect(exposeCalls).toBe(1);
    expect(exposedName).toBe('designAi');
    expect(exposedApi).toBeDefined();
  });

  it('opens design files through the open channel', async () => {
    await exposedApi.openDesignFile();

    expect(electron.invoke).toHaveBeenCalledWith(OPEN_DESIGN_FILE_CHANNEL);
  });

  it('creates design files through the create channel', async () => {
    await exposedApi.createDesignFile();

    expect(electron.invoke).toHaveBeenCalledWith(CREATE_DESIGN_FILE_CHANNEL);
  });

  it('saves design files through the save channel', async () => {
    const input: SaveDesignFileInput = {
      filePath: '/tmp/未命名.json',
      document: createBlankDocument(),
    };

    await exposedApi.saveDesignFile(input);

    expect(electron.invoke).toHaveBeenCalledWith(
      SAVE_DESIGN_FILE_CHANNEL,
      input,
    );
  });

  it('subscribes to and unsubscribes from close requests', () => {
    const listener = vi.fn();

    const unsubscribe = exposedApi.onCloseRequest(listener);

    expect(electron.on).toHaveBeenCalledWith(CLOSE_REQUEST_CHANNEL, listener);
    unsubscribe();
    expect(electron.removeListener).toHaveBeenCalledWith(
      CLOSE_REQUEST_CHANNEL,
      listener,
    );
  });

  it('confirms a close through the confirm channel', () => {
    exposedApi.confirmClose();

    expect(electron.send).toHaveBeenCalledWith(CONFIRM_CLOSE_CHANNEL);
  });
});
