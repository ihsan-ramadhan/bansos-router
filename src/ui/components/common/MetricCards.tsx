import { useState, useEffect } from "preact/hooks";
import type { DaemonStatus } from "../../types";
import { Server, Cpu, Clock, ShieldCheck, ShieldAlert } from "lucide-preact";
import { formatProviderLabel, formatProviderShort } from "../../utils/models";

interface MetricCardsProps {
  status: DaemonStatus | null;
  loading: boolean;
  daemonAddress?: string;
}

export function MetricCards({ status, loading, daemonAddress }: MetricCardsProps) {
  const isOnline = Boolean(status);
  const providers = status?.providers ?? [];
  const usable = providers.filter((p) => p.allowed);
  const blocked = providers.filter((p) => !p.allowed);
  const usableCount = status?.providers ? usable.reduce((n, p) => n + p.models, 0) : (status?.modelCount ?? 0);
  const strict = status?.security?.mode === "strict";

  const [liveUptime, setLiveUptime] = useState<number>(status?.uptimeSeconds ?? 0);

  useEffect(() => {
    if (status?.uptimeSeconds !== undefined) {
      setLiveUptime(status.uptimeSeconds);
    }
  }, [status?.uptimeSeconds]);

  useEffect(() => {
    if (!isOnline) return;
    const timer = setInterval(() => {
      setLiveUptime((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isOnline]);

  let uptimeText = "0s";
  if (isOnline) {
    if (liveUptime >= 3600) {
      uptimeText = `${Math.floor(liveUptime / 3600)}h ${Math.floor((liveUptime % 3600) / 60)}m`;
    } else {
      uptimeText = `${Math.floor(liveUptime / 60)}m ${liveUptime % 60}s`;
    }
  }

  let statusLabel = "Connecting...";
  let statusDotColor = "bg-amber-400";
  if (isOnline) {
    statusLabel = "Online";
    statusDotColor = "bg-emerald-500 shadow-xs shadow-emerald-500/50";
  } else if (!loading && !isOnline) {
    statusLabel = "Disconnected";
    statusDotColor = "bg-rose-500";
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
      {/* Daemon Status */}
      <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-3 sm:p-4 transition-all duration-200 hover:border-[#2e2e38] shadow-xs flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] sm:text-[11px] font-semibold text-[#8b8b96] uppercase tracking-wider">
              Status
            </span>
            <div className="p-1 sm:p-1.5 rounded-lg bg-[#1a1a20] text-[#71717a] border border-[#282832] shrink-0">
              <Server className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span
              className={`h-2 w-2 sm:h-2.5 sm:w-2.5 rounded-full shrink-0 ${statusDotColor}`}
            />
            <span className="text-base sm:text-lg font-bold text-white tracking-tight truncate">
              {statusLabel}
            </span>
          </div>
        </div>
        <div className="text-[11px] sm:text-xs text-[#71717a] mt-1.5 font-mono truncate">
          {daemonAddress || `127.0.0.1:${status?.port ?? 17070}`}
        </div>
      </div>

      {/* Active Models */}
      <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-3 sm:p-4 transition-all duration-200 hover:border-[#2e2e38] shadow-xs flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] sm:text-[11px] font-semibold text-[#8b8b96] uppercase tracking-wider">
              Models
            </span>
            <div className="p-1 sm:p-1.5 rounded-lg bg-[#1a1a20] text-[#71717a] border border-[#282832] shrink-0">
              <Cpu className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </div>
          </div>
          <div className="text-base sm:text-lg font-bold text-white tracking-tight flex items-baseline gap-1.5">
            <span>{usableCount}</span>
            <span className="text-xs font-normal text-[#a1a1aa]">Available</span>
          </div>
        </div>
        <div
          className="text-[11px] sm:text-xs text-[#71717a] mt-1.5 truncate"
          title={providers
            .map((p) => `${formatProviderLabel(p.id)}: ${p.models}${p.allowed ? "" : " (blocked by strict mode)"}`)
            .join("\n") || undefined}
        >
          {usable.length > 0
            ? usable.map((p) => `${formatProviderShort(p.id)} ${p.models}`).join(" · ")
            : isOnline
              ? blocked.length > 0
                ? "No allowed provider in strict mode"
                : "No models yet. Refresh the catalog."
              : "Start bansos to load models"}
          {usable.length > 0 && blocked.length > 0 && (
            <span className="text-amber-300/80"> · {blocked.map((p) => formatProviderShort(p.id)).join(", ")} blocked</span>
          )}
        </div>
      </div>

      {/* Uptime */}
      <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-3 sm:p-4 transition-all duration-200 hover:border-[#2e2e38] shadow-xs flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] sm:text-[11px] font-semibold text-[#8b8b96] uppercase tracking-wider">
              Uptime
            </span>
            <div className="p-1 sm:p-1.5 rounded-lg bg-[#1a1a20] text-[#71717a] border border-[#282832] shrink-0">
              <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </div>
          </div>
          <div className="text-base sm:text-lg font-bold text-white tracking-tight font-mono truncate">
            {uptimeText}
          </div>
        </div>
        {isOnline && strict ? (
          <div
            className="text-[11px] sm:text-xs text-[#9393a0] mt-1.5 truncate"
            title="Strict mode: only allowed providers get requests and cross-provider failover is off"
          >
            Strict · {status?.security?.dlp === "block" ? "blocks" : "redacts"} secrets · no failover
          </div>
        ) : isOnline && status?.security?.allowCrossProviderFailover !== false ? (
          <div
            className="text-[11px] sm:text-xs text-emerald-400 mt-1.5 flex items-center gap-1 font-medium truncate"
            title="When a model answers 429 or 5xx, bansos retries on a similar model from another provider"
          >
            <span className="text-[10px]">●</span> Auto-failover on
          </div>
        ) : isOnline ? (
          <div className="text-[11px] sm:text-xs text-[#9393a0] mt-1.5 truncate">Failover off</div>
        ) : (
          <div className="text-[11px] sm:text-xs text-[#71717a] mt-1.5 truncate">
            Daemon stopped
          </div>
        )}
      </div>

      {/* Egress Mode */}
      <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-3 sm:p-4 transition-all duration-200 hover:border-[#2e2e38] shadow-xs flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] sm:text-[11px] font-semibold text-[#8b8b96] uppercase tracking-wider">
              Egress Mode
            </span>
            <div className="p-1 sm:p-1.5 rounded-lg bg-[#1a1a20] text-[#71717a] border border-[#282832] shrink-0">
              {status?.relay?.enabled ? (
                <ShieldAlert className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span
              className={`h-2 w-2 sm:h-2.5 sm:w-2.5 rounded-full shrink-0 ${
                status?.relay?.enabled ? "bg-amber-400" : "bg-emerald-400"
              }`}
            />
            <span className="text-base sm:text-lg font-bold text-white tracking-tight truncate">
              {status?.relay?.enabled ? "Relay Active" : "Direct (Local IP)"}
            </span>
          </div>
        </div>
        <div className="text-[11px] sm:text-xs text-[#71717a] mt-1.5 truncate">
          {status?.relay?.enabled && status?.relay?.url ? status.relay.url : "Direct connection (no proxy)"}
        </div>
      </div>
    </div>
  );
}
