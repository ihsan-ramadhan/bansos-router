// use node's web stream type: the DOM global ReadableStream type does not
// declare [Symbol.asyncIterator], but the node runtime (fetch response body) does.
import type { ReadableStream } from "node:stream/web";
import type http from "node:http";

// openai-style data:{json} frame
export function sseData(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// anthropic/responses-style event:<type> + data:{json} frame
export function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// openai terminal marker
export function sseDone(): string {
  return "data: [DONE]\n\n";
}

export function writeSse(res: http.ServerResponse, frame: string): void {
  res.write(frame);
}

export interface SseChunk {
  event?: string;
  data: string;
}

// parse an sse byte stream into chunks. accumulate multi-line data,
// pair with the last event line. "[DONE]" surfaces as { data: "[DONE]" };
// event is undefined for event-less frames.
export async function* readSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SseChunk> {
  const decoder = new TextDecoder();
  let buffer = "";
  let event: string | undefined;
  let dataLines: string[] = [];

  for await (const bytes of stream) {
    buffer += decoder.decode(bytes, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);

      if (line === "") {
        // blank line ends the event frame
        if (event !== undefined || dataLines.length > 0) {
          yield { event, data: dataLines.join("\n") };
          event = undefined;
          dataLines = [];
        }
        continue;
      }
      if (line.startsWith(":")) continue; // comment line

      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") dataLines.push(value);
      // id/retry fields ignored (not needed for proxy translation)
    }
  }

  // flush a trailing frame without its terminating blank line
  if (event !== undefined || dataLines.length > 0) {
    yield { event, data: dataLines.join("\n") };
  }
}
