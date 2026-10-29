export type DomainErrorOptions = {
  /** Seconds a client should wait before retrying, for 429 responses. */
  retryAfterSeconds?: number;
};

export class DomainError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(code: string, message: string, status = 400, options: DomainErrorOptions = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function notFound(message = 'Not found') {
  return new DomainError('not_found', message, 404);
}

export function forbidden(message = 'You do not have access to that.') {
  return new DomainError('forbidden', message, 403);
}

export function unauthorized(message = 'Sign in to continue.') {
  return new DomainError('unauthorized', message, 401);
}

export function conflict(code: string, message: string) {
  return new DomainError(code, message, 409);
}

/**
 * A 429 always carries retry guidance. The API turns `retryAfterSeconds` into a
 * `Retry-After` header and a `retryAfter` body field; the message names the
 * wait so a client that ignores headers still knows what to do.
 */
export function tooMany(message: string, retryAfterSeconds?: number) {
  const retry = retryAfterSeconds && retryAfterSeconds > 0 ? Math.ceil(retryAfterSeconds) : undefined;
  const guidance = retry
    ? ` ${retry === 1 ? 'Try again in 1 second.' : `Try again in ${retry} seconds.`}`
    : '';
  return new DomainError('rate_limited', `${message}${guidance}`, 429, {
    retryAfterSeconds: retry,
  });
}
