import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: { tsconfigPaths: true },
  server: {
    // WSL forwards the IPv4 loopback to the Windows Electron process.
    host: process.env.WSL_DISTRO_NAME ? '127.0.0.1' : undefined,
  },
});
