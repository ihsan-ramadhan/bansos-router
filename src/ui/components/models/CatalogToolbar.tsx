import {
  Search,
  Filter,
  Zap,
  RotateCcw,
  ChevronDown,
  X,
  Layers,
  Sparkles,
} from "lucide-preact";
import type { CapabilityFilter } from "../../utils/models";
import { formatProviderLabel } from "../../utils/models";

interface CatalogToolbarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedProvider: string;
  onSelectProvider: (p: string) => void;
  providers: string[];
  totalModelsCount: number;
  models: Array<{ source?: string; owned_by?: string }>;
  isPingingAll: boolean;
  pingProgress?: { current: number; total: number };
  onCancelPing?: () => void;
  onPingAll: () => void;
  filteredCount: number;
  refreshing: boolean;
  onRefreshCatalog: () => void;
}

export function CatalogToolbar({
  searchQuery,
  onSearchChange,
  selectedProvider,
  onSelectProvider,
  providers,
  totalModelsCount,
  models,
  isPingingAll,
  pingProgress,
  onCancelPing,
  onPingAll,
  filteredCount,
  refreshing,
  onRefreshCatalog,
}: CatalogToolbarProps) {
  return (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-3 bg-[#16161a] border border-[#23232a] rounded-xl p-3 sm:p-3.5 shadow-xs">
      {/* Search */}
      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#71717a] shrink-0" />
        <input
          type="text"
          value={searchQuery}
          onInput={(e) => onSearchChange((e.target as HTMLInputElement).value)}
          placeholder="Search by model name or provider..."
          className="w-full pl-9 pr-8 py-2 bg-[#121215] border border-[#262630] rounded-lg text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-[#2b64e0] transition"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-[#71717a] hover:text-rose-400 hover:bg-rose-950/40 cursor-pointer transition flex items-center justify-center"
            title="Clear search"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 w-full sm:w-auto">
        {/* Provider dropdown select (native styling / simple dropdown) */}
        <div className="relative flex-1 sm:flex-initial min-w-0 sm:min-w-[120px]">
          <ProviderDropdown
            selectedProvider={selectedProvider}
            onSelectProvider={onSelectProvider}
            providers={providers}
            totalModelsCount={totalModelsCount}
            models={models}
          />
        </div>

        {/* Ping All / Cancel Ping Button */}
        {isPingingAll ? (
          <button
            type="button"
            onClick={onCancelPing}
            className="min-h-[38px] flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-950/70 hover:bg-rose-900/80 active:bg-rose-950 border border-rose-700/60 text-xs font-medium text-rose-200 hover:text-white transition cursor-pointer shadow-xs animate-pulse shrink-0"
            title="Click to cancel active ping sequence"
          >
            <X className="h-3.5 w-3.5 text-rose-400 shrink-0" />
            <span className="whitespace-nowrap">
              {pingProgress && pingProgress.total > 0
                ? `Cancel (${pingProgress.current}/${pingProgress.total})`
                : "Cancel"}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onPingAll}
            disabled={filteredCount === 0}
            className="min-h-[38px] flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#202028] hover:bg-[#282834] active:bg-[#1a1a20] border border-[#2c2c36] text-xs font-medium text-white transition disabled:opacity-50 cursor-pointer shrink-0"
            title="Ping live latency and status for visible models"
          >
            <Zap className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <span className="whitespace-nowrap">Ping All</span>
          </button>
        )}

        {/* Refresh Button */}
        <button
          type="button"
          onClick={onRefreshCatalog}
          disabled={refreshing}
          className="min-h-[38px] flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2b64e0] hover:bg-[#3872ee] active:bg-[#2353be] text-xs font-medium text-white transition shadow-xs disabled:opacity-50 cursor-pointer shrink-0"
          title="Refresh models from upstream providers"
        >
          <RotateCcw className={`h-3.5 w-3.5 shrink-0 ${refreshing ? "animate-spin" : ""}`} />
          <span className="whitespace-nowrap">{refreshing ? "Refreshing..." : "Refresh"}</span>
        </button>
      </div>
    </div>
  );
}

function ProviderDropdown({
  selectedProvider,
  onSelectProvider,
  providers,
  totalModelsCount,
  models,
}: {
  selectedProvider: string;
  onSelectProvider: (p: string) => void;
  providers: string[];
  totalModelsCount: number;
  models: Array<{ source?: string; owned_by?: string }>;
}) {
  return (
    <div className="relative">
      <select
        value={selectedProvider}
        onChange={(e) => onSelectProvider((e.target as HTMLSelectElement).value)}
        className="w-full sm:w-auto min-h-[38px] appearance-none bg-[#121215] hover:bg-[#18181d] border border-[#262630] hover:border-[#383846] rounded-lg pl-8 pr-7 py-1.5 text-xs font-medium text-[#d4d4d8] transition cursor-pointer"
        aria-label="Filter by provider"
      >
        <option value="all">All Providers ({totalModelsCount})</option>
        {providers.map((p) => {
          const count = models.filter(
            (m) => (m.source || m.owned_by || "").toLowerCase() === p.toLowerCase()
          ).length;
          return (
            <option key={p} value={p}>
              {formatProviderLabel(p)} ({count})
            </option>
          );
        })}
      </select>
      <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#71717a] pointer-events-none" />
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#71717a] pointer-events-none" />
    </div>
  );
}

interface CapabilityFilterChipsProps {
  capabilityFilter: CapabilityFilter;
  onSelectCapability: (cap: CapabilityFilter) => void;
  totalModelsCount: number;
}

export function CapabilityFilterChips({
  capabilityFilter,
  onSelectCapability,
  totalModelsCount,
}: CapabilityFilterChipsProps) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5 px-0.5 text-xs">
      <span className="text-[10px] sm:text-[11px] font-semibold text-[#8b8b96] uppercase tracking-wider shrink-0 mr-0.5">
        Capability:
      </span>
      <button
        type="button"
        onClick={() => onSelectCapability("all")}
        className={`shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
          capabilityFilter === "all"
            ? "bg-[#2b64e0] text-white"
            : "bg-[#18181f] text-[#a1a1aa] hover:text-white border border-[#262630]"
        }`}
      >
        All Models ({totalModelsCount})
      </button>

      <button
        type="button"
        onClick={() => onSelectCapability(capabilityFilter === "reasoning" ? "all" : "reasoning")}
        className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition border cursor-pointer ${
          capabilityFilter === "reasoning"
            ? "bg-emerald-950/90 text-emerald-300 border-emerald-500 shadow-xs"
            : "bg-[#18181f] border-[#262630] text-emerald-400 hover:border-emerald-700/60"
        }`}
        title="Filter models capable of step-by-step reasoning / thinking"
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0" />
        <span>Reasoning / Think</span>
      </button>

      <button
        type="button"
        onClick={() => onSelectCapability(capabilityFilter === "fast" ? "all" : "fast")}
        className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition border cursor-pointer ${
          capabilityFilter === "fast"
            ? "bg-blue-950/90 text-blue-300 border-blue-500 shadow-xs"
            : "bg-[#18181f] border-[#262630] text-blue-400 hover:border-blue-700/60"
        }`}
        title="Filter fast models for quick completions without reasoning delay"
      >
        <Zap className="h-3.5 w-3.5 shrink-0" />
        <span>Fast (Non-thinking)</span>
      </button>

      <button
        type="button"
        onClick={() => onSelectCapability(capabilityFilter === "megacontext" ? "all" : "megacontext")}
        className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition border cursor-pointer ${
          capabilityFilter === "megacontext"
            ? "bg-purple-950/90 text-purple-300 border-purple-500 shadow-xs"
            : "bg-[#18181f] border-[#262630] text-purple-400 hover:border-purple-700/60"
        }`}
        title="Filter models with ≥ 256k context window for large codebase indexing"
      >
        <Layers className="h-3.5 w-3.5 shrink-0" />
        <span>Large Context (≥ 256k)</span>
      </button>
    </div>
  );
}
