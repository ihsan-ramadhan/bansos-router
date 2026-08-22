import { useState, useEffect } from "preact/hooks";
import type { DaemonStatus } from "../types/ui";
import { Server, Cpu, Clock, ShieldCheck, ShieldAlert } from "lucide-preact";

interface MetricCardsProps {
  status: DaemonStatus | null;
  loading: boolean;
}

export function MetricCards({ status, loading }: MetricCardsProps) {
  const isOnline = Boolean(status);

  // Live ticking uptime counter synced with daemon
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

  const uptimeText = isOnline
    ? liveUptime >= 3600
      ? `${Math.floor(liveUptime / 3600)}h ${Math.floor((liveUptime % 3600) / 60)}m`
      : `${Math.floor(liveUptime / 60)}m ${liveUptime % 60}s`
    : "0s";

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Daemon Status Card */}
      <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-4 transition-all duration-200 hover:border-[#2e2e38] shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-[#8b8b96] uppercase tracking-wider">
            Daemon Status
          </span>
          <div className="p-1.5 rounded-lg bg-[#202026] text-[#8b8b96]">
            <Server className="h-4 w-4" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              isOnline ? "bg-emerald-500 shadow-sm shadow-emerald-500/50" : "bg-rose-500"
            }`}
          />
          <span className="text-lg font-bold text-white tracking-tight">
            {loading && !status ? "Connecting..." : isOnline ? "Online" : "Disconnected"}
          </span>
        </div>
        <div className="text-xs text-[#71717a] mt-1 font-mono">
          Port {status?.port ?? 17070} • 127.0.0.1
        </div>
      </div>

      {/* Active Models Card */}
      <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-4 transition-all duration-200 hover:border-[#2e2e38] shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-[#8b8b96] uppercase tracking-wider">
            Active Models
          </span>
          <div className="p-1.5 rounded-lg bg-[#202026] text-[#8b8b96]">
            <Cpu className="h-4 w-4" />
          </div>
        </div>
        <div className="text-lg font-bold text-white tracking-tight">
          {status?.modelCount ?? 0} <span className="text-sm font-normal text-[#a1a1aa]">Available</span>
        </div>
        <div className="text-xs text-[#71717a] mt-1">
          OpenCode Zen, Kilo, LLM7
        </div>
      </div>

      {/* Uptime Card */}
      <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-4 transition-all duration-200 hover:border-[#2e2e38] shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-[#8b8b96] uppercase tracking-wider">
            Daemon Uptime
          </span>
          <div className="p-1.5 rounded-lg bg-[#202026] text-[#8b8b96]">
            <Clock className="h-4 w-4" />
          </div>
        </div>
        <div className="text-lg font-bold text-white tracking-tight font-mono">
          {uptimeText}
        </div>
        <div className="text-xs text-emerald-400 mt-1 flex items-center gap-1 font-medium">
          <span>●</span> Auto-failover active
        </div>
      </div>

      {/* Egress Mode Card */}
      <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-4 transition-all duration-200 hover:border-[#2e2e38] shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-[#8b8b96] uppercase tracking-wider">
            Egress Mode
          </span>
          <div className="p-1.5 rounded-lg bg-[#202026] text-[#8b8b96]">
            {status?.relay?.enabled ? (
              <ShieldAlert className="h-4 w-4" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              status?.relay?.enabled ? "bg-amber-400" : "bg-emerald-400"
            }`}
          />
          <span className="text-lg font-bold text-white tracking-tight">
            {status?.relay?.enabled ? "Relay Active" : "Direct Egress"}
          </span>
        </div>
        <div className="text-xs text-[#71717a] mt-1 truncate">
          {status?.relay?.enabled && status?.relay?.url ? status.relay.url : "Direct IP connection"}
        </div>
      </div>
    </div>
  );
}
