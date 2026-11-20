import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { PluginBase } from '@electron-forge/plugin-base';
import { extract } from '@electron-internal/extract-zip';
import { downloadArtifact, initializeProxy } from '@electron/get';
import checksums from 'electron/checksums.json' with { type: 'json' };
import electron from 'electron/package.json' with { type: 'json' };

const run = promisify(execFile);

export class WindowsElectronPlugin extends PluginBase {
  name = 'windows-electron';

  async startLogic() {
    if (process.platform !== 'linux' || !process.env.WSL_DISTRO_NAME) {
      return false;
    }

    const { stdout: localAppData } = await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "[Console]::OutputEncoding = [Text.Encoding]::UTF8; [Environment]::GetFolderPath('LocalApplicationData')",
    ]);
    const { stdout: cacheHome } = await run('wslpath', [
      '-u',
      localAppData.trim(),
    ]);
    // Keep Chromium's executable and DLLs on a Windows drive. The app source
    // stays in WSL, which Windows inherits as the working directory.
    const cache = path.join(cacheHome.trim(), 'design-ai', 'Cache', 'electron');
    const { version } = electron;
    const { arch } = process;
    const dist = path.join(cache, `${version}-win32-${arch}`);
    const executable = path.join(dist, 'electron.exe');
    if (existsSync(executable)) {
      return executable;
    }

    if (process.env.HTTPS_PROXY || process.env.https_proxy) {
      initializeProxy();
    }
    const zip = await downloadArtifact({
      artifactName: 'electron',
      version,
      platform: 'win32',
      arch,
      checksums,
    });

    await mkdir(cache, { recursive: true });
    const staging = await mkdtemp(path.join(cache, '.extract-'));
    try {
      await extract(zip, { dir: staging });
      await rename(staging, dist);
    } catch (error) {
      // Another start may have published the same version first.
      if (!existsSync(executable)) {
        throw error;
      }
    } finally {
      await rm(staging, { recursive: true, force: true });
    }

    return executable;
  }
}
