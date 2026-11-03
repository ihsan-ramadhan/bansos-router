import { useState, useEffect } from "preact/hooks";
import type { DaemonStatus } from "../../types";
import { formatProviderShort } from "../../utils/models";

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

  return (
    <div className="rounded-lg border border-[#1c1f2b] bg-[#10121a] px-3.5 py-2 sm:py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-y-2 gap-x-4 text-xs font-mono">
      {/* Models breakdown */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[#64748b] hidden sm:inline">Models:</span>
        <span className="font-bold text-white">{usableCount}</span>
        <span className="text-[#94a3b8] hidden lg:inline">
          ({usable.length > 0 ? usable.map((p) => `${formatProviderShort(p.id)} ${p.models}`).join(" · ") : "no models"})
        </span>
        {blocked.length > 0 && (
          <span className="text-amber-400/80 text-[11px] hidden sm:inline">
            ({blocked.map((p) => formatProviderShort(p.id)).join(", ")} blocked)
          </span>
        )}
      </div>

      {/* Uptime */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[#64748b]">Uptime:</span>
        <span className="font-bold text-white">{uptimeText}</span>
        {isOnline && (
          <span className={`text-[11px] hidden sm:inline ${status?.security?.allowCrossProviderFailover !== false ? "text-emerald-400" : "text-[#64748b]"}`}>
            ({status?.security?.allowCrossProviderFailover !== false ? "failover on" : "failover off"})
          </span>
        )}
      </div>

      {/* Egress */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[#64748b]">Egress:</span>
        <span className={`font-semibold ${status?.relay?.enabled ? "text-amber-400" : "text-emerald-400"}`}>
          {status?.relay?.enabled ? "Relay" : "Direct"}
        </span>
      </div>
    </div>
  );
}
