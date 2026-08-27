import { useEffect, useMemo, useState } from "preact/hooks";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Coins,
  GitBranch,
  RefreshCw,
  Server,
  Timer,
} from "lucide-preact";
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
  icon: preact.ComponentChild;
  hint?: string;
}

function StatCard({ label, value, icon, hint }: StatCardProps) {
  return (
    <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-3 sm:p-4 shadow-xs flex flex-col justify-between">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] sm:text-[11px] font-semibold text-[#8b8b96] uppercase tracking-wider">
          {label}
        </span>
        <div className="p-1 sm:p-1.5 rounded-lg bg-[#1a1a20] text-[#71717a] border border-[#282832] shrink-0">
          {icon}
        </div>
      </div>
      <div className="text-base sm:text-lg font-bold text-white tracking-tight font-mono truncate">
        {value}
      </div>
      {hint && <div className="text-[11px] sm:text-xs text-[#71717a] mt-1.5 truncate">{hint}</div>}
    </div>
  );
}

interface AggregateRowProps {
  label: string;
  requests: number;
  ok: number;
  inputTokens: number;
  outputTokens: number;
  sub?: string;
}

function ModelRow({ label, requests, ok, inputTokens, outputTokens, sub }: AggregateRowProps) {
  return (
    <tr className="border-b border-[#202026] last:border-0">
      <td className="py-2.5 px-3 sm:px-4">
        <div className="text-xs font-medium text-white font-mono truncate max-w-45 sm:max-w-65">
          {label}
        </div>
        {sub && <div className="text-[10px] text-[#71717a] truncate max-w-45 sm:max-w-65">{sub}</div>}
      </td>
      <td className="py-2.5 px-3 sm:px-4 text-right text-xs text-[#d4d4d8] font-mono">{requests}</td>
      <td className="py-2.5 px-3 sm:px-4 text-right text-xs text-[#d4d4d8] font-mono">{ok}</td>
      <td className="py-2.5 px-3 sm:px-4 text-right text-xs text-[#d4d4d8] font-mono">{formatNumber(inputTokens)}</td>
      <td className="py-2.5 px-3 sm:px-4 text-right text-xs text-[#d4d4d8] font-mono">{formatNumber(outputTokens)}</td>
    </tr>
  );
}

export function ActivityView() {
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load(showSpinner = false) {
    try {
      if (showSpinner) setRefreshing(true);
      const [u, e] = await Promise.all([fetchUsage(), fetchEvents(100)]);
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
  }, []);

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
          <Activity className="h-4 w-4 sm:h-5 sm:w-5 text-[#60a5fa] shrink-0" />
          <h2 className="text-sm sm:text-base font-semibold text-white truncate">Activity & Usage</h2>
          <span className="text-[10px] sm:text-[11px] px-2 py-0.5 rounded-full bg-[#202028] text-[#a1a1aa] border border-[#2c2c36] font-medium shrink-0">
            Live (resets on restart)
          </span>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#1a1a20] border border-[#282832] text-[11px] text-[#d4d4d8] hover:text-white hover:border-[#32323d] transition cursor-pointer disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* Usage summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        <StatCard
          label="Requests"
          value={usage ? formatNumber(usage.totalRequests) : "—"}
          icon={<Server className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
          hint={usage ? `${usage.okRequests} ok · ${usage.errorRequests} err` : undefined}
        />
        <StatCard
          label="Tokens In"
          value={usage ? formatNumber(usage.totalInputTokens) : "—"}
          icon={<ArrowDownLeft className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
          hint="prompt tokens"
        />
        <StatCard
          label="Tokens Out"
          value={usage ? formatNumber(usage.totalOutputTokens) : "—"}
          icon={<ArrowUpRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
          hint="completion tokens"
        />
        <StatCard
          label="Avg Latency"
          value={usage ? formatDuration(usage.avgDurationMs) : "—"}
          icon={<Timer className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
          hint={usage && usage.failoverCount > 0 ? `${usage.failoverCount} failovers` : "no failovers"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Per-model aggregates */}
        <div className="rounded-xl border border-[#23232a] bg-[#16161a] overflow-hidden shadow-xs">
          <div className="px-3 sm:px-4 py-3 border-b border-[#23232a] flex items-center gap-2">
            <Coins className="h-3.5 w-3.5 text-[#71717a]" />
            <span className="text-[11px] sm:text-xs font-semibold text-[#8b8b96] uppercase tracking-wider">
              Usage by Model
            </span>
          </div>
          {loading ? (
            <div className="p-6 text-center text-xs text-[#71717a]">Loading…</div>
          ) : topModels.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#71717a]">No requests recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#121215] text-[10px] sm:text-[11px] font-semibold text-[#8b8b96] uppercase tracking-wider">
                  <tr>
                    <th className="py-2.5 px-3 sm:px-4">Model</th>
                    <th className="py-2.5 px-3 sm:px-4 text-right">Reqs</th>
                    <th className="py-2.5 px-3 sm:px-4 text-right">OK</th>
                    <th className="py-2.5 px-3 sm:px-4 text-right">In</th>
                    <th className="py-2.5 px-3 sm:px-4 text-right">Out</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#202026] text-xs">
                  {topModels.map((m) => (
                    <ModelRow
                      key={m.model}
                      label={m.model}
                      requests={m.requests}
                      ok={m.ok}
                      inputTokens={m.inputTokens}
                      outputTokens={m.outputTokens}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Per-upstream aggregates */}
        <div className="rounded-xl border border-[#23232a] bg-[#16161a] overflow-hidden shadow-xs">
          <div className="px-3 sm:px-4 py-3 border-b border-[#23232a] flex items-center gap-2">
            <GitBranch className="h-3.5 w-3.5 text-[#71717a]" />
            <span className="text-[11px] sm:text-xs font-semibold text-[#8b8b96] uppercase tracking-wider">
              Usage by Upstream
            </span>
          </div>
          {loading ? (
            <div className="p-6 text-center text-xs text-[#71717a]">Loading…</div>
          ) : topUpstreams.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#71717a]">No requests recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#121215] text-[10px] sm:text-[11px] font-semibold text-[#8b8b96] uppercase tracking-wider">
                  <tr>
                    <th className="py-2.5 px-3 sm:px-4">Upstream</th>
                    <th className="py-2.5 px-3 sm:px-4 text-right">Reqs</th>
                    <th className="py-2.5 px-3 sm:px-4 text-right">OK</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#202026] text-xs">
                  {topUpstreams.map((u) => (
                    <tr key={u.upstream} className="border-b border-[#202026] last:border-0">
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
      <div className="rounded-xl border border-[#23232a] bg-[#16161a] overflow-hidden shadow-xs">
        <div className="px-3 sm:px-4 py-3 border-b border-[#23232a] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-[#71717a]" />
            <span className="text-[11px] sm:text-xs font-semibold text-[#8b8b96] uppercase tracking-wider">
              Recent Requests
            </span>
          </div>
          {!loading && events.length > 0 && (
            <span className="text-[10px] text-[#71717a] font-mono">last {events.length}</span>
          )}
        </div>
        {loading ? (
          <div className="p-6 text-center text-xs text-[#71717a]">Loading…</div>
        ) : events.length === 0 ? (
          <div className="p-6 text-center text-xs text-[#71717a]">
            No requests yet — send a prompt through the router to see activity here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-[#121215] text-[10px] sm:text-[11px] font-semibold text-[#8b8b96] uppercase tracking-wider">
                <tr>
                  <th className="py-2.5 px-3 sm:px-4">When</th>
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
