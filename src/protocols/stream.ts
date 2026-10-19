// node's web ReadableStream type: the DOM global lacks [Symbol.asyncIterator], node has it
import type { ReadableStream } from "node:stream/web";
import { StringDecoder } from "node:string_decoder";

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

// split raw sse bytes into complete "\n\n"-terminated frames; multibyte chars and CRLF survive chunk boundaries
export function createSseFrameSplitter(): { push(chunk: Buffer | string): string[]; rest(): string } {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  return {
    push(chunk) {
      buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
      buffer = buffer.replace(/\r\n/g, "\n");
      const frames: string[] = [];
      let end = buffer.indexOf("\n\n");
      while (end !== -1) {
        frames.push(buffer.slice(0, end + 2));
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf("\n\n");
      }
      return frames;
    },
    rest() {
      const out = (buffer + decoder.end()).replace(/\r\n/g, "\n");
      buffer = "";
      return out;
    },
  };
}

export interface SseChunk {
  event?: string;
  data: string;
}

// parse an sse byte stream into chunks; "[DONE]" surfaces as { data: "[DONE]" }
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
