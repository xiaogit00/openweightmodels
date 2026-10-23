import { describe, expect, it } from 'vitest';
import { configuredAppUrl } from '../src/app-url';
import { databaseUrlFromEnv, hasDatabaseConfig } from '../src/db/client';
import { hasRedisConfig, redisConnectionConfig } from '../src/redis';

describe('app URL configuration', () => {
  it('reads the runtime APP_URL and falls back to the legacy public variable', () => {
    expect(
      configuredAppUrl({ APP_URL: 'https://staging.example.com', NEXT_PUBLIC_APP_URL: 'https://old' }),
    ).toBe('https://staging.example.com');
    expect(configuredAppUrl({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })).toBe(
      'http://localhost:3000',
    );
    expect(configuredAppUrl({ APP_URL: '  ' })).toBeUndefined();
  });
});

describe('database configuration', () => {
  it('prefers an explicit DATABASE_URL', () => {
    expect(
      databaseUrlFromEnv({
        DATABASE_URL: 'postgres://url-user@db.internal:5432/app',
        DB_HOST: 'ignored.internal',
      }),
    ).toBe('postgres://url-user@db.internal:5432/app');
  });

  it('assembles the URL from ECS-injected parts and encodes them', () => {
    expect(
      databaseUrlFromEnv({
        DB_HOST: 'db.internal',
        DB_PORT: '5432',
        DB_NAME: 'open weightmodels',
        DB_USER: 'owm user',
        DB_PASSWORD: 'p@ss:word/with?chars',
        DB_SSL: 'true',
      }),
    ).toBe(
      'postgres://owm%20user:p%40ss%3Aword%2Fwith%3Fchars@db.internal:5432/open%20weightmodels?sslmode=require',
    );
  });

  it('defaults the database name and port', () => {
    expect(
      databaseUrlFromEnv({ DB_HOST: 'db.internal', DB_USER: 'owm', DB_PASSWORD: 'secret' }),
    ).toBe('postgres://owm:secret@db.internal:5432/openweightmodels');
  });

  it('names the missing variables instead of connecting to localhost', () => {
    expect(() => databaseUrlFromEnv({})).toThrow(/DB_HOST/);
    expect(() => databaseUrlFromEnv({ DB_HOST: 'db.internal' })).toThrow(/DB_USER/);
    expect(() =>
      databaseUrlFromEnv({ DB_HOST: 'db.internal', DB_USER: 'owm' }),
    ).toThrow(/DB_PASSWORD/);
  });

  it('reports whether a database is configured', () => {
    expect(hasDatabaseConfig({})).toBe(false);
    expect(hasDatabaseConfig({ DB_HOST: 'db.internal' })).toBe(true);
    expect(hasDatabaseConfig({ DATABASE_URL: 'postgres://localhost/app' })).toBe(true);
  });
});

describe('redis configuration', () => {
  it('prefers an explicit REDIS_URL', () => {
    expect(
      redisConnectionConfig({ REDIS_URL: 'redis://cache:6379', REDIS_HOST: 'ignored' }),
    ).toBe('redis://cache:6379');
  });

  it('keeps the local default when nothing is configured', () => {
    expect(redisConnectionConfig({})).toBe('redis://localhost:6379');
  });

  it('builds authenticated TLS options for ElastiCache', () => {
    expect(
      redisConnectionConfig({
        REDIS_HOST: 'cache.internal',
        REDIS_PORT: '6380',
        REDIS_PASSWORD: 'token',
        REDIS_TLS: 'true',
      }),
    ).toEqual({
      host: 'cache.internal',
      port: 6380,
      password: 'token',
      tls: {},
    });
  });

  it('reports whether Redis is configured', () => {
    expect(hasRedisConfig({})).toBe(false);
    expect(hasRedisConfig({ REDIS_HOST: 'cache.internal' })).toBe(true);
    expect(hasRedisConfig({ REDIS_URL: 'redis://cache:6379' })).toBe(true);
  });
});
