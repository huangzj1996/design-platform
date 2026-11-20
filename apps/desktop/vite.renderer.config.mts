import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // WSL forwards the IPv4 loopback to the Windows Electron process.
    host: process.env.WSL_DISTRO_NAME ? '127.0.0.1' : undefined,
  },
});
