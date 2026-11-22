import { contextBridge, ipcRenderer } from 'electron';
import {
  OPEN_DESIGN_FILE_CHANNEL,
  type DesignAiApi,
} from './shared/open-design-file';

const api: DesignAiApi = {
  openDesignFile: () => ipcRenderer.invoke(OPEN_DESIGN_FILE_CHANNEL),
};

contextBridge.exposeInMainWorld('designAi', api);
