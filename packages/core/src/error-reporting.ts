import { randomBytes } from 'node:crypto';

/**
 * Error reporting is Sentry-compatible but has no SDK dependency: an event is
 * POSTed as a Sentry envelope with `fetch`. When `SENTRY_DSN` is unset the same
 * structured record is written to stdout, so a failed Run is never silent.
 *
 * A failed Run needs more than a stack trace: the response, job, comparison,
 * model, turn and attempt identify which provider call failed and what the
 * Job page showed.
 */
export type ErrorContext = Record<string, unknown>;

export type ReportOptions = {
  dsn?: string;
  environment?: string;
  release?: string;
  /** Injected in tests; production uses the global fetch. */
  fetchImpl?: typeof fetch;
};

const SENSITIVE_KEY = /(api_?key|secret|password|authorization|bearer|token$)/i;

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]'],
  [/(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s]+@/gi, '$1[redacted]@'],
];

export function redactText(value: string): string {
  return SECRET_PATTERNS.reduce((text, [pattern, replacement]) => {
    pattern.lastIndex = 0;
    return text.replace(pattern, replacement);
  }, value);
}

export function redactContext(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (typeof value === 'string') return redactText(value).slice(0, 4_000);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (value === undefined) return undefined;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message).slice(0, 1_000),
      stack: value.stack ? redactText(value.stack).slice(0, 8_000) : undefined,
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => redactContext(entry, depth + 1));
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redactContext(entry, depth + 1);
    }
    return result;
  }
  return String(value);
}

export type SentryDsn = {
  endpoint: string;
  publicKey: string;
  projectId: string;
};

export function parseSentryDsn(dsn: string | undefined): SentryDsn | null {
  if (!dsn?.trim()) return null;
  let url: URL;
  try {
    url = new URL(dsn.trim());
  } catch {
    return null;
  }
  if (!url.username) return null;
  const segments = url.pathname.split('/').filter(Boolean);
  const projectId = segments.pop();
  if (!projectId || !/^\d+$/.test(projectId)) return null;
  const prefix = segments.length ? `/${segments.join('/')}` : '';
  const endpoint = `${url.origin}${prefix}/api/${projectId}/envelope/?sentry_version=7&sentry_key=${encodeURIComponent(url.username)}&sentry_client=owm-error-reporter/1.0.0`;
  return { endpoint, publicKey: url.username, projectId };
}

function stackFrames(error: Error) {
  if (!error.stack) return [];
  return error.stack
    .split('\n')
    .slice(1)
    .map((line) => {
      const match = line.trim().match(/^at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/);
      if (!match) return null;
      const [, fn, filename, lineno, colno] = match;
      return {
        filename,
        function: fn,
        lineno: Number(lineno),
        colno: Number(colno),
        in_app: !filename?.includes('node_modules'),
      };
    })
    .filter((frame): frame is NonNullable<typeof frame> => frame !== null)
    .reverse();
}

export type SentryEvent = {
  event_id: string;
  timestamp: number;
  platform: 'node';
  level: 'error';
  logger: string;
  environment?: string;
  release?: string;
  message: string;
  tags: Record<string, string>;
  extra: Record<string, unknown>;
  exception: {
    values: Array<{
      type: string;
      value: string;
      stacktrace?: { frames: ReturnType<typeof stackFrames> };
    }>;
  };
};

export function buildSentryEvent(
  error: unknown,
  context: ErrorContext = {},
  options: Pick<ReportOptions, 'environment' | 'release'> = {},
): SentryEvent {
  const normalised =
    error instanceof Error
      ? error
      : new Error(typeof error === 'string' ? error : JSON.stringify(redactContext(error)));
  const redacted = redactContext(context) as Record<string, unknown>;

  const tags: Record<string, string> = {};
  for (const key of ['jobId', 'comparisonId', 'responseId', 'modelSlug', 'turnId']) {
    const value = redacted[key];
    if (typeof value === 'string') tags[key] = value;
  }

  return {
    event_id: randomBytes(16).toString('hex'),
    timestamp: Date.now() / 1000,
    platform: 'node',
    level: 'error',
    logger: 'owm',
    environment: options.environment,
    release: options.release,
    message: redactText(normalised.message).slice(0, 500),
    tags,
    extra: redacted,
    exception: {
      values: [
        {
          type: normalised.name,
          value: redactText(normalised.message).slice(0, 1_000),
          stacktrace: { frames: stackFrames(normalised) },
        },
      ],
    },
  };
}

export function buildSentryEnvelope(event: SentryEvent, dsn: string): string | null {
  const parsed = parseSentryDsn(dsn);
  if (!parsed) return null;

  const eventJson = JSON.stringify(event);
  const envelopeHeader = JSON.stringify({
    event_id: event.event_id,
    sent_at: new Date().toISOString(),
    sdk: { name: 'owm-error-reporter', version: '1.0.0' },
    dsn,
  });
  const itemHeader = JSON.stringify({ type: 'event', length: Buffer.byteLength(eventJson) });
  return `${envelopeHeader}\n${itemHeader}\n${eventJson}`;
}

/**
 * Report once, never throw: an error in the reporter must not replace the
 * original failure. The structured log is the fallback when Sentry is not
 * configured or cannot be reached.
 */
export async function reportError(
  error: unknown,
  context: ErrorContext = {},
  options: ReportOptions = {},
): Promise<void> {
  const dsn = options.dsn ?? process.env.SENTRY_DSN;
  const environment =
    options.environment ?? process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV;
  const release = options.release ?? process.env.SENTRY_RELEASE;
  const event = buildSentryEvent(error, context, { environment, release });

  console.error(
    JSON.stringify({
      level: 'error',
      kind: 'error.report',
      eventId: event.event_id,
      name: event.exception.values[0]?.type,
      message: event.message,
      context: event.extra,
    }),
  );

  const envelope = dsn ? buildSentryEnvelope(event, dsn) : null;
  const parsed = dsn ? parseSentryDsn(dsn) : null;
  if (!envelope || !parsed) return;

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    await fetchImpl(parsed.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-sentry-envelope' },
      body: envelope,
      signal: AbortSignal.timeout(2_000),
    });
  } catch (sendError) {
    console.error(
      JSON.stringify({
        level: 'warn',
        kind: 'error.report.failed',
        eventId: event.event_id,
        message: sendError instanceof Error ? sendError.message : String(sendError),
      }),
    );
  }
}
