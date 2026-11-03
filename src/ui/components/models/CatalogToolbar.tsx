import {
  Search,
  Filter,
  RotateCcw,
  ChevronDown,
  X,
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
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-3 bg-[#10121a] border border-[#1c1f2b] rounded-lg p-2.5 sm:p-3 shadow-xs">
      {/* Search */}
      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#71717a] shrink-0" />
        <input
          type="text"
          value={searchQuery}
          onInput={(e) => onSearchChange((e.target as HTMLInputElement).value)}
          placeholder="Search by model name or provider..."
          className="w-full pl-9 pr-8 py-2 bg-[#0c0e14] border border-[#1c1f2b] rounded-md text-xs text-white placeholder-[#64748b] focus:outline-none focus:border-[#2563eb] transition"
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
        <div className="relative flex-1 sm:flex-initial min-w-0 sm:min-w-30">
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
            className="min-h-9.5 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-950/70 hover:bg-rose-900/80 active:bg-rose-950 border border-rose-700/60 text-xs font-medium text-rose-200 hover:text-white transition cursor-pointer shadow-xs animate-pulse shrink-0"
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
            className="min-h-9.5 flex items-center justify-center px-3 py-1.5 rounded-md bg-[#131620] hover:bg-[#1a1e2b] border border-[#1c1f2b] text-xs font-medium text-[#d4d4d8] hover:text-white transition disabled:opacity-50 cursor-pointer shrink-0"
            title="Ping live latency and status for visible models"
          >
            <span className="whitespace-nowrap">Ping All</span>
          </button>
        )}

        {/* Refresh Button */}
        <button
          type="button"
          onClick={onRefreshCatalog}
          disabled={refreshing}
          className="min-h-9.5 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-[#2563eb] hover:bg-[#1d4ed8] active:bg-[#1e40af] text-xs font-medium text-white transition shadow-xs disabled:opacity-50 cursor-pointer shrink-0"
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
        className="w-full sm:w-auto min-h-9.5 appearance-none bg-[#0c0e14] hover:bg-[#131620] border border-[#1c1f2b] hover:border-[#2e3447] rounded-md pl-8 pr-7 py-1.5 text-xs font-medium text-[#d4d4d8] transition cursor-pointer"
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
  const chips = [
    { id: "all", label: `All (${totalModelsCount})`, title: "All models" },
    { id: "reasoning", label: "Reasoning", title: "Step-by-step thinking models" },
    { id: "fast", label: "Fast", title: "Fast models without reasoning delay" },
    { id: "megacontext", label: "≥ 256k", title: "Large context window (≥ 256k)" },
    { id: "vision", label: "Vision", title: "Multimodal image input" },
  ] as const;

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 text-xs">
      <span className="text-xs font-medium text-[#8b8b96] shrink-0 mr-1">
        Capability:
      </span>
      {chips.map((chip) => {
        const isActive = capabilityFilter === chip.id;
        return (
          <button
            key={chip.id}
            type="button"
            onClick={() => onSelectCapability(chip.id === "all" ? "all" : isActive ? "all" : chip.id)}
            title={chip.title}
            className={`
              shrink-0 px-2.5 py-1 rounded-md text-xs font-medium transition cursor-pointer
              ${
                isActive
                  ? "bg-[#2563eb] text-white shadow-xs"
                  : "bg-[#18181f] text-[#a1a1aa] hover:text-white hover:bg-[#202028] border border-[#272732]"
              }
            `}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
