import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb } from './client';

/**
 * Runs a database CLI only when its module is the process entrypoint, so the
 * same file can export a function for `db/init.ts` and still work via tsx.
 */
export function runAsScript(moduleUrl: string, run: () => Promise<void>) {
  const entrypoint = process.argv[1] ? resolve(process.argv[1]) : '';
  if (entrypoint !== fileURLToPath(moduleUrl)) return;

  run()
    .then(closeDb)
    .catch(async (error) => {
      console.error(error);
      await closeDb();
      process.exit(1);
    });
}
