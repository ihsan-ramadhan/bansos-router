import { effectiveBind, effectivePort } from "../daemon/state";

interface PingResult {
  id: string;
  ok: boolean;
  status: number | string;
  latencyMs: number;
  message?: string;
}

async function pingModel(base: string, modelId: string): Promise<PingResult> {
  const start = Date.now();
  try {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer bansos",
        // probe the model itself: daemon skips failover for this request
        "x-bansos-no-failover": "1",
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 16,
        messages: [{ role: "user", content: "ping" }],
      }),
      signal: AbortSignal.timeout(12000),
    });

    const latencyMs = Date.now() - start;

    if (res.ok) {
      return { id: modelId, ok: true, status: 200, latencyMs, message: "ok" };
    }

    if (res.status === 429) {
      return { id: modelId, ok: false, status: 429, latencyMs, message: "rate limited" };
    }

    let detail = `HTTP ${res.status}`;
    try {
      const err = (await res.json()) as { error?: { message?: string } };
      if (err.error?.message) {
        detail = err.error.message.slice(0, 40);
      }
    } catch {
      // ignore
    }

    return { id: modelId, ok: false, status: res.status, latencyMs, message: detail };
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    const msg = err instanceof Error && err.name === "TimeoutError" ? "timeout (12s)" : "unreachable";
    return { id: modelId, ok: false, status: "ERR", latencyMs, message: msg };
  }
}

export async function runPing(argv: string[]): Promise<number> {
  const json = argv.includes("--json");
  const targetModel = argv.filter((a) => a !== "--json")[0];
  const base = `http://${effectiveBind()}:${effectivePort()}`;

  // fetch available models from daemon
  let models: Array<{ id: string }> = [];
  try {
    const res = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      models = data.data ?? [];
    }
  } catch {
    console.error(`bansos: daemon not reachable at ${base} (run "bansos start" first)`);
    return 1;
  }

  if (models.length === 0) {
    console.error(`bansos: no models found on daemon at ${base}`);
    return 1;
  }

  let targets: string[] = [];
  if (targetModel) {
    // exact match, suffix match, or known alias match
    const matched = models.find(
      (m) =>
        m.id === targetModel ||
        m.id.endsWith(`/${targetModel}`),
    );
    if (!matched) {
      console.error(`bansos ping: unknown model "${targetModel}"`);
      console.error(`available models: ${models.map((m) => m.id).join(", ")}`);
      return 1;
    }
    targets = [matched.id];
  } else {
    targets = models.map((m) => m.id);
  }

  // ping all in parallel
  const results = await Promise.all(targets.map((id) => pingModel(base, id)));

  const okCount = results.filter((r) => r.ok).length;
  if (json) {
    const rateLimited = results.filter((r) => !r.ok && r.status === 429).length;
    console.log(JSON.stringify({
      base,
      results,
      summary: { ok: okCount, rateLimited, failed: results.length - okCount - rateLimited, total: results.length },
    }));
    return okCount === 0 ? 1 : 0;
  }

  console.log(`PING ${base} (${targets.length} model${targets.length > 1 ? "s" : ""}):\n`);

  const maxLen = Math.max(...results.map((r) => r.id.length), 10);

  let okTotal = 0;
  let rateLimitCount = 0;
  let errCount = 0;

  for (const r of results) {
    const padded = r.id.padEnd(maxLen + 2);
    if (r.ok) {
      okTotal++;
      const ms = `${r.latencyMs}ms`.padStart(7);
      console.log(`  ✓ ${padded} ${ms}  ${r.message}`);
    } else if (r.status === 429) {
      rateLimitCount++;
      const ms = `${r.latencyMs}ms`.padStart(7);
      console.log(`  ✗ ${padded} ${ms}  429 (${r.message})`);
    } else {
      errCount++;
      const ms = `${r.latencyMs}ms`.padStart(7);
      console.log(`  ✗ ${padded} ${ms}  ${r.message}`);
    }
  }

  if (targets.length > 1) {
    console.log(`\nSummary: ${okTotal} ok, ${rateLimitCount} rate limited, ${errCount} failed (${targets.length} total)`);
  }

  return (rateLimitCount + errCount) === targets.length ? 1 : 0;
}
