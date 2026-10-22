import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { startHealthServer } from '../src/health';

let server: Server | undefined;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => {
    server!.close(() => resolve());
    server!.closeAllConnections();
  });
  server = undefined;
});

async function listen() {
  server = startHealthServer(0);
  if (!server.listening) {
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
  }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('health server has no port');
  return `http://127.0.0.1:${address.port}`;
}

describe('worker health endpoint', () => {
  it('reports ok while the process is accepting connections', async () => {
    const base = await listen();

    const response = await fetch(`${base}/healthz`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  it('does not answer unknown paths', async () => {
    const base = await listen();

    const response = await fetch(`${base}/metrics`);

    expect(response.status).toBe(404);
  });
});
