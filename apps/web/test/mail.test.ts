import { createServer, type Server } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sendMagicLinkEmail } from '../src/lib/mail';

/**
 * A tiny SMTP sink: enough of the protocol for Nodemailer to hand over a
 * message, so the Mailpit/SES code path is exercised without a real server.
 */
function startSmtpSink() {
  const state = { message: '' };
  const server: Server = createServer((socket) => {
    let buffer = '';
    let dataMode = false;
    let data = '';
    socket.write('220 test-smtp\r\n');

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');

      for (;;) {
        if (dataMode) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end === -1) {
            data += buffer;
            buffer = '';
            return;
          }
          data += buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          dataMode = false;
          state.message = data;
          socket.write('250 OK\r\n');
          continue;
        }

        const newline = buffer.indexOf('\r\n');
        if (newline === -1) return;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        const command = line.split(' ')[0]?.toUpperCase();

        if (command === 'EHLO' || command === 'HELO') {
          socket.write('250 test-smtp\r\n');
        } else if (command === 'DATA') {
          dataMode = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (command === 'QUIT') {
          socket.write('221 Bye\r\n');
          socket.end();
          return;
        } else {
          socket.write('250 OK\r\n');
        }
      }
    });
  });

  return {
    server,
    state,
    listen: () =>
      new Promise<number>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          resolve((server.address() as AddressInfo).port);
        });
      }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('magic-link mail', () => {
  const sink = startSmtpSink();
  const previousSmtp = process.env.SMTP_URL;
  const previousFrom = process.env.EMAIL_FROM;

  beforeAll(async () => {
    const port = await sink.listen();
    process.env.SMTP_URL = `smtp://127.0.0.1:${port}`;
    process.env.EMAIL_FROM = 'OpenWeightModels <hello@openweightmodels.test>';
  });

  afterAll(async () => {
    process.env.SMTP_URL = previousSmtp;
    process.env.EMAIL_FROM = previousFrom;
    await sink.close();
  });

  it('delivers the sign-in URL through the configured SMTP transport', async () => {
    const url = 'http://localhost:3000/api/auth/magic-link/verify?token=test-token';
    await sendMagicLinkEmail({ email: 'reader@example.test', url });

    expect(sink.state.message).toContain('To: reader@example.test');
    expect(sink.state.message).toContain('Subject: Sign in to OpenWeightModels');
    expect(sink.state.message).toContain(url);
    expect(sink.state.message).toContain('expires in 15 minutes');
  });
});
