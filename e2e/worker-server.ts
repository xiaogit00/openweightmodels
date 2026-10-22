/**
 * Runs the generation worker as a Playwright web server. Playwright needs a
 * port to call "ready", so this wrapper opens a health socket and forwards
 * termination to the worker's process group.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import { workerReadyPort } from './config';

const root = process.cwd();

const worker = spawn('pnpm', ['--filter', '@owm/worker', 'exec', 'tsx', 'src/index.ts'], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
  // A dedicated process group lets shutdown reach pnpm and its tsx child.
  detached: true,
});

const health = net.createServer().listen(workerReadyPort, '127.0.0.1');
let shuttingDown = false;

function shutdown() {
  shuttingDown = true;
  health.close();
  if (worker.pid) {
    try {
      process.kill(-worker.pid, 'SIGTERM');
      return;
    } catch {
      // Fall through when the group has already gone.
    }
  }
  worker.kill('SIGTERM');
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

worker.on('exit', (code, signal) => {
  health.close();
  if (shuttingDown) process.exit(0);
  if (signal) {
    console.error(`[e2e-worker] exited with ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});
