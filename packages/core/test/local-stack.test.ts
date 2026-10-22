/**
 * Guards the one-command local stack contract. Docker is not available in
 * every environment (and not in CI yet), so parse the compose file here and
 * fail on the mistakes that only show up at `docker compose up` time.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const compose = parse(read('docker-compose.yml'), { merge: true }) as {
  services: Record<string, any>;
  volumes: Record<string, unknown>;
};

const appServices = ['migrate', 'web', 'worker'];

describe('local stack compose file', () => {
  it('defines the complete stack', () => {
    expect(Object.keys(compose.services).sort()).toEqual([
      'mailpit',
      'migrate',
      'postgres',
      'redis',
      'web',
      'worker',
    ]);
  });

  it('runs web, worker and migrations from the same development image', () => {
    for (const name of appServices) {
      expect(compose.services[name].build).toEqual({
        context: '.',
        dockerfile: 'Dockerfile',
        target: 'dev',
      });
    }
  });

  it('orders startup behind healthy infrastructure and finished migrations', () => {
    expect(compose.services.migrate.depends_on.postgres.condition).toBe('service_healthy');

    for (const name of ['web', 'worker']) {
      expect(compose.services[name].depends_on.migrate.condition).toBe(
        'service_completed_successfully',
      );
      expect(compose.services[name].depends_on.redis.condition).toBe('service_healthy');
    }
    expect(compose.services.web.depends_on.mailpit.condition).toBe('service_healthy');
  });

  it('health-checks every long-running service', () => {
    for (const name of ['postgres', 'redis', 'mailpit', 'web', 'worker']) {
      expect(compose.services[name].healthcheck?.test, `${name} healthcheck`).toBeDefined();
    }
  });

  it('points app containers at compose services, never localhost', () => {
    for (const name of appServices) {
      const environment = compose.services[name].environment;
      expect(environment.DATABASE_URL, name).toContain('@postgres:5432/openweightmodels');
      expect(environment.REDIS_URL, name).toContain('redis:6379');
      // Mock remains the default; a shell-exported PROVIDER/key switches the
      // same stack to real generation without editing this file.
      expect(environment.PROVIDER, name).toBe('${PROVIDER:-mock}');
    }

    // Only the worker calls a provider, so only it receives the key.
    expect(compose.services.worker.environment.OPENROUTER_API_KEY).toBe(
      '${OPENROUTER_API_KEY:-}',
    );
    expect(compose.services.web.environment.OPENROUTER_API_KEY).toBeUndefined();
  });

  it('keeps database and queue data in named volumes', () => {
    expect(compose.services.postgres.volumes).toContain('postgres-data:/var/lib/postgresql/data');
    expect(compose.services.redis.volumes).toContain('redis-data:/data');
    expect(Object.keys(compose.volumes).sort()).toEqual(['postgres-data', 'redis-data']);
    // ADR-0004: Redis is transport only and must not evict queue data.
    expect(compose.services.redis.command.join(' ')).toContain('noeviction');
  });

  it('bind-mounts the source into every app container', () => {
    for (const name of appServices) {
      expect(compose.services[name].volumes, name).toContain('.:/app');
    }
  });

  it('pins images instead of tracking latest', () => {
    for (const name of ['postgres', 'redis', 'mailpit']) {
      expect(compose.services[name].image, name).toMatch(/:[0-9v]/);
      expect(compose.services[name].image, name).not.toMatch(/:latest$/);
    }
  });

  it('does not load a local .env into containers', () => {
    expect(read('docker-compose.yml')).not.toMatch(/env_file/);
    expect(read('.gitignore').split('\n')).toContain('.env');
  });

  it('documents every host port used by compose in .env.example', () => {
    const example = read('.env.example');
    for (const key of [
      'POSTGRES_PORT',
      'REDIS_PORT',
      'MAILPIT_SMTP_PORT',
      'MAILPIT_UI_PORT',
      'WEB_PORT',
      'WORKER_HEALTH_PORT',
    ]) {
      expect(example, key).toContain(key);
    }
  });

  it('installs the exact lockfile into the image', () => {
    const dockerfile = read('Dockerfile');
    expect(dockerfile).toContain('pnpm install --frozen-lockfile');
    expect(dockerfile).toContain('COPY packages/core/package.json packages/core/');
    expect(read('.dockerignore')).toContain('**/node_modules');
  });
});
