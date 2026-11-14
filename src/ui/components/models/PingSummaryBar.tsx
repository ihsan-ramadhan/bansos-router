import { CheckCircle2, AlertTriangle, XCircle, Loader2, RotateCcw } from "lucide-preact";
import type { HealthFilter } from "../../utils/models";
import type { PingStats } from "../../types";

interface PingSummaryBarProps {
  pingStats: PingStats;
  activeHealthChip: HealthFilter;
  onSelectHealthChip: (chip: HealthFilter) => void;
  pingProgress?: { current: number; total: number };
  onClearPings?: () => void;
}

const CHIP_BASE = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition border cursor-pointer";

export function PingSummaryBar({
  pingStats,
  activeHealthChip,
  onSelectHealthChip,
  pingProgress,
  onClearPings,
}: PingSummaryBarProps) {
  if (pingStats.total === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5 px-3 sm:px-4 py-2 sm:py-2.5 bg-[#10121a] border border-[#1c1f2b] rounded-lg text-xs shadow-xs animate-in fade-in">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-[#8b8b96] uppercase tracking-wider text-[10px] sm:text-[11px] mr-1">
          Ping Filter:
        </span>

        <button
          type="button"
          onClick={() => onSelectHealthChip("all")}
          className={`${CHIP_BASE} ${
            activeHealthChip === "all"
              ? "bg-[#2563eb] text-[#f8fafc] border-[#2563eb]"
              : "bg-[#131620] text-[#a1a1aa] border-[#1c1f2b] hover:text-white"
          }`}
        >
          All ({pingStats.total})
        </button>

        <button
          type="button"
          onClick={() => onSelectHealthChip(activeHealthChip === "ok" ? "all" : "ok")}
          className={`${CHIP_BASE} ${
            activeHealthChip === "ok"
              ? "bg-emerald-950/60 text-emerald-300 border-emerald-500"
              : "bg-[#0c0e14] border-[#1c1f2b] text-emerald-400 hover:border-emerald-700/60"
          }`}
          title="Click to filter verified operational models"
        >
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>{pingStats.ok} Operational</span>
        </button>

        {pingStats.rateLimited > 0 && (
          <button
            type="button"
            onClick={() => onSelectHealthChip(activeHealthChip === "429" ? "all" : "429")}
            className={`${CHIP_BASE} ${
              activeHealthChip === "429"
                ? "bg-amber-950/60 text-amber-300 border-amber-500"
                : "bg-[#0c0e14] border-[#1c1f2b] text-amber-400 hover:border-amber-700/60"
            }`}
            title="Click to filter rate-limited models (429)"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>{pingStats.rateLimited} Rate Limited (429)</span>
          </button>
        )}

        {pingStats.error > 0 && (
          <button
            type="button"
            onClick={() => onSelectHealthChip(activeHealthChip === "error" ? "all" : "error")}
            className={`${CHIP_BASE} ${
              activeHealthChip === "error"
                ? "bg-rose-950/60 text-rose-300 border-rose-500"
                : "bg-[#0c0e14] border-[#1c1f2b] text-rose-400 hover:border-rose-700/60"
            }`}
            title="Click to filter offline or failing models"
          >
            <XCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{pingStats.error} Offline / Failed</span>
          </button>
        )}

        {pingStats.probing > 0 && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[#60a5fa] font-mono text-[11px]">
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            <span>
              {pingProgress && pingProgress.total > 0
                ? `Pinging ${pingProgress.current}/${pingProgress.total}`
                : `${pingStats.probing} pinging...`}
            </span>
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {onClearPings && (
          <button
            type="button"
            onClick={() => {
              onSelectHealthChip("all");
              onClearPings();
            }}
            className="inline-flex items-center gap-1 text-[11px] text-[#71717a] hover:text-white cursor-pointer transition"
            title="Reset ping results"
          >
            <RotateCcw className="h-3 w-3 shrink-0" />
            <span>Reset results</span>
          </button>
        )}
      </div>
    </div>
  );
}
