import console from 'node:console';
import { createConnection } from 'node:net';
import process from 'node:process';
import { pipeline } from 'node:stream/promises';

const socketPath = process.env.SANDCASTLE_PENCIL_SOCKET;
if (!socketPath) throw new Error('SANDCASTLE_PENCIL_SOCKET is required');

const socket = createConnection(socketPath);
try {
  await Promise.all([
    pipeline(process.stdin, socket),
    pipeline(socket, process.stdout, { end: false }),
  ]);
} catch (error) {
  console.error(`Pencil MCP relay: ${error.message}`);
  process.exitCode = 1;
}
