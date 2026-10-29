import { describe, expect, it, vi } from 'vitest';
import {
  buildSentryEnvelope,
  buildSentryEvent,
  parseSentryDsn,
  redactContext,
  redactText,
  reportError,
} from '../src/error-reporting';

const DSN = 'https://publickey@o123.ingest.sentry.io/456789';

describe('error reporting', () => {
  it('parses a Sentry DSN into an envelope endpoint', () => {
    expect(parseSentryDsn(DSN)).toEqual({
      endpoint:
        'https://o123.ingest.sentry.io/api/456789/envelope/?sentry_version=7&sentry_key=publickey&sentry_client=owm-error-reporter/1.0.0',
      publicKey: 'publickey',
      projectId: '456789',
    });
    expect(parseSentryDsn(undefined)).toBeNull();
    expect(parseSentryDsn('not a url')).toBeNull();
    expect(parseSentryDsn('https://key@host/not-a-project')).toBeNull();
  });

  it('builds an event with the Run context a failed generation needs', () => {
    const error = new Error('provider returned 500: upstream unavailable');
    error.stack = 'Error: boom\n    at processRun (packages/core/src/services/jobs.ts:300:12)';
    const event = buildSentryEvent(
      error,
      {
        responseId: 'response-1',
        jobId: 'job-1',
        comparisonId: 'comparison-1',
        modelSlug: 'deepseek-v4-1-flash',
        turnId: 'turn-2',
        attempt: 1,
        tokens: 123,
      },
      { environment: 'staging', release: 'abc123' },
    );

    expect(event.level).toBe('error');
    expect(event.environment).toBe('staging');
    expect(event.release).toBe('abc123');
    expect(event.event_id).toMatch(/^[a-f0-9]{32}$/);
    expect(event.tags).toMatchObject({
      responseId: 'response-1',
      jobId: 'job-1',
      comparisonId: 'comparison-1',
      modelSlug: 'deepseek-v4-1-flash',
    });
    expect(event.extra).toMatchObject({ turnId: 'turn-2', attempt: 1, tokens: 123 });
    expect(event.exception.values[0]).toMatchObject({
      type: 'Error',
      value: 'provider returned 500: upstream unavailable',
    });
    expect(event.exception.values[0]?.stacktrace?.frames[0]).toMatchObject({
      filename: 'packages/core/src/services/jobs.ts',
      function: 'processRun',
      lineno: 300,
      in_app: true,
    });
  });

  it('redacts secrets from messages and context', () => {
    expect(redactText('key sk-or-v1-abcdefghijklmnop failed')).toBe('key [redacted] failed');
    expect(redactText('Authorization: Bearer abc.def.ghi')).toBe(
      'Authorization: Bearer [redacted]',
    );
    expect(redactText('postgres://user:hunter2@db:5432/app')).toBe(
      'postgres://user:[redacted]@db:5432/app',
    );

    expect(
      redactContext({
        email: 'person@example.com',
        apiKey: 'sk-or-v1-secretvalue',
        nested: { password: 'hunter2', tokens: 12 },
        authorization: 'Bearer abc',
      }),
    ).toEqual({
      email: 'person@example.com',
      apiKey: '[redacted]',
      nested: { password: '[redacted]', tokens: 12 },
      authorization: '[redacted]',
    });
  });

  it('serialises a Sentry envelope with a matching item length', () => {
    const event = buildSentryEvent(new Error('boom'));
    const envelope = buildSentryEnvelope(event, DSN);
    expect(envelope).not.toBeNull();

    const lines = envelope!.split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!)).toMatchObject({ event_id: event.event_id, dsn: DSN });
    const itemHeader = JSON.parse(lines[1]!);
    expect(itemHeader.type).toBe('event');
    expect(itemHeader.length).toBe(Buffer.byteLength(lines[2]!));
    expect(JSON.parse(lines[2]!).message).toBe('boom');
  });

  it('posts an envelope when a DSN is configured and never throws on failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    await reportError(new Error('boom'), { jobId: 'job-1' }, { dsn: DSN, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]![0]).toContain('/api/456789/envelope/');
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/x-sentry-envelope' },
    });

    const failing = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(
      reportError(new Error('boom'), {}, { dsn: DSN, fetchImpl: failing }),
    ).resolves.toBeUndefined();
  });

  it('only logs when no DSN is configured', async () => {
    const fetchImpl = vi.fn();
    await reportError(new Error('boom'), { jobId: 'job-1' }, { dsn: '', fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
