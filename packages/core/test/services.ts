import net from 'node:net';

function canConnect(url: string | undefined, defaultPort: number) {
  if (!url) return Promise.resolve(false);
  let host: string;
  let port: number;
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    port = Number(parsed.port || defaultPort);
  } catch {
    return Promise.resolve(false);
  }

  return new Promise<boolean>((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(750, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/**
 * Integration tests need the local Postgres and Redis. When either is missing
 * the suite skips instead of failing, so a clean checkout can still typecheck
 * and run unit tests.
 */
export async function servicesAvailable() {
  if (process.env.NODE_ENV === 'production') return false;
  const [db, redis] = await Promise.all([
    canConnect(process.env.DATABASE_URL, 5432),
    canConnect(process.env.REDIS_URL, 6379),
  ]);
  const available = db && redis;

  // A local checkout may legitimately run only the unit tests, but CI must
  // never report green while the integration suites have quietly skipped.
  if (!available && process.env.CI && process.env.CI !== 'false') {
    throw new Error(
      '[tests] Postgres and Redis are required in CI; integration tests would otherwise skip silently.',
    );
  }

  return available;
}
