import { useEffect, useMemo, useState } from "preact/hooks";
import { RefreshCw } from "lucide-preact";
import type { ActivityEvent, UsageStats, InFlightRequest } from "../../types";
import { fetchEvents, fetchUsage } from "../../services/api";
import { LiveRouting } from "./LiveRouting";
import { exactTitle, formatCount, formatExact } from "../../utils/format";

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

const HTTP_STATUS_LABELS: Record<number, string> = {
  200: "200 OK",
  201: "201 Created",
  204: "204 No Content",
  400: "400 Bad Request",
  401: "401 Unauthorized",
  403: "403 Forbidden",
  404: "404 Not Found",
  408: "408 Request Timeout",
  422: "422 Unprocessable Entity",
  429: "429 Too Many Requests",
  500: "500 Internal Server Error",
  502: "502 Bad Gateway",
  503: "503 Service Unavailable",
  504: "504 Gateway Timeout",
};

function statusLabel(code?: number): string {
  if (!code) return "Error";
  return HTTP_STATUS_LABELS[code] ?? `HTTP ${code}`;
}

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  exact?: string;
  className?: string;
}

function StatCard({ label, value, hint, exact, className = "" }: StatCardProps) {
  return (
    <div className={`rounded-xl border border-[#1c1f2b] bg-[#10121a] p-3 sm:p-4 shadow-xs flex flex-col justify-between ${className}`}>
      <span className="text-xs font-medium text-[#8b8b96] block mb-1.5">
        {label}
      </span>
      <div className="text-base sm:text-lg font-bold text-white tracking-tight font-mono truncate" title={exact}>
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
      <td className="py-2 px-2.5 sm:px-3">
        <div className="text-xs font-medium text-white font-mono truncate max-w-36 sm:max-w-50" title={label}>
          {label}
        </div>
        {sub && <div className="text-[10px] text-[#a1a1aa] truncate max-w-36 sm:max-w-50">{sub}</div>}
      </td>
      <td className="py-2 px-1.5 sm:px-2 text-right text-xs text-[#d4d4d8] font-mono whitespace-nowrap" title={exactTitle(requests)}>{formatCount(requests)}</td>
      <td className="py-2 px-1.5 sm:px-2 text-right text-xs text-[#d4d4d8] font-mono whitespace-nowrap" title={exactTitle(ok)}>{formatCount(ok)}</td>
      <td className="py-2 px-1.5 sm:px-2 text-right text-xs text-[#d4d4d8] font-mono whitespace-nowrap" title={exactTitle(inputTokens)}>{formatCount(inputTokens)}</td>
      <td className="py-2 px-1.5 sm:px-2 text-right text-xs text-emerald-400 font-medium whitespace-nowrap" title={exactTitle(cachedTokens)}>{formatCount(cachedTokens)}</td>
      <td className="py-2 px-1.5 sm:px-2 text-right text-xs text-[#d4d4d8] font-mono whitespace-nowrap" title={exactTitle(outputTokens)}>{formatCount(outputTokens)}</td>
    </tr>
  );
}

export function ActivityView() {
  const [window, setWindow] = useState<"today" | "7d" | "30d" | "60d" | "all">("today");
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [inFlight, setInFlight] = useState<InFlightRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load(showSpinner = false) {
    try {
      if (showSpinner) setRefreshing(true);
      const [u, evData] = await Promise.all([fetchUsage(window), fetchEvents(100, window)]);
      setUsage(u);
      setEvents(evData.events);
      setInFlight(evData.inFlight);
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
    const timer = setInterval(() => void load(), 1000);
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

      <LiveRouting events={events} inFlight={inFlight} usage={usage} loading={loading} error={error} />
      {/* Usage summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-4">
        <StatCard
          label="Requests"
          value={usage ? formatCount(usage.totalRequests) : "-"}
          exact={usage ? exactTitle(usage.totalRequests) : undefined}
          hint={usage ? `${formatCount(usage.okRequests)} ok · ${formatCount(usage.errorRequests)} err` : undefined}
        />
        <StatCard
          label="Tokens In"
          value={usage ? formatCount(usage.totalInputTokens) : "-"}
          exact={usage ? exactTitle(usage.totalInputTokens) : undefined}
          hint="prompt tokens"
        />
        <StatCard
          label="Tokens Cached"
          value={usage ? formatCount(usage.totalCachedTokens) : "-"}
          exact={usage ? exactTitle(usage.totalCachedTokens) : undefined}
          hint={
            usage && usage.totalInputTokens > 0
              ? `${Math.round((usage.totalCachedTokens / usage.totalInputTokens) * 100)}% prompt cache`
              : "prompt cache"
          }
        />
        <StatCard
          label="Tokens Out"
          value={usage ? formatCount(usage.totalOutputTokens) : "-"}
          exact={usage ? exactTitle(usage.totalOutputTokens) : undefined}
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
                    <th className="py-2 px-2.5 sm:px-3">Model</th>
                    <th className="py-2 px-1.5 sm:px-2 text-right">Reqs</th>
                    <th className="py-2 px-1.5 sm:px-2 text-right">OK</th>
                    <th className="py-2 px-1.5 sm:px-2 text-right">In</th>
                    <th className="py-2 px-1.5 sm:px-2 text-right">Cached</th>
                    <th className="py-2 px-1.5 sm:px-2 text-right">Out</th>
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
                      <td className="py-2 px-2.5 sm:px-3 text-[#a1a1aa]">Total</td>
                      <td className="py-2 px-1.5 sm:px-2 text-right font-mono text-[#d4d4d8] whitespace-nowrap" title={exactTitle(usage.totalRequests)}>{formatCount(usage.totalRequests)}</td>
                      <td className="py-2 px-1.5 sm:px-2 text-right font-mono text-[#d4d4d8] whitespace-nowrap" title={exactTitle(usage.okRequests)}>{formatCount(usage.okRequests)}</td>
                      <td className="py-2 px-1.5 sm:px-2 text-right font-mono text-[#d4d4d8] whitespace-nowrap" title={exactTitle(usage.totalInputTokens)}>{formatCount(usage.totalInputTokens)}</td>
                      <td className="py-2 px-1.5 sm:px-2 text-right font-mono text-emerald-400 font-semibold whitespace-nowrap" title={exactTitle(usage.totalCachedTokens)}>{formatCount(usage.totalCachedTokens)}</td>
                      <td className="py-2 px-1.5 sm:px-2 text-right font-mono text-[#d4d4d8] whitespace-nowrap" title={exactTitle(usage.totalOutputTokens)}>{formatCount(usage.totalOutputTokens)}</td>
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
                    <th className="py-2 px-2.5 sm:px-3">Upstream</th>
                    <th className="py-2 px-1.5 sm:px-2 text-right">Reqs</th>
                    <th className="py-2 px-1.5 sm:px-2 text-right">OK</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#171922] text-xs">
                  {topUpstreams.map((u) => (
                    <tr key={u.upstream} className="border-b border-[#171922] last:border-0">
                      <td className="py-2 px-2.5 sm:px-3">
                        <div className="text-xs font-medium text-white font-mono truncate max-w-40 sm:max-w-50">
                          {u.upstream}
                        </div>
                      </td>
                      <td className="py-2 px-1.5 sm:px-2 text-right text-xs text-[#d4d4d8] font-mono">{u.requests}</td>
                      <td className="py-2 px-1.5 sm:px-2 text-right text-xs text-[#d4d4d8] font-mono">{u.ok}</td>
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
            <table className="w-full text-left border-collapse table-fixed">
              <thead className="bg-[#0c0e14] text-[11px] sm:text-xs font-medium text-[#a1a1aa]">
                <tr>
                  <th className="py-2 px-1.5 sm:px-2 text-[11px] font-medium text-[#a1a1aa] whitespace-nowrap w-17 sm:w-[13%]">When</th>
                  <th className="py-2 px-1.5 sm:px-2 text-[11px] font-medium text-[#a1a1aa] text-center w-13 sm:w-[11%]">Status</th>
                  <th className="py-2 px-1.5 sm:px-2 text-[11px] font-medium text-[#a1a1aa] text-center w-14 sm:w-[11%]">Type</th>
                  <th className="py-2 px-1.5 sm:px-2 text-[11px] font-medium text-[#a1a1aa] whitespace-nowrap w-30 sm:w-[23%]">Model</th>
                  <th className="py-2 px-1.5 sm:px-2 text-[11px] font-medium text-[#a1a1aa] whitespace-nowrap w-16 sm:w-[11%]">Upstream</th>
                  <th className="py-2 px-1.5 sm:px-2 text-[11px] font-medium text-[#a1a1aa] text-right whitespace-nowrap w-25 sm:w-[16%]">In/Out</th>
                  <th className="py-2 px-1.5 sm:px-2 text-[11px] font-medium text-[#a1a1aa] text-right whitespace-nowrap w-17 sm:w-[15%]">Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202026] text-xs">
                {events.map((e) => (
                  <tr key={e.id} className="border-b border-[#202026] last:border-0 hover:bg-[#131620]/60 transition-colors">
                    <td className="py-2 px-1.5 sm:px-2 text-[#a1a1aa] text-[11px] whitespace-nowrap">{timeAgo(e.timestamp)}</td>
                    <td className="py-2 px-1.5 sm:px-2 text-center">
                      {e.status === "ok" ? (
                        <span
                          title={statusLabel(e.statusCode ?? 200)}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/40 text-emerald-400 border border-emerald-800/40 font-mono cursor-default"
                        >
                          {e.statusCode ?? 200}
                        </span>
                      ) : e.statusCode === 429 ? (
                        <span
                          title={statusLabel(429)}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/40 text-amber-400 border border-amber-800/40 font-mono cursor-default"
                        >
                          429
                        </span>
                      ) : (
                        <span
                          title={statusLabel(e.statusCode)}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-rose-950/40 text-rose-400 border border-rose-800/40 font-mono cursor-default"
                        >
                          {e.statusCode ?? "ERR"}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-1.5 sm:px-2 text-center">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#202028] text-[#a1a1aa] border border-[#2c2c36] font-medium">
                        {KIND_LABEL[e.kind]}
                      </span>
                    </td>
                    <td className="py-2 px-1.5 sm:px-2">
                      <div className="font-mono text-[#e4e4e7] text-[11px] sm:text-xs truncate max-w-44 sm:max-w-56" title={e.model}>
                        {e.model}
                        {e.failoverFrom && (
                          <span className="text-[10px] text-amber-400/90" title={`failed over from ${e.failoverFrom}`}>
                            {" "}↺ {e.failoverFrom}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-1.5 sm:px-2 font-mono text-[#a1a1aa] text-[11px] sm:text-xs truncate max-w-24 sm:max-w-30">{e.upstream}</td>
                    <td className="py-2 px-1.5 sm:px-2 text-right font-mono text-[11px] sm:text-xs text-[#d4d4d8] whitespace-nowrap">
                      <span title={`${formatExact(e.inputTokens)} in / ${formatExact(e.outputTokens)} out`}>
                        {formatCount(e.inputTokens)}/{formatCount(e.outputTokens)}
                      </span>
                    </td>
                    <td className="py-2 px-1.5 sm:px-2 text-right font-mono text-[11px] sm:text-xs text-[#d4d4d8] whitespace-nowrap">
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
