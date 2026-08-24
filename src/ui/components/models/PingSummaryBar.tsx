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

export function PingSummaryBar({
  pingStats,
  activeHealthChip,
  onSelectHealthChip,
  pingProgress,
  onClearPings,
}: PingSummaryBarProps) {
  if (pingStats.total === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5 px-3 sm:px-4 py-2.5 bg-[#16161a] border border-[#23232a] rounded-xl text-xs shadow-xs animate-in fade-in">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-[#8b8b96] uppercase tracking-wider text-[10px] sm:text-[11px] mr-1">
          Ping Filter:
        </span>

        {/* Filter: All */}
        <button
          type="button"
          onClick={() => onSelectHealthChip("all")}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
            activeHealthChip === "all"
              ? "bg-[#2b64e0] text-white"
              : "bg-[#202028] text-[#a1a1aa] hover:text-white"
          }`}
        >
          All ({pingStats.total})
        </button>

        {/* Filter: OK */}
        <button
          type="button"
          onClick={() => onSelectHealthChip(activeHealthChip === "ok" ? "all" : "ok")}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition border cursor-pointer ${
            activeHealthChip === "ok"
              ? "bg-emerald-950/90 text-emerald-300 border-emerald-500 shadow-xs"
              : "bg-[#121215] border-[#262630] text-emerald-400 hover:border-emerald-700/60"
          }`}
          title="Click to filter verified operational models"
        >
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>{pingStats.ok} Operational</span>
        </button>

        {/* Filter: 429 */}
        {pingStats.rateLimited > 0 && (
          <button
            type="button"
            onClick={() => onSelectHealthChip(activeHealthChip === "429" ? "all" : "429")}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition border cursor-pointer ${
              activeHealthChip === "429"
                ? "bg-amber-950/90 text-amber-300 border-amber-500 shadow-xs"
                : "bg-[#121215] border-[#262630] text-amber-400 hover:border-amber-700/60"
            }`}
            title="Click to filter 429 rate-limited models"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>{pingStats.rateLimited} Rate Limited (429)</span>
          </button>
        )}

        {/* Filter: Error */}
        {pingStats.error > 0 && (
          <button
            type="button"
            onClick={() => onSelectHealthChip(activeHealthChip === "error" ? "all" : "error")}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition border cursor-pointer ${
              activeHealthChip === "error"
                ? "bg-rose-950/90 text-rose-300 border-rose-500 shadow-xs"
                : "bg-[#121215] border-[#262630] text-rose-400 hover:border-rose-700/60"
            }`}
            title="Click to filter offline or failing models"
          >
            <XCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{pingStats.error} Offline / Failed</span>
          </button>
        )}

        {/* Probing state */}
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
