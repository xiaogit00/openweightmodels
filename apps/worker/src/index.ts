import './env';
import { RUN_QUEUE, closeDb, closeRedis, closeRunQueue } from '@owm/core';
import { createRunWorker } from './worker';

const worker = createRunWorker();
console.log(`[worker] consuming ${RUN_QUEUE} with concurrency ${worker.opts.concurrency}`);

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] ${signal} received, shutting down`);

  try {
    await worker.close();
    await closeRunQueue();
    await closeRedis();
    await closeDb();
    process.exit(0);
  } catch (error) {
    console.error('[worker] shutdown failed', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
