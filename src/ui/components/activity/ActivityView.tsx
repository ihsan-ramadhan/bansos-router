import { useEffect, useMemo, useState } from "preact/hooks";
import { RefreshCw } from "lucide-preact";
import type { ActivityEvent, UsageStats } from "../../types";
import { fetchEvents, fetchUsage } from "../../services/api";

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function timeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 1000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

const KIND_LABEL: Record<ActivityEvent["kind"], string> = {
  chat: "Chat",
  responses: "Responses",
  anthropic: "Anthropic",
};

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  className?: string;
}

function StatCard({ label, value, hint, className = "" }: StatCardProps) {
  return (
    <div className={`rounded-xl border border-[#1c1f2b] bg-[#10121a] p-3 sm:p-4 shadow-xs flex flex-col justify-between ${className}`}>
      <span className="text-xs font-medium text-[#8b8b96] block mb-1.5">
        {label}
      </span>
      <div className="text-base sm:text-lg font-bold text-white tracking-tight font-mono truncate">
        {value}
      </div>
      {hint && <div className="text-[11px] sm:text-xs text-[#a1a1aa] mt-1.5 truncate">{hint}</div>}
    </div>
  );
}

interface AggregateRowProps {
  label: string;
  requests: number;
  ok: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  sub?: string;
}

function ModelRow({ label, requests, ok, inputTokens, outputTokens, cachedTokens, sub }: AggregateRowProps) {
  return (
    <tr className="border-b border-[#202026] last:border-0">
      <td className="py-2.5 px-3 sm:px-4">
        <div className="text-xs font-medium text-white font-mono truncate max-w-45 sm:max-w-65">
          {label}
        </div>
        {sub && <div className="text-[10px] text-[#a1a1aa] truncate max-w-45 sm:max-w-65">{sub}</div>}
      </td>
      <td className="py-2.5 px-3 sm:px-4 text-right text-xs text-[#d4d4d8] font-mono">{requests}</td>
      <td className="py-2.5 px-3 sm:px-4 text-right text-xs text-[#d4d4d8] font-mono">{ok}</td>
      <td className="py-2.5 px-3 sm:px-4 text-right text-xs text-[#d4d4d8] font-mono">{formatNumber(inputTokens)}</td>
      <td className="py-2.5 px-3 sm:px-4 text-right text-xs text-[#d4d4d8] font-mono">{formatNumber(cachedTokens)}</td>
      <td className="py-2.5 px-3 sm:px-4 text-right text-xs text-[#d4d4d8] font-mono">{formatNumber(outputTokens)}</td>
    </tr>
  );
}

export function ActivityView() {
  const [window, setWindow] = useState<"today" | "7d" | "30d" | "60d" | "all">("today");
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load(showSpinner = false) {
    try {
      if (showSpinner) setRefreshing(true);
      const [u, e] = await Promise.all([fetchUsage(window), fetchEvents(100, window)]);
      setUsage(u);
      setEvents(e);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load activity");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [window]);

  const topModels = useMemo(() => {
    if (!usage) return [];
    return Object.entries(usage.perModel)
      .map(([model, m]) => ({ model, ...m }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 8);
  }, [usage]);

  const topUpstreams = useMemo(() => {
    if (!usage) return [];
    return Object.entries(usage.perUpstream)
      .map(([upstream, u]) => ({ upstream, ...u }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 8);
  }, [usage]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">Activity & Usage</h2>
        </div>

        {/* Time Window Filters & Refresh */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center bg-[#0c0e14] border border-[#1c1f2b] rounded-lg p-0.5 text-[11px]">
            {(
              [
                { id: "today", label: "Today" },
                { id: "7d", label: "7 Days" },
                { id: "30d", label: "30 Days" },
                { id: "60d", label: "60 Days" },
                { id: "all", label: "All" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setWindow(t.id)}
                className={`px-2 py-1 rounded-md transition font-medium cursor-pointer ${
                  window === t.id
                    ? "bg-[#2563eb] text-white shadow-xs"
                    : "text-[#94a3b8] hover:text-white"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#131620] border border-[#1c1f2b] text-[11px] text-[#d4d4d8] hover:text-white hover:border-[#2b334a] transition cursor-pointer disabled:opacity-50 shrink-0"
          >
            <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* Usage summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-4">
        <StatCard
          label="Requests"
          value={usage ? formatNumber(usage.totalRequests) : "-"}
          hint={usage ? `${usage.okRequests} ok · ${usage.errorRequests} err` : undefined}
        />
        <StatCard
          label="Tokens In"
          value={usage ? formatNumber(usage.totalInputTokens) : "-"}
          hint="prompt tokens"
        />
        <StatCard
          label="Tokens Cached"
          value={usage ? formatNumber(usage.totalCachedTokens) : "-"}
          hint={
            usage && usage.totalInputTokens > 0
              ? `${Math.round((usage.totalCachedTokens / usage.totalInputTokens) * 100)}% prompt cache`
              : "prompt cache"
          }
        />
        <StatCard
          label="Tokens Out"
          value={usage ? formatNumber(usage.totalOutputTokens) : "-"}
          hint="completion tokens"
        />
        <StatCard
          label="Avg Latency"
          value={usage ? formatDuration(usage.avgDurationMs) : "-"}
          hint={usage && usage.failoverCount > 0 ? `${usage.failoverCount} failovers` : "no failovers"}
          className="col-span-2 sm:col-span-1"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Per-model aggregates */}
        <div className="rounded-xl border border-[#1c1f2b] bg-[#10121a] overflow-hidden shadow-xs">
          <div className="px-3 sm:px-4 py-3 border-b border-[#1c1f2b] flex items-center justify-between">
            <span className="text-xs font-semibold text-white">
              Usage by Model
            </span>
          </div>
          {loading ? (
            <div className="p-6 text-center text-xs text-[#a1a1aa]">Loading...</div>
          ) : topModels.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#a1a1aa]">No model requests recorded yet in this window.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#0c0e14] text-[11px] sm:text-xs font-medium text-[#a1a1aa]">
                  <tr>
                    <th className="py-2.5 px-3 sm:px-4">Model</th>
                    <th className="py-2.5 px-3 sm:px-4 text-right">Reqs</th>
                    <th className="py-2.5 px-3 sm:px-4 text-right">OK</th>
                    <th className="py-2.5 px-3 sm:px-4 text-right">In</th>
                    <th className="py-2.5 px-3 sm:px-4 text-right">Cached</th>
                    <th className="py-2.5 px-3 sm:px-4 text-right">Out</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#171922] text-xs">
                  {topModels.map((m) => (
                    <ModelRow
                      key={m.model}
                      label={m.model}
                      requests={m.requests}
                      ok={m.ok}
                      inputTokens={m.inputTokens}
                      outputTokens={m.outputTokens}
                      cachedTokens={m.cachedTokens}
                    />
                  ))}
                </tbody>
                {usage && topModels.length > 0 && (
                  <tfoot className="border-t border-[#1c1f2b] bg-[#0c0e14] text-xs font-medium text-[#e4e4e7]">
                    <tr>
                      <td className="py-2.5 px-3 sm:px-4 text-[#a1a1aa]">Total</td>
                      <td className="py-2.5 px-3 sm:px-4 text-right font-mono text-[#d4d4d8]">{usage.totalRequests}</td>
                      <td className="py-2.5 px-3 sm:px-4 text-right font-mono text-[#d4d4d8]">{usage.okRequests}</td>
                      <td className="py-2.5 px-3 sm:px-4 text-right font-mono text-[#d4d4d8]">{formatNumber(usage.totalInputTokens)}</td>
                      <td className="py-2.5 px-3 sm:px-4 text-right font-mono text-emerald-400 font-semibold">{formatNumber(usage.totalCachedTokens)}</td>
                      <td className="py-2.5 px-3 sm:px-4 text-right font-mono text-[#d4d4d8]">{formatNumber(usage.totalOutputTokens)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>

        {/* Per-upstream aggregates */}
        <div className="rounded-xl border border-[#1c1f2b] bg-[#10121a] overflow-hidden shadow-xs">
          <div className="px-3 sm:px-4 py-3 border-b border-[#1c1f2b] flex items-center justify-between">
            <span className="text-xs font-semibold text-white">
              Usage by Upstream
            </span>
          </div>
          {loading ? (
            <div className="p-6 text-center text-xs text-[#a1a1aa]">Loading...</div>
          ) : topUpstreams.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#a1a1aa]">No upstream requests recorded yet in this window.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#0c0e14] text-[11px] sm:text-xs font-medium text-[#a1a1aa]">
                  <tr>
                    <th className="py-2.5 px-3 sm:px-4">Upstream</th>
                    <th className="py-2.5 px-3 sm:px-4 text-right">Reqs</th>
                    <th className="py-2.5 px-3 sm:px-4 text-right">OK</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#171922] text-xs">
                  {topUpstreams.map((u) => (
                    <tr key={u.upstream} className="border-b border-[#171922] last:border-0">
                      <td className="py-2.5 px-3 sm:px-4">
                        <div className="text-xs font-medium text-white font-mono truncate max-w-50">
                          {u.upstream}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 sm:px-4 text-right text-xs text-[#d4d4d8] font-mono">{u.requests}</td>
                      <td className="py-2.5 px-3 sm:px-4 text-right text-xs text-[#d4d4d8] font-mono">{u.ok}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Recent requests feed */}
      <div className="rounded-xl border border-[#1c1f2b] bg-[#10121a] overflow-hidden shadow-xs">
        <div className="px-3 sm:px-4 py-3 border-b border-[#1c1f2b] flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-white">
            Recent Requests
          </span>
          {!loading && events.length > 0 && (
            <span className="text-[10px] text-[#a1a1aa] font-mono">last {events.length}</span>
          )}
        </div>
        {loading ? (
          <div className="p-6 text-center text-xs text-[#a1a1aa]">Loading...</div>
        ) : events.length === 0 ? (
          <div className="p-6 text-center text-xs text-[#a1a1aa] space-y-1">
            <p>No requests recorded yet in this window.</p>
            <p className="text-[11px] text-[#8b8b96]">
              Send a prompt through your agent harness or curl <code className="text-[#d4d4d8] font-mono bg-[#0c0e14] px-1 py-0.5 rounded border border-[#1c1f2b]">/v1/chat/completions</code> to see live requests here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-[#0c0e14] text-[11px] sm:text-xs font-medium text-[#a1a1aa]">
                <tr>
                  <th className="py-2.5 px-3 sm:px-4">When</th>
                  <th className="py-2.5 px-3 sm:px-4">Status</th>
                  <th className="py-2.5 px-3 sm:px-4">Type</th>
                  <th className="py-2.5 px-3 sm:px-4">Model</th>
                  <th className="py-2.5 px-3 sm:px-4">Upstream</th>
                  <th className="py-2.5 px-3 sm:px-4 text-right">In/Out</th>
                  <th className="py-2.5 px-3 sm:px-4 text-right">Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202026] text-xs">
                {events.map((e) => (
                  <tr key={e.id} className="border-b border-[#202026] last:border-0">
                    <td className="py-2.5 px-3 sm:px-4 text-[#a1a1aa] whitespace-nowrap">{timeAgo(e.timestamp)}</td>
                    <td className="py-2.5 px-3 sm:px-4">
                      {e.status === "ok" ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/40 text-emerald-400 border border-emerald-800/40 font-mono">
                          200 OK
                        </span>
                      ) : e.statusCode === 429 ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/40 text-amber-400 border border-amber-800/40 font-mono">
                          429
                        </span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-950/40 text-rose-400 border border-rose-800/40 font-mono">
                          {e.statusCode ? `ERR ${e.statusCode}` : "ERR"}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 sm:px-4">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#202028] text-[#a1a1aa] border border-[#2c2c36] font-medium">
                        {KIND_LABEL[e.kind]}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 sm:px-4">
                      <div className="font-mono text-[#e4e4e7] truncate max-w-40 sm:max-w-55">
                        {e.model}
                        {e.failoverFrom && (
                          <span className="text-[10px] text-amber-400/90" title={`failed over from ${e.failoverFrom}`}>
                            {" "}↺ {e.failoverFrom}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 sm:px-4 font-mono text-[#a1a1aa] truncate max-w-30">{e.upstream}</td>
                    <td className="py-2.5 px-3 sm:px-4 text-right font-mono text-[#d4d4d8] whitespace-nowrap">
                      {formatNumber(e.inputTokens)}/{formatNumber(e.outputTokens)}
                    </td>
                    <td className="py-2.5 px-3 sm:px-4 text-right font-mono text-[#d4d4d8] whitespace-nowrap">
                      {formatDuration(e.durationMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
