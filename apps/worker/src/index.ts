import './env';
import { RUN_QUEUE, closeDb, closeRedis, closeRunQueue } from '@owm/core';
import { startHealthServer } from './health';
import { startQueueMetrics } from './metrics';
import { createRunWorker } from './worker';

const worker = createRunWorker();
console.log(`[worker] consuming ${RUN_QUEUE} with concurrency ${worker.opts.concurrency}`);

// A CloudWatch Logs metric filter turns the periodic JSON line into queue
// depth. Disabled locally; the ECS task sets QUEUE_METRICS=true.
const queueMetrics = startQueueMetrics();

// Off by default so local `pnpm dev:worker` and the E2E worker do not fight
// over a port; the container sets it so compose can health-check the process.
const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 0);
const health =
  Number.isInteger(healthPort) && healthPort > 0 ? startHealthServer(healthPort) : null;

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] ${signal} received, shutting down`);

  try {
    if (health) {
      await new Promise<void>((resolve) => {
        health.close(() => resolve());
        health.closeAllConnections();
      });
    }
    queueMetrics?.stop();
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
