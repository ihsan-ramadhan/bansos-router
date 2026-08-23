import { useState, useCallback } from "preact/hooks";
import type { ModelItem, PingResult } from "../types/ui";
import { pingModel } from "../services/api";

export interface PingSummary {
  total: number;
  ok: number;
  rateLimited: number;
  error: number;
}

export function usePing() {
  const [pingResults, setPingResults] = useState<Record<string, PingResult>>({});
  const [isPingingAll, setIsPingingAll] = useState(false);

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

  const pingAll = useCallback(async (models: ModelItem[]) => {
    if (isPingingAll || models.length === 0) return;
    setIsPingingAll(true);

    // Chunk in batches of 4 to prevent socket exhaustion
    const chunkSize = 4;
    for (let i = 0; i < models.length; i += chunkSize) {
      const chunk = models.slice(i, i + chunkSize);
      await Promise.all(chunk.map((m) => pingSingle(m)));
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
    setPingResults({});
  }, []);

  return {
    pingResults,
    isPingingAll,
    pingSingle,
    pingAll,
    summary,
    clearPingResults,
  };
}
