import nodemailer from 'nodemailer';
import type { SendEmailCommandInput } from '@aws-sdk/client-sesv2';
import { MAGIC_LINK_TTL_MINUTES } from './auth-constants';

const appName = 'OpenWeightModels';

export type MagicLinkMessage = {
  email: string;
  url: string;
};

export type SesSender = (input: SendEmailCommandInput) => Promise<void>;

export type MailDependencies = {
  /** Test seam; production uses the SES v2 client with the ECS task role. */
  sesSender?: SesSender;
};

type DevOutbox = Map<string, { url: string; sentAt: Date }>;

const globalForOutbox = globalThis as unknown as {
  __owmDevMagicLinks?: DevOutbox;
};

let sesClient: import('@aws-sdk/client-sesv2').SESv2Client | undefined;

/**
 * The development-only outbox lets the browser suite and a developer without
 * Mailpit redeem a real, single-use link. It is never populated in production.
 */
function devOutbox(): DevOutbox {
  globalForOutbox.__owmDevMagicLinks ??= new Map();
  return globalForOutbox.__owmDevMagicLinks;
}

export function latestDevMagicLink(email: string) {
  return devOutbox().get(email.trim().toLowerCase())?.url ?? null;
}

function buildMagicLinkEmail({ email, url }: MagicLinkMessage) {
  const subject = `Sign in to ${appName}`;
  const text = [
    `Use this link to sign in to ${appName}:`,
    '',
    url,
    '',
    `The link can be used once and expires in ${MAGIC_LINK_TTL_MINUTES} minutes.`,
    'If you did not request it, you can ignore this email.',
  ].join('\n');
  const html = `
    <p>Use this link to sign in to ${appName}:</p>
    <p><a href="${url}">Sign in to ${appName}</a></p>
    <p>The link can be used once and expires in ${MAGIC_LINK_TTL_MINUTES} minutes.</p>
    <p>If you did not request it, you can ignore this email.</p>
  `.trim();

  return {
    from: process.env.EMAIL_FROM ?? `${appName} <hello@openweightmodels.test>`,
    to: email,
    subject,
    text,
    html,
  };
}

/**
 * `smtp` is the local Mailpit default. `ses` sends through the SES v2 API with
 * the ECS task role, so no SMTP credentials are stored anywhere.
 */
export function mailTransport(): 'smtp' | 'ses' {
  const configured = process.env.EMAIL_TRANSPORT?.trim().toLowerCase();
  if (!configured) return 'smtp';
  if (configured === 'smtp' || configured === 'ses') return configured;
  throw new Error(`EMAIL_TRANSPORT must be "smtp" or "ses" (got "${configured}")`);
}

async function sendWithSes(message: MagicLinkMessage, sender?: SesSender) {
  const email = buildMagicLinkEmail(message);
  const input: SendEmailCommandInput = {
    FromEmailAddress: email.from,
    Destination: { ToAddresses: [email.to] },
    Content: {
      Simple: {
        Subject: { Data: email.subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: email.html, Charset: 'UTF-8' },
          Text: { Data: email.text, Charset: 'UTF-8' },
        },
      },
    },
  };

  if (sender) {
    await sender(input);
    return;
  }

  const { SESv2Client, SendEmailCommand } = await import('@aws-sdk/client-sesv2');
  sesClient ??= new SESv2Client({ region: process.env.AWS_REGION });
  await sesClient.send(new SendEmailCommand(input));
}

/**
 * Sends a magic link through the configured transport: Mailpit locally over
 * SMTP, SES in production. Local development without a mail server still logs
 * the link so the flow is usable; production never silently drops mail.
 */
export async function sendMagicLinkEmail(
  message: MagicLinkMessage,
  dependencies: MailDependencies = {},
) {
  const development = process.env.NODE_ENV !== 'production';
  if (development) {
    devOutbox().set(message.email.trim().toLowerCase(), {
      url: message.url,
      sentAt: new Date(),
    });
  }

  const transport = mailTransport();
  if (transport === 'ses') {
    await sendWithSes(message, dependencies.sesSender);
    return;
  }

  const smtpUrl = process.env.SMTP_URL;
  if (!smtpUrl) {
    if (development) {
      console.info(`[auth] magic link for ${message.email}: ${message.url}`);
      return;
    }
    throw new Error('SMTP_URL is not configured');
  }

  const smtp = nodemailer.createTransport(smtpUrl);
  try {
    await smtp.sendMail(buildMagicLinkEmail(message));
  } catch (error) {
    if (development) {
      console.warn(
        `[auth] SMTP unavailable (${String(error)}); use this link instead: ${message.url}`,
      );
      return;
    }
    throw error;
  } finally {
    smtp.close();
  }
}
