import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

describe('production images', () => {
  const dockerfile = read('Dockerfile');

  it('builds a Next standalone web image and a worker image', () => {
    expect(dockerfile).toMatch(/FROM base AS web/);
    expect(dockerfile).toMatch(/FROM base AS worker/);
    expect(dockerfile).toContain(
      'COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./',
    );
    expect(dockerfile).toContain(
      'COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static',
    );
    expect(dockerfile).toContain('USER node');
    expect(dockerfile).toMatch(/CMD \["node", "apps\/web\/server\.js"\]/);
  });

  it('runs the worker from a production-only dependency tree', () => {
    expect(dockerfile).toContain('pnpm install --frozen-lockfile --prod');
    expect(dockerfile).toContain(
      'CMD ["apps/worker/node_modules/.bin/tsx", "apps/worker/src/index.ts"]',
    );
    expect(dockerfile).toContain('COPY --chown=node:node packages/core/drizzle');
  });
});

describe('staging release script', () => {
  const script = read('infra/scripts/deploy.sh');

  it('runs the migration task before any service update', () => {
    const migration = script.indexOf('aws ecs run-task');
    const serviceUpdate = script.indexOf('aws ecs update-service');
    expect(migration).toBeGreaterThan(-1);
    expect(serviceUpdate).toBeGreaterThan(-1);
    expect(migration).toBeLessThan(serviceUpdate);
    expect(script).toContain('aws ecs wait tasks-stopped');
    expect(script).toContain('aws ecs wait services-stable');
  });

  it('refuses an empty provider key before releasing the worker', () => {
    expect(script).toContain('get-secret-value');
    expect(script).toContain('The provider key secret is empty');
    expect(script.indexOf('The provider key secret is empty')).toBeLessThan(
      script.indexOf('aws ecs run-task'),
    );
  });

  it('validates the hosted zone before creating any resources', () => {
    expect(script).toContain('aws route53 get-hosted-zone');
    expect(script).toContain('was not found');
    expect(script.indexOf('get-hosted-zone')).toBeLessThan(
      script.indexOf('deploy "$FOUNDATION"'),
    );
  });

  it('pins the image tag and the ARM64 platform', () => {
    expect(script).toContain('linux/arm64');
    expect(script).toContain('--target web');
    expect(script).toContain('--target worker');
    expect(script).toContain('IMAGE_TAG');
  });
});
