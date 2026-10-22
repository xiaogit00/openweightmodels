import { RESPONSE_STATUSES, type ResponseStatus } from '@owm/core/client';

/** A payload from the author-only Job event stream. */
export type JobStreamEvent = {
  type: string;
  data?: { payload?: Record<string, unknown> };
};

export function isResponseStatus(value: unknown): value is ResponseStatus {
  return (
    typeof value === 'string' &&
    (RESPONSE_STATUSES as readonly string[]).includes(value)
  );
}

/** Reads the domain error message from a failed API response. */
export async function responseErrorMessage(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return body?.error?.message ?? fallback;
}
