export class DomainError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
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

export function tooMany(message: string) {
  return new DomainError('rate_limited', message, 429);
}
