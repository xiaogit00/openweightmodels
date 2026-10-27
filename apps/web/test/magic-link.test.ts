import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverMagicLink } from '../src/lib/magic-link';

const original = process.env.SIGNIN_ALLOWED_EMAILS;

afterEach(() => {
  if (original === undefined) delete process.env.SIGNIN_ALLOWED_EMAILS;
  else process.env.SIGNIN_ALLOWED_EMAILS = original;
  vi.restoreAllMocks();
});

const message = {
  email: 'owner@example.com',
  url: 'https://staging.example.com/api/auth/magic-link/verify?token=test-token',
};

describe('magic-link delivery', () => {
  it('sends when no allowlist is configured', async () => {
    delete process.env.SIGNIN_ALLOWED_EMAILS;
    const send = vi.fn().mockResolvedValue(undefined);

    await expect(deliverMagicLink(message, send)).resolves.toBe(true);
    expect(send).toHaveBeenCalledWith(message);
  });

  it('sends to an allowlisted address', async () => {
    process.env.SIGNIN_ALLOWED_EMAILS = 'owner@example.com';
    const send = vi.fn().mockResolvedValue(undefined);

    await expect(deliverMagicLink(message, send)).resolves.toBe(true);
    expect(send).toHaveBeenCalledWith(message);
  });

  it('silently drops a non-allowlisted address without throwing', async () => {
    process.env.SIGNIN_ALLOWED_EMAILS = 'someone-else@example.com';
    const send = vi.fn().mockResolvedValue(undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    // Resolving (not rejecting) is the point: the endpoint must answer exactly
    // as it does for a delivered link.
    await expect(deliverMagicLink(message, send)).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalled();
    // The log line must not leak the address it rejected.
    expect(JSON.stringify(info.mock.calls)).not.toContain('owner@example.com');
  });

  it('propagates a transport failure for an allowed address', async () => {
    process.env.SIGNIN_ALLOWED_EMAILS = 'owner@example.com';
    const send = vi.fn().mockRejectedValue(new Error('SES unavailable'));

    await expect(deliverMagicLink(message, send)).rejects.toThrow('SES unavailable');
  });
});
