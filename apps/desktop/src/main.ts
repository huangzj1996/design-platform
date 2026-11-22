import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type OpenDialogOptions,
} from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { readDesignFile } from './main/read-design-file';
import {
  OPEN_DESIGN_FILE_CHANNEL,
  type OpenDesignFileResult,
} from './shared/open-design-file';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};

const registerOpenDesignFileHandler = () => {
  ipcMain.handle(
    OPEN_DESIGN_FILE_CHANNEL,
    async (event): Promise<OpenDesignFileResult> => {
      const options: OpenDialogOptions = {
        title: '打开设计稿',
        properties: ['openFile'],
        filters: [{ name: '设计稿', extensions: ['json'] }],
      };
      const browserWindow = BrowserWindow.fromWebContents(event.sender);
      const selection = browserWindow
        ? await dialog.showOpenDialog(browserWindow, options)
        : await dialog.showOpenDialog(options);

      if (selection.canceled || selection.filePaths.length === 0) {
        return { status: 'cancelled' };
      }

      return readDesignFile(selection.filePaths[0]);
    },
  );
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  registerOpenDesignFileHandler();
  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
