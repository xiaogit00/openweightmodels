import nodemailer from 'nodemailer';
import { MAGIC_LINK_TTL_MINUTES } from './auth-constants';

const appName = 'OpenWeightModels';

export type MagicLinkMessage = {
  email: string;
  url: string;
};

type DevOutbox = Map<string, { url: string; sentAt: Date }>;

const globalForOutbox = globalThis as unknown as {
  __owmDevMagicLinks?: DevOutbox;
};

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

  return { from: process.env.EMAIL_FROM ?? `${appName} <hello@openweightmodels.test>`, to: email, subject, text, html };
}

/**
 * Sends a magic link through the configured SMTP transport (Mailpit locally,
 * SES in production). Local development without Mailpit still logs the link so
 * the flow is usable; production never silently drops mail.
 */
export async function sendMagicLinkEmail(message: MagicLinkMessage) {
  const development = process.env.NODE_ENV !== 'production';
  if (development) {
    devOutbox().set(message.email.trim().toLowerCase(), {
      url: message.url,
      sentAt: new Date(),
    });
  }

  const smtpUrl = process.env.SMTP_URL;
  if (!smtpUrl) {
    if (development) {
      console.info(`[auth] magic link for ${message.email}: ${message.url}`);
      return;
    }
    throw new Error('SMTP_URL is not configured');
  }

  const transport = nodemailer.createTransport(smtpUrl);
  try {
    await transport.sendMail(buildMagicLinkEmail(message));
  } catch (error) {
    if (development) {
      console.warn(
        `[auth] SMTP unavailable (${String(error)}); use this link instead: ${message.url}`,
      );
      return;
    }
    throw error;
  } finally {
    transport.close();
  }
}
