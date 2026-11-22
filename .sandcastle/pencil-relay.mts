import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rmdir } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const pencilServerSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
});

async function readPencilServer() {
  const configPath = join(homedir(), '.claude.json');
  const config = await readFile(configPath, 'utf8').catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    },
  );
  if (!config) return undefined;

  const server = pencilServerSchema.safeParse(
    JSON.parse(config)?.mcpServers?.pencil,
  );
  return server.success ? server.data : undefined;
}

export const pencilMcpHook = {
  command:
    'claude mcp add --scope user pencil -- node "$PWD/.sandcastle/pencil-mcp.mjs"',
};

export async function startPencilRelay() {
  const pencil = await readPencilServer();
  if (!pencil) return undefined;

  const directory = await mkdtemp(join(tmpdir(), 'sandcastle-pencil-'));
  const socketPath = join(directory, 'mcp.sock');
  const sockets = new Set<Socket>();
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    // Launch on the host so Pencil can reach the desktop app's named pipe on Windows.
    const child = spawn(pencil.command, pencil.args, {
      env: { ...process.env, ...pencil.env },
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      sockets.delete(socket);
      child.kill();
    });
    child.on('error', (error) => {
      console.error(`Could not start Pencil MCP: ${error.message}`);
      socket.destroy();
    });
    child.stdin.on('error', () => socket.destroy());
    socket.pipe(child.stdin);
    child.stdout.pipe(socket);
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    await rmdir(directory);
    throw error;
  }

  return {
    sandboxOptions: {
      env: { SANDCASTLE_PENCIL_SOCKET: socketPath },
      mounts: [{ hostPath: directory, sandboxPath: directory, readonly: true }],
    },
    async [Symbol.asyncDispose]() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rmdir(directory);
    },
  };
}
