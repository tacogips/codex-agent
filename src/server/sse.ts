/**
 * SSE (Server-Sent Events) response utility.
 *
 * Bridges AsyncGenerator<T> to an SSE Response stream.
 */

export function sseResponse<T>(
  generator: AsyncGenerator<T, void, undefined>,
): Response {
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await generator.next();
        if (done) {
          controller.close();
          return;
        }
        const data = `data: ${JSON.stringify(value)}\n\n`;
        controller.enqueue(new TextEncoder().encode(data));
      } catch {
        controller.close();
      }
    },
    cancel() {
      void generator.return(undefined);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
