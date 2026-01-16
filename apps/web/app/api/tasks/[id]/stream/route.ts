import { createClient } from "redis";

export async function GET(
  req: Request,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;
  const runId = params.id;

  const host = process.env.REDIS_HOST || "127.0.0.1";
  const port = parseInt(process.env.REDIS_PORT || "6379", 10);
  const password = process.env.REDIS_PASSWORD || undefined;

  const sub = createClient({
    socket: { host, port },
    password,
  });
  await sub.connect();

  let cleanUp: () => Promise<void> | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let streamOpen = true;
      const send = (event: unknown) => {
        if (!streamOpen) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          streamOpen = false;
        }
      };
      const heartbeat = setInterval(() => {
        send({ type: "heartbeat", t: Date.now() });
      }, 25000);

      await sub.subscribe(`task:${runId}`, (message) => {
        try {
          send(JSON.parse(message));
        } catch {
          // ignore
        }
      });

      // Close on client disconnect
      let closed = false;
      cleanUp = async () => {
        if (closed) return;
        closed = true;
        streamOpen = false;
        clearInterval(heartbeat);
        await sub.unsubscribe(`task:${runId}`).catch(() => {});
        await sub.quit().catch(() => {});
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      req.signal?.addEventListener?.("abort", cleanUp);
    },
    async cancel() {
      await cleanUp?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
