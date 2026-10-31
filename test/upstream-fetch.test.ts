import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import zlib from "node:zlib";
import { setConnectTimeoutForTesting, upstreamFetch } from "../src/relay/upstream-fetch";
import { relayFetch } from "../src/relay/egress";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withServer(
  handler: http.RequestListener,
  fn: (base: string, server: http.Server) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  server.keepAliveTimeout = 15_000;
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  try {
    await fn(`http://127.0.0.1:${port}`, server);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

test("POST body, caller and default headers, status and response headers round-trip", async () => {
  let seen: { body: string; headers: http.IncomingHttpHeaders } | null = null;
  await withServer(async (req, res) => {
    seen = { body: await readBody(req), headers: req.headers };
    res.writeHead(201, "Made It", { "content-type": "application/json", "x-up": "1" });
    res.end(JSON.stringify({ ok: true }));
  }, async (base) => {
    const body = JSON.stringify({ hello: "wörld" });
    const res = await upstreamFetch(`${base}/v1/chat?x=1`, {
      method: "POST",
      headers: new Headers({ "content-type": "application/json", "x-caller": "yes" }),
      body,
    });
    assert.equal(res.status, 201);
    assert.equal(res.statusText, "Made It");
    assert.equal(res.headers.get("x-up"), "1");
    assert.deepEqual(await res.clone().json(), { ok: true });
    assert.equal(await res.text(), '{"ok":true}');
    assert.ok(seen);
    const s = seen as { body: string; headers: http.IncomingHttpHeaders };
    assert.equal(s.body, body);
    assert.equal(s.headers["x-caller"], "yes");
    assert.equal(s.headers["content-type"], "application/json");
    assert.equal(s.headers["accept"], "*/*");
    assert.equal(s.headers["user-agent"], "node");
    assert.equal(s.headers["accept-encoding"], "gzip, deflate");
    assert.equal(s.headers["content-length"], String(Buffer.byteLength(body)));
  });
});

test("an idle pooled socket is reused after undici's 4 s keep-alive would have closed it", async () => {
  const ports: number[] = [];
  await withServer((req, res) => {
    ports.push(req.socket.remotePort!);
    res.end("ok");
  }, async (base) => {
    await (await upstreamFetch(`${base}/a`)).text();
    await sleep(4500);
    await (await upstreamFetch(`${base}/b`)).text();
    assert.equal(ports.length, 2);
    assert.equal(ports[0], ports[1]);
  });
});

test("gzip responses are decoded and lose content-encoding/content-length", async () => {
  await withServer((_req, res) => {
    const gz = zlib.gzipSync(JSON.stringify({ zipped: true }));
    res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip", "content-length": gz.length });
    res.end(gz);
  }, async (base) => {
    const res = await upstreamFetch(`${base}/`);
    assert.equal(res.headers.get("content-encoding"), null);
    assert.equal(res.headers.get("content-length"), null);
    assert.deepEqual(await res.json(), { zipped: true });
  });
});

test("br and deflate responses are decoded", async () => {
  const payload = JSON.stringify({ packed: true });
  await withServer((req, res) => {
    const br = req.url === "/br";
    const data = br ? zlib.brotliCompressSync(payload) : zlib.deflateSync(payload);
    res.writeHead(200, { "content-type": "application/json", "content-encoding": br ? "br" : "deflate", "content-length": data.length });
    res.end(data);
  }, async (base) => {
    for (const path of ["/br", "/deflate"]) {
      const res = await upstreamFetch(`${base}${path}`);
      assert.equal(res.headers.get("content-encoding"), null, path);
      assert.equal(res.headers.get("content-length"), null, path);
      assert.deepEqual(await res.json(), { packed: true }, path);
    }
  });
});

test("204 has no body and 304 does not throw", async () => {
  await withServer((req, res) => {
    res.writeHead(req.url === "/204" ? 204 : 304);
    res.end();
  }, async (base) => {
    const r204 = await upstreamFetch(`${base}/204`);
    assert.equal(r204.status, 204);
    assert.equal(r204.body, null);
    const r304 = await upstreamFetch(`${base}/304`);
    assert.equal(r304.status, 304);
  });
});

test("a 302 is returned as-is, not followed", async () => {
  await withServer((_req, res) => {
    res.writeHead(302, { location: "/elsewhere" });
    res.end();
  }, async (base) => {
    const res = await upstreamFetch(`${base}/`, { method: "POST", body: "x" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/elsewhere");
    await res.arrayBuffer();
  });
});

test("SSE frames reach the caller before the upstream finishes", async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("data: one\n\n");
    setTimeout(() => res.end("data: two\n\n"), 300);
  }, async (base) => {
    const t0 = Date.now();
    const res = await upstreamFetch(`${base}/`);
    const reader = res.body!.getReader();
    const first = await reader.read();
    assert.ok(Date.now() - t0 < 250, "first chunk arrived before the server ended");
    assert.equal(Buffer.from(first.value!).toString(), "data: one\n\n");
    let rest = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest += Buffer.from(value).toString();
    }
    assert.equal(rest, "data: two\n\n");
  });
});

test("abort before the response rejects with AbortError and closes the upstream request", async () => {
  let closed = false;
  await withServer((req) => {
    req.on("close", () => {
      closed = true;
    });
  }, async (base) => {
    const ac = new AbortController();
    const p = upstreamFetch(`${base}/`, { signal: ac.signal });
    setTimeout(() => ac.abort(), 100);
    await assert.rejects(p, (err: Error) => err.name === "AbortError");
    await sleep(100);
    assert.equal(closed, true);
  });
});

test("abort mid-body errors the reader with AbortError", async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("data: one\n\n");
  }, async (base) => {
    const ac = new AbortController();
    const res = await upstreamFetch(`${base}/`, { signal: ac.signal });
    const reader = res.body!.getReader();
    await reader.read();
    ac.abort();
    await assert.rejects(reader.read(), (err: Error) => err.name === "AbortError");
  });
});

test("an already-aborted signal rejects without sending", async () => {
  let hits = 0;
  await withServer((_req, res) => {
    hits++;
    res.end();
  }, async (base) => {
    await assert.rejects(upstreamFetch(`${base}/`, { signal: AbortSignal.abort() }), (err: Error) => err.name === "AbortError");
    await sleep(50);
    assert.equal(hits, 0);
  });
});

test("a stale pooled socket is retried once on a fresh connection", async () => {
  let count = 0;
  await withServer(async (req, res) => {
    count++;
    await readBody(req);
    if (count === 2) {
      req.socket.destroy(); // the server dropped the idle connection under us
      return;
    }
    res.end(`ok${count}`);
  }, async (base) => {
    assert.equal(await (await upstreamFetch(`${base}/`, { method: "POST", body: "a" })).text(), "ok1");
    const res = await upstreamFetch(`${base}/`, { method: "POST", body: "b" });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "ok3");
  });
});

test("no retry once response bytes have arrived on a reused socket", async () => {
  let count = 0;
  await withServer(async (req, res) => {
    count++;
    await readBody(req);
    if (count === 2) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: partial\n\n", () => setTimeout(() => req.socket.destroy(), 50));
      return;
    }
    res.end(`ok${count}`);
  }, async (base) => {
    await (await upstreamFetch(`${base}/`, { method: "POST", body: "a" })).text();
    const res = await upstreamFetch(`${base}/`, { method: "POST", body: "b" });
    assert.equal(res.status, 200);
    await assert.rejects(res.text());
    await sleep(100);
    assert.equal(count, 2);
  });
});

test("no retry when a fresh socket is dropped", async () => {
  let count = 0;
  await withServer(async (req) => {
    count++;
    await readBody(req);
    req.socket.destroy();
  }, async (base) => {
    await assert.rejects(
      upstreamFetch(`${base}/fresh`, { method: "POST", body: "a" }),
      (err: Error) => err instanceof TypeError && err.message === "fetch failed",
    );
    await sleep(100);
    assert.equal(count, 1);
  });
});

test("a TLS handshake that never completes hits the connect timeout", async () => {
  const sockets: net.Socket[] = [];
  const server = net.createServer((socket) => {
    sockets.push(socket); // accept TCP, never answer the TLS ClientHello
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  const previous = setConnectTimeoutForTesting(200);
  try {
    const t0 = Date.now();
    await assert.rejects(
      upstreamFetch(`https://127.0.0.1:${port}/`),
      (err: Error) => err instanceof TypeError && (err.cause as Error)?.message === "connect timeout",
    );
    assert.ok(Date.now() - t0 < 2000, "rejected near the connect timeout");
  } finally {
    setConnectTimeoutForTesting(previous);
    for (const s of sockets) s.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("network failures reject with TypeError('fetch failed') like undici", async () => {
  const server = http.createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  await new Promise<void>((r) => server.close(() => r()));
  await assert.rejects(upstreamFetch(`http://127.0.0.1:${port}/`), (err: Error) => err instanceof TypeError && err.message === "fetch failed");
});

test("a patched global fetch still sees upstream calls", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response("stubbed", { status: 200 });
  }) as typeof fetch;
  try {
    const res = await upstreamFetch("https://provider.invalid/v1/chat/completions", { method: "POST", body: "{}" });
    assert.equal(await res.text(), "stubbed");
    assert.deepEqual(calls, ["https://provider.invalid/v1/chat/completions"]);
  } finally {
    globalThis.fetch = original;
  }
});

test("relayFetch tries the relay, then falls back to the direct target", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("http://127.0.0.1:1")) throw new TypeError("fetch failed");
    return new Response("direct", { status: 200 });
  }) as typeof fetch;
  try {
    const res = await relayFetch(
      { enabled: true, url: "http://127.0.0.1:1/relay", relays: [] },
      "https://api.llm7.io/v1/chat/completions",
      { method: "POST", body: "{}" },
    );
    assert.equal(await res.text(), "direct");
    assert.deepEqual(calls, ["http://127.0.0.1:1/relay", "https://api.llm7.io/v1/chat/completions"]);
  } finally {
    globalThis.fetch = original;
  }
});
