import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Node does not read the repo-root `.env` when a script runs from a workspace
 * package, so `app:*` and `db:*` entrypoints call this first. Values already
 * present in the environment win: `loadEnvFile` never overwrites them.
 */
export function loadEnv() {
  const here = path.dirname(fileURLToPath(import.meta.url));

  for (const candidate of [
    path.resolve(process.cwd(), '.env'),
    path.resolve(here, '../../../.env'),
  ]) {
    try {
      process.loadEnvFile(candidate);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
