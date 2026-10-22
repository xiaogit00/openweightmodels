import { createServer, type Server } from 'node:http';

/**
 * Liveness endpoint for container health checks. The process only listens when
 * `WORKER_HEALTH_PORT` is set, so local and E2E runs keep their ports free.
 */
export function startHealthServer(port: number): Server {
  const server = createServer((request, response) => {
    if (request.url !== '/healthz') {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
  });

  server.on('error', (error) => {
    console.error('[worker] health server error', error);
  });

  server.listen(port, '0.0.0.0', () => {
    const address = server.address();
    const bound = typeof address === 'object' && address ? address.port : port;
    console.log(`[worker] health on :${bound}/healthz`);
  });

  return server;
}
