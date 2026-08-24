import { useState, useCallback, useRef } from "preact/hooks";
import type { ModelItem, PingResult } from "../types/ui";
import { pingModel } from "../services/api";

export interface PingSummary {
  total: number;
  ok: number;
  rateLimited: number;
  error: number;
}

export interface PingProgress {
  current: number;
  total: number;
}

export function usePing() {
  const [pingResults, setPingResults] = useState<Record<string, PingResult>>({});
  const [isPingingAll, setIsPingingAll] = useState(false);
  const [pingProgress, setPingProgress] = useState<PingProgress>({ current: 0, total: 0 });
  const cancelPingRef = useRef(false);

  const pingSingle = useCallback(async (model: ModelItem) => {
    const modelId = model.id;
    setPingResults((prev) => ({
      ...prev,
      [modelId]: { modelId, status: "pinging" },
    }));

    try {
      const res = await pingModel(modelId, model.maxTokens ?? model.max_tokens);
      if (res.status === 200) {
        setPingResults((prev) => ({
          ...prev,
          [modelId]: {
            modelId,
            status: "ok",
            statusCode: res.status,
            latencyMs: res.latencyMs,
          },
        }));
      } else if (res.status === 429) {
        setPingResults((prev) => ({
          ...prev,
          [modelId]: {
            modelId,
            status: "rate_limited",
            statusCode: res.status,
            latencyMs: res.latencyMs,
          },
        }));
      } else {
        setPingResults((prev) => ({
          ...prev,
          [modelId]: {
            modelId,
            status: "error",
            statusCode: res.status,
            latencyMs: res.latencyMs,
            error: `HTTP ${res.status || "Connection Error"}`,
          },
        }));
      }
    } catch (err) {
      setPingResults((prev) => ({
        ...prev,
        [modelId]: {
          modelId,
          status: "error",
          error: err instanceof Error ? err.message : "Ping failed",
        },
      }));
    }
  }, []);

  const cancelPing = useCallback(() => {
    cancelPingRef.current = true;
    setIsPingingAll(false);
    // Clear any pending/pinging state from models that were in flight
    setPingResults((prev) => {
      const updated = { ...prev };
      for (const [id, r] of Object.entries(updated)) {
        if (r.status === "pinging") {
          delete updated[id];
        }
      }
      return updated;
    });
  }, []);

  const pingAll = useCallback(async (models: ModelItem[]) => {
    if (isPingingAll || models.length === 0) return;
    cancelPingRef.current = false;
    setIsPingingAll(true);
    setPingProgress({ current: 0, total: models.length });

    let completed = 0;
    // Chunk in batches of 4 to prevent socket exhaustion
    const chunkSize = 4;
    for (let i = 0; i < models.length; i += chunkSize) {
      if (cancelPingRef.current) break;
      const chunk = models.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async (m) => {
          if (cancelPingRef.current) return;
          await pingSingle(m);
          completed += 1;
          setPingProgress({ current: completed, total: models.length });
        })
      );
    }

    setIsPingingAll(false);
  }, [isPingingAll, pingSingle]);

  const summary: PingSummary = {
    total: Object.keys(pingResults).length,
    ok: Object.values(pingResults).filter((r) => r.status === "ok").length,
    rateLimited: Object.values(pingResults).filter((r) => r.status === "rate_limited").length,
    error: Object.values(pingResults).filter((r) => r.status === "error").length,
  };

  const clearPingResults = useCallback(() => {
    cancelPingRef.current = true;
    setIsPingingAll(false);
    setPingResults({});
    setPingProgress({ current: 0, total: 0 });
  }, []);

  return {
    pingResults,
    isPingingAll,
    pingProgress,
    pingSingle,
    pingAll,
    cancelPing,
    summary,
    clearPingResults,
  };
}
