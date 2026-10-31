// fetch-compatible upstream client with real keep-alive under Node. undici (Node's global fetch) closes idle
// sockets after 4 s, so every request after a short pause pays a new TCP+TLS handshake (~500 ms). this goes
// through node:https with a 60 s keep-alive pool instead; no undici dependency (docs/architecture.md §7.3).
// Bun keeps its global fetch, which already reuses connections.
import http from "node:http";
import https from "node:https";
import net from "node:net";
import stream, { Readable } from "node:stream";
import zlib from "node:zlib";

const NATIVE_FETCH = globalThis.fetch;
export const UPSTREAM_KEEPALIVE_MS = 60_000;
let connectTimeoutMs = 10_000; // undici connect timeout
const IDLE_TIMEOUT_MS = 300_000; // undici headers/body timeout
const ALPN = ["http/1.1"]; // what undici offers when h2 is off; part of the TLS fingerprint

// free sockets are unref'd by the agent, so the pool never keeps the process alive
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  timeout: UPSTREAM_KEEPALIVE_MS,
  scheduling: "lifo",
  ALPNProtocols: ALPN,
});
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  timeout: UPSTREAM_KEEPALIVE_MS,
  scheduling: "lifo",
});

// undici's default request headers, added only when the caller did not set them, so upstreams see the same request
const DEFAULT_HEADERS: Record<string, string> = {
  accept: "*/*",
  "accept-language": "*",
  "sec-fetch-mode": "cors",
  "user-agent": "node",
  "accept-encoding": "gzip, deflate",
};

const NULL_BODY_STATUSES = new Set([204, 205, 304]);
const STALE_SOCKET_CODES = new Set(["ECONNRESET", "EPIPE", "ECONNABORTED"]);

type Body = string | ArrayBuffer | ArrayBufferView | null | undefined;

function isHandledBody(body: unknown): body is Body {
  return (
    body === undefined ||
    body === null ||
    typeof body === "string" ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  );
}

function toBuffer(body: Body): Buffer | null {
  if (body === undefined || body === null) return null;
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
}

class StaleSocketError extends Error {
  constructor(readonly original: unknown) {
    super("stale keep-alive socket");
  }
}

function isStaleSocketError(err: unknown): boolean {
  const e = err as NodeJS.ErrnoException | undefined;
  return Boolean(e && ((e.code && STALE_SOCKET_CODES.has(e.code)) || e.message === "socket hang up"));
}

function createDecoder(encoding: string | null): stream.Transform | null {
  const coding = encoding?.trim().toLowerCase();
  if (coding === "gzip" || coding === "x-gzip") {
    return zlib.createGunzip({ flush: zlib.constants.Z_SYNC_FLUSH, finishFlush: zlib.constants.Z_SYNC_FLUSH });
  }
  if (coding === "deflate") {
    return zlib.createInflate({ flush: zlib.constants.Z_SYNC_FLUSH, finishFlush: zlib.constants.Z_SYNC_FLUSH });
  }
  if (coding === "br") {
    return zlib.createBrotliDecompress({
      flush: zlib.constants.BROTLI_OPERATION_FLUSH,
      finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH,
    });
  }
  return null; // identity, multiple codings or unknown: passed through untouched
}

function shouldDelegate(input: unknown, init: RequestInit): boolean {
  if ("Bun" in globalThis) return true;
  // a patched fetch (tests, instrumentation) keeps seeing every upstream call
  if (globalThis.fetch !== NATIVE_FETCH) return true;
  if (typeof input !== "string" && !(input instanceof URL)) return true;
  return !isHandledBody(init.body);
}

// tests only: shorten the connect timeout; returns the previous value
export function setConnectTimeoutForTesting(ms: number): number {
  const previous = connectTimeoutMs;
  connectTimeoutMs = ms;
  return previous;
}

export async function upstreamFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  if (shouldDelegate(input, init)) return globalThis.fetch(input, init);
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") return globalThis.fetch(input, init);

  const signal = init.signal ?? undefined;
  if (signal?.aborted) throw signal.reason;

  const method = (init.method ?? "GET").toUpperCase();
  const body = toBuffer(init.body as Body);
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, name) => {
    headers[name] = value;
  });
  for (const [name, value] of Object.entries(DEFAULT_HEADERS)) headers[name] ??= value;
  if (body) {
    headers["content-length"] = String(body.byteLength);
    if (typeof init.body === "string") headers["content-type"] ??= "text/plain;charset=UTF-8";
  } else if (method === "POST" || method === "PUT" || method === "PATCH") {
    headers["content-length"] = "0";
  }

  try {
    return await attempt(url, method, headers, body, signal, false);
  } catch (err) {
    if (!(err instanceof StaleSocketError)) throw err;
    if (signal?.aborted) throw signal.reason;
    // the pooled socket was closed by the server between requests: once more on a fresh connection.
    // accepted trade-off: if the upstream had already read the request and then dropped the socket before
    // sending headers, this resends it, so a POST can run twice (duplicate generation, quota spent twice).
    // the usual cause is an idle-close race where the server never saw the request, which is what this covers.
    try {
      return await attempt(url, method, headers, body, signal, true);
    } catch (retryErr) {
      if (retryErr instanceof StaleSocketError) throw new TypeError("fetch failed", { cause: retryErr.original });
      throw retryErr;
    }
  }
}

function attempt(
  url: URL,
  method: string,
  headers: Record<string, string>,
  body: Buffer | null,
  signal: AbortSignal | undefined,
  fresh: boolean,
): Promise<Response> {
  const secure = url.protocol === "https:";
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const options: https.RequestOptions & { ALPNProtocols?: string[] } = {
    protocol: url.protocol,
    hostname,
    port: url.port || undefined,
    path: `${url.pathname}${url.search}`,
    method,
    headers,
    // fresh: a one-off socket that cannot be a stale pooled one
    agent: fresh ? false : secure ? httpsAgent : httpAgent,
  };
  if (secure) {
    if (!net.isIP(hostname)) options.servername = hostname;
    if (fresh) options.ALPNProtocols = ALPN;
  }

  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    let gotResponse = false;
    let res: http.IncomingMessage | null = null;
    let decoder: stream.Transform | null = null;

    const req = (secure ? https : http).request(options);

    const cleanup = () => {
      clearTimeout(connectTimer);
      signal?.removeEventListener("abort", onAbort);
    };
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    const onAbort = () => {
      const reason = signal!.reason;
      req.destroy(reason);
      res?.destroy(reason);
      decoder?.destroy(reason);
      fail(reason);
      cleanup();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const connectTimer = setTimeout(() => req.destroy(new Error("connect timeout")), connectTimeoutMs);
    req.setTimeout(IDLE_TIMEOUT_MS, () => req.destroy(new Error("upstream timeout")));
    req.on("socket", (socket) => {
      if (req.reusedSocket) {
        clearTimeout(connectTimer);
        return;
      }
      socket.once(secure ? "secureConnect" : "connect", () => clearTimeout(connectTimer));
    });

    req.on("error", (err) => {
      if (settled) return;
      if (signal?.aborted) return fail(signal.reason);
      if (!fresh && !gotResponse && req.reusedSocket && isStaleSocketError(err)) {
        return fail(new StaleSocketError(err));
      }
      fail(new TypeError("fetch failed", { cause: err }));
    });

    req.on("response", (incoming) => {
      gotResponse = true;
      res = incoming;
      clearTimeout(connectTimer);
      incoming.once("close", cleanup);
      if (settled) {
        incoming.destroy();
        return;
      }
      try {
        const status = incoming.statusCode ?? 0;
        const responseHeaders = new Headers();
        const raw = incoming.rawHeaders;
        for (let i = 0; i + 1 < raw.length; i += 2) responseHeaders.append(raw[i]!, raw[i + 1]!);
        const init: ResponseInit = { status, statusText: incoming.statusMessage ?? "", headers: responseHeaders };

        if (NULL_BODY_STATUSES.has(status) || method === "HEAD") {
          incoming.resume();
          settled = true;
          resolve(new Response(null, init));
          return;
        }

        decoder = createDecoder(responseHeaders.get("content-encoding"));
        if (decoder) {
          responseHeaders.delete("content-encoding");
          responseHeaders.delete("content-length");
          stream.pipeline(incoming, decoder, () => {});
        }
        const webBody = Readable.toWeb(decoder ?? incoming) as unknown as ReadableStream<Uint8Array>;
        settled = true;
        resolve(new Response(webBody, init));
      } catch (err) {
        incoming.destroy();
        decoder?.destroy();
        fail(new TypeError("fetch failed", { cause: err }));
      }
    });

    req.end(body ?? undefined);
  });
}
