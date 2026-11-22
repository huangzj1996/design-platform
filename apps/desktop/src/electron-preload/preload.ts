import { contextBridge, ipcRenderer } from 'electron';
import {
  CLOSE_REQUEST_CHANNEL,
  CONFIRM_CLOSE_CHANNEL,
  CREATE_DESIGN_FILE_CHANNEL,
  LOAD_SESSION_CHANNEL,
  OPEN_DESIGN_FILE_CHANNEL,
  OPEN_DESIGN_FILE_PATH_CHANNEL,
  SAVE_DESIGN_FILE_CHANNEL,
  SAVE_SESSION_CHANNEL,
  type DesignAiApi,
} from './contract';

const api: DesignAiApi = {
  openDesignFile: () => ipcRenderer.invoke(OPEN_DESIGN_FILE_CHANNEL),
  openDesignFileAt: (filePath) =>
    ipcRenderer.invoke(OPEN_DESIGN_FILE_PATH_CHANNEL, filePath),
  createDesignFile: () => ipcRenderer.invoke(CREATE_DESIGN_FILE_CHANNEL),
  saveDesignFile: (input) =>
    ipcRenderer.invoke(SAVE_DESIGN_FILE_CHANNEL, input),
  loadSession: () => ipcRenderer.invoke(LOAD_SESSION_CHANNEL),
  saveSession: (session) => ipcRenderer.invoke(SAVE_SESSION_CHANNEL, session),
  onCloseRequest: (listener) => {
    ipcRenderer.on(CLOSE_REQUEST_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(CLOSE_REQUEST_CHANNEL, listener);
    };
  },
  confirmClose: () => {
    ipcRenderer.send(CONFIRM_CLOSE_CHANNEL);
  },
};

contextBridge.exposeInMainWorld('designAi', api);
