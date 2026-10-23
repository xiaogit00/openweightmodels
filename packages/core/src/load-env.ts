import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Node does not read the repo-root `.env` when a script runs from a workspace
 * package, so `app:*` and `db:*` entrypoints call this first. Next.js also
 * reads `.env.local`, so scripts do too. Values already present in the
 * environment win, and for the same directory `.env.local` wins over `.env`:
 * `loadEnvFile` never overwrites a value that is already set, so the more
 * specific file loads first.
 */
export function loadEnv() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const roots = [process.cwd(), path.resolve(here, '../../..')].filter(
    (root, index, all) => all.indexOf(root) === index,
  );

  for (const root of roots) {
    for (const file of ['.env.local', '.env']) {
      try {
        process.loadEnvFile(path.join(root, file));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
}
