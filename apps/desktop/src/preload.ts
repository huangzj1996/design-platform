import { contextBridge, ipcRenderer } from 'electron';
import {
  CLOSE_REQUEST_CHANNEL,
  CONFIRM_CLOSE_CHANNEL,
  CREATE_DESIGN_FILE_CHANNEL,
  OPEN_DESIGN_FILE_CHANNEL,
  SAVE_DESIGN_FILE_CHANNEL,
  type DesignAiApi,
} from './shared/open-design-file';

const api: DesignAiApi = {
  openDesignFile: () => ipcRenderer.invoke(OPEN_DESIGN_FILE_CHANNEL),
  createDesignFile: () => ipcRenderer.invoke(CREATE_DESIGN_FILE_CHANNEL),
  saveDesignFile: (input) =>
    ipcRenderer.invoke(SAVE_DESIGN_FILE_CHANNEL, input),
  onCloseRequest: (listener) => {
    const handler = () => {
      listener();
    };
    ipcRenderer.on(CLOSE_REQUEST_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(CLOSE_REQUEST_CHANNEL, handler);
    };
  },
  confirmClose: () => {
    ipcRenderer.send(CONFIRM_CLOSE_CHANNEL);
  },
};

contextBridge.exposeInMainWorld('designAi', api);
