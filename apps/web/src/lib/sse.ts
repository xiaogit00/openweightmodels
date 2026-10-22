import { createSubscriber } from '@owm/core';

export type SseEvent = {
  id: number;
  type: string;
  data: unknown;
};

export function sseResponse({
  request,
  channel,
  replay,
}: {
  request: Request;
  channel: string;
  replay: (afterId: number) => Promise<SseEvent[]>;
}) {
  const encoder = new TextEncoder();
  const headerId = Number(request.headers.get('last-event-id') ?? '0');
  const queryId = Number(new URL(request.url).searchParams.get('after') ?? '0');
  let lastId = Number.isFinite(headerId) && headerId > 0 ? headerId : queryId;
  let closed = false;
  let subscriber: ReturnType<typeof createSubscriber> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let poller: ReturnType<typeof setInterval> | null = null;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  const write = (chunk: string) => {
    if (closed || !controllerRef) return;
    try {
      controllerRef.enqueue(encoder.encode(chunk));
    } catch {
      closed = true;
    }
  };

  const send = (event: SseEvent) => {
    if (closed) return;
    if (typeof event.id === 'number' && event.id <= lastId) return;
    if (typeof event.id === 'number') lastId = event.id;
    write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
  };

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    if (poller) clearInterval(poller);
    subscriber?.quit().catch(() => {});
    try {
      controllerRef?.close();
    } catch {
      // already closed
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controllerRef = controller;
      write(': connected\n\n');
      request.signal.addEventListener('abort', cleanup);

      try {
        for (const event of await replay(lastId)) send(event);
      } catch (error) {
        console.error('[sse] replay failed', error);
      }

      heartbeat = setInterval(() => write(': ping\n\n'), 20_000);
      poller = setInterval(async () => {
        try {
          for (const event of await replay(lastId)) send(event);
        } catch {
          // transient database error; the heartbeat keeps the connection open
        }
      }, 2_000);

      try {
        subscriber = createSubscriber();
        subscriber.on('error', (error) => console.error('[sse] redis error', error));
        await subscriber.subscribe(channel);
        subscriber.on('message', (_channel, message) => {
          try {
            const event = JSON.parse(message) as SseEvent;
            if (typeof event.id === 'number' && typeof event.type === 'string') send(event);
          } catch {
            // ignore malformed messages
          }
        });
      } catch (error) {
        console.error('[sse] subscribe failed; falling back to polling', error);
      }
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
