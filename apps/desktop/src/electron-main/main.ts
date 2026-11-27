import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type OpenDialogOptions,
} from 'electron';
import path from 'node:path';
import { createDiagnostic } from '@design-ai/design-schema';
import started from 'electron-squirrel-startup';
import { createDesignFile } from './create-design-file';
import { readDesignFile } from './read-design-file';
import { DesignFileSaver } from './save-design-file';
import { SessionStore } from './session-store';
import {
  CLOSE_REQUEST_CHANNEL,
  CONFIRM_CLOSE_CHANNEL,
  CREATE_DESIGN_FILE_CHANNEL,
  DesktopDiagnosticCodes,
  LOAD_SESSION_CHANNEL,
  OPEN_DESIGN_FILE_CHANNEL,
  OPEN_DESIGN_FILE_PATH_CHANNEL,
  SAVE_DESIGN_FILE_CHANNEL,
  SAVE_SESSION_CHANNEL,
  type CreateDesignFileResult,
  type OpenDesignFileResult,
  type SaveDesignFileInput,
  type SaveDesignFileResult,
} from '../electron-preload/contract';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const confirmedCloseWindows = new WeakSet<BrowserWindow>();

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 500,
    minHeight: 350,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // The renderer flushes pending saves before the window is allowed to close.
  // A failed save keeps the window open and shows the retry entry.
  mainWindow.on('close', (event) => {
    if (confirmedCloseWindows.has(mainWindow)) {
      return;
    }
    event.preventDefault();
    mainWindow.webContents.send(CLOSE_REQUEST_CHANNEL);
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

const registerDesignFileHandlers = (projectDirectory: string) => {
  const saver = new DesignFileSaver({ projectDirectory });

  /** The validated snapshot read from disk becomes the saved baseline. */
  const rememberOpened = (
    result: OpenDesignFileResult,
  ): OpenDesignFileResult => {
    if (result.status === 'opened') {
      saver.rememberSaved(result.filePath, result.document);
    }
    return result;
  };

  ipcMain.handle(
    OPEN_DESIGN_FILE_CHANNEL,
    async (event): Promise<OpenDesignFileResult> => {
      const options: OpenDialogOptions = {
        title: '打开或导入设计稿',
        properties: ['openFile'],
        filters: [
          { name: '设计稿', extensions: ['json', 'pen'] },
          { name: 'Pencil 设计稿', extensions: ['pen'] },
          { name: '原生设计稿', extensions: ['json'] },
        ],
      };
      const browserWindow = BrowserWindow.fromWebContents(event.sender);
      const selection = browserWindow
        ? await dialog.showOpenDialog(browserWindow, options)
        : await dialog.showOpenDialog(options);

      if (selection.canceled || selection.filePaths.length === 0) {
        return { status: 'cancelled' };
      }

      return rememberOpened(await readDesignFile(selection.filePaths[0]));
    },
  );

  ipcMain.handle(
    OPEN_DESIGN_FILE_PATH_CHANNEL,
    async (_event, filePath: unknown): Promise<OpenDesignFileResult> => {
      if (typeof filePath !== 'string' || filePath.trim() === '') {
        return {
          status: 'failed',
          filePath: typeof filePath === 'string' ? filePath : '',
          errors: [
            createDiagnostic(
              DesktopDiagnosticCodes.openFailed,
              '$',
              '无效的设计稿路径',
            ),
          ],
        };
      }

      return rememberOpened(await readDesignFile(filePath));
    },
  );

  ipcMain.handle(
    CREATE_DESIGN_FILE_CHANNEL,
    async (): Promise<CreateDesignFileResult> => {
      const result = await createDesignFile(projectDirectory);
      if (result.status === 'created') {
        saver.rememberSaved(result.filePath, result.document);
      }
      return result;
    },
  );

  ipcMain.handle(
    SAVE_DESIGN_FILE_CHANNEL,
    async (
      _event,
      input: SaveDesignFileInput,
    ): Promise<SaveDesignFileResult> => {
      if (
        input === null ||
        typeof input !== 'object' ||
        (input.filePath !== null && typeof input.filePath !== 'string')
      ) {
        return {
          status: 'failed',
          filePath: null,
          errors: [
            createDiagnostic(
              DesktopDiagnosticCodes.fileWriteError,
              '$',
              '无效的保存请求',
            ),
          ],
        };
      }
      return saver.save(input);
    },
  );

  ipcMain.on(CONFIRM_CLOSE_CHANNEL, (event) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    if (browserWindow === null) {
      return;
    }
    confirmedCloseWindows.add(browserWindow);
    browserWindow.close();
  });
};

const registerSessionHandlers = (sessionFilePath: string) => {
  const store = new SessionStore({ filePath: sessionFilePath });

  ipcMain.handle(LOAD_SESSION_CHANNEL, () => store.load());
  ipcMain.handle(SAVE_SESSION_CHANNEL, (_event, session: unknown) =>
    store.save(session),
  );
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  const projectDirectory =
    process.env.DESIGN_AI_PROJECT_DIR ??
    path.join(app.getPath('documents'), 'design-ai');
  registerDesignFileHandlers(projectDirectory);
  registerSessionHandlers(
    path.join(app.getPath('userData'), 'design-session.json'),
  );
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
