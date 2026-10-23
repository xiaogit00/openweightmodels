import { afterEach, describe, expect, it } from 'vitest';
import type { SendEmailCommandInput } from '@aws-sdk/client-sesv2';
import { sendMagicLinkEmail } from '../src/lib/mail';

const originalTransport = process.env.EMAIL_TRANSPORT;
const originalFrom = process.env.EMAIL_FROM;
const originalSmtp = process.env.SMTP_URL;

afterEach(() => {
  process.env.EMAIL_TRANSPORT = originalTransport;
  process.env.EMAIL_FROM = originalFrom;
  process.env.SMTP_URL = originalSmtp;
});

describe('SES magic-link delivery', () => {
  it('sends HTML and text through the SES v2 payload without SMTP settings', async () => {
    process.env.EMAIL_TRANSPORT = 'ses';
    process.env.EMAIL_FROM = 'OpenWeightModels <no-reply@staging.example.com>';
    delete process.env.SMTP_URL;

    let sent: SendEmailCommandInput | undefined;
    await sendMagicLinkEmail(
      {
        email: 'reader@example.test',
        url: 'https://staging.example.com/api/auth/magic-link/verify?token=test-token',
      },
      {
        sesSender: async (input) => {
          sent = input;
        },
      },
    );

    expect(sent).toBeDefined();
    expect(sent?.FromEmailAddress).toBe('OpenWeightModels <no-reply@staging.example.com>');
    expect(sent?.Destination?.ToAddresses).toEqual(['reader@example.test']);
    expect(sent?.Content?.Simple?.Subject?.Data).toBe('Sign in to OpenWeightModels');
    expect(sent?.Content?.Simple?.Body?.Text?.Data).toContain(
      'https://staging.example.com/api/auth/magic-link/verify?token=test-token',
    );
    expect(sent?.Content?.Simple?.Body?.Html?.Data).toContain('Sign in to OpenWeightModels');
  });

  it('rejects an unknown transport instead of silently dropping mail', async () => {
    process.env.EMAIL_TRANSPORT = 'carrier-pigeon';

    await expect(
      sendMagicLinkEmail({ email: 'reader@example.test', url: 'https://example.test' }),
    ).rejects.toThrow(/EMAIL_TRANSPORT/);
  });
});
