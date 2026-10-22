import { createServer } from 'node:http';

export type FakeRequest = {
  url?: string;
  authorization?: string;
  body: Record<string, unknown>;
};

export type FakeReply = {
  status: number;
  contentType: string;
  body: string;
};

/** Serialise Server-Sent Events frames the way OpenAI-compatible APIs do. */
export function sse(...frames: string[]) {
  return frames.map((frame) => `data: ${frame}\n\n`).join('');
}

/**
 * Minimal OpenAI-compatible streaming endpoint for provider tests. It records
 * every request so tests can assert the exact call the adapter made.
 */
export async function fakeOpenAi(reply: (request: FakeRequest) => FakeReply | undefined) {
  const requests: FakeRequest[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const recorded: FakeRequest = {
      url: request.url,
      authorization: request.headers.authorization,
      body,
    };
    requests.push(recorded);

    const result = reply(recorded);
    // No reply means hold the connection open; the client-side timeout test
    // uses this to prove it aborts a stalled provider.
    if (!result) return;
    response.writeHead(result.status, { 'content-type': result.contentType });
    response.end(result.body);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fake provider did not bind');

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
