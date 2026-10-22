import { NextResponse } from 'next/server';
import { DomainError } from '@owm/core';
import { ZodError } from 'zod';

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function apiError(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_input',
          message: error.issues[0]?.message ?? 'That input is not valid.',
          issues: error.issues,
        },
      },
      { status: 400 },
    );
  }

  if (error instanceof DomainError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }

  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status: unknown }).status)
      : 500;
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : 'internal_error';
  const message = error instanceof Error ? error.message : 'Something went wrong.';

  if (status >= 500) console.error(error);

  return NextResponse.json(
    { error: { code, message: status >= 500 ? 'Something went wrong.' : message } },
    { status: Number.isFinite(status) && status >= 400 ? status : 500 },
  );
}

export async function readJson(request: Request) {
  try {
    return (await request.json()) as unknown;
  } catch {
    throw new DomainError('invalid_json', 'Expected a JSON body.', 400);
  }
}
