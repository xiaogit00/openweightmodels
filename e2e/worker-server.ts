/**
 * Runs the generation worker as a Playwright web server. Playwright needs a
 * port to call "ready", so this wrapper opens a health socket and forwards
 * termination to the worker process group.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';

const readyPort = Number(process.env.E2E_WORKER_READY_PORT ?? 3199);
const root = process.cwd();

const worker = spawn('pnpm', ['--filter', '@owm/worker', 'exec', 'tsx', 'src/index.ts'], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});

const health = net.createServer().listen(readyPort, '127.0.0.1');

function shutdown() {
  health.close();
  worker.kill('SIGTERM');
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

worker.on('exit', (code, signal) => {
  health.close();
  if (signal) {
    console.error(`[e2e-worker] exited with ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});
