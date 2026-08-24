import { useState, useMemo } from "preact/hooks";
import type { ModelItem, PingResult } from "../types/ui";
import {
  Search,
  Filter,
  Zap,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  RefreshCw,
  Sparkles,
  RotateCcw,
  Copy,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  X,
  Layers,
} from "lucide-preact";

function formatTokens(tokens?: number): string {
  if (!tokens) return "-";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

function formatProviderLabel(provider: string): string {
  switch (provider.toLowerCase()) {
    case "zen":
      return "OpenCode Zen";
    case "kilo":
      return "KiloCode";
    case "llm7":
      return "LLM7";
    default:
      return provider.toUpperCase();
  }
}

function getProviderBadgeColor(provider: string): string {
  switch (provider.toLowerCase()) {
    case "opencode":
    case "zen":
      return "bg-blue-950/70 text-blue-300 border-blue-800/60";
    case "kilo":
    case "kilocode":
      return "bg-purple-950/70 text-purple-300 border-purple-800/60";
    case "llm7":
      return "bg-emerald-950/70 text-emerald-300 border-emerald-800/60";
    default:
      return "bg-zinc-800/70 text-zinc-300 border-zinc-700/60";
  }
}

function getSortIcon(currentField: string, activeField: string, asc: boolean) {
  if (currentField !== activeField) {
    return <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100 transition-opacity" />;
  }
  return asc ? <ArrowUp className="h-3 w-3 text-[#3b82f6]" /> : <ArrowDown className="h-3 w-3 text-[#3b82f6]" />;
}

function ModelPingStatusCell({ ping }: { ping?: PingResult }) {
  if (!ping || ping.status === "idle") {
    return <span className="text-[11px] text-[#52525b] font-mono">Untested</span>;
  }
  if (ping.status === "pinging") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[#60a5fa] font-mono">
        <Loader2 className="h-3 w-3 animate-spin shrink-0" />
        <span>Pinging...</span>
      </span>
    );
  }
  if (ping.status === "ok") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-mono text-emerald-400 font-medium">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <span>{ping.latencyMs}ms</span>
      </span>
    );
  }
  if (ping.status === "rate_limited") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-mono text-amber-400 font-medium">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span>429 ({ping.latencyMs}ms)</span>
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-mono text-rose-400 font-medium"
      title={ping.error || "Ping failed"}
    >
      <XCircle className="h-3.5 w-3.5 shrink-0" />
      <span>Offline {ping.statusCode ? `(${ping.statusCode})` : ""}</span>
    </span>
  );
}

interface ModelCatalogRowProps {
  model: ModelItem;
  ping?: PingResult;
  copiedId: string | null;
  onCopy: (id: string) => void;
  onPingModel: (model: ModelItem) => Promise<void>;
}

function ModelCatalogRow({ model, ping, copiedId, onCopy, onPingModel }: ModelCatalogRowProps) {
  const contextLimit = model.context_window || model.context_length;
  const outputLimit = model.max_tokens || model.maxTokens;
  const provider = model.source || model.owned_by;
  const showBadge = provider && provider.toLowerCase() !== "bansos";
  const isPinging = ping?.status === "pinging";

  return (
    <tr className="hover:bg-[#1a1a20] transition-colors duration-150 group">
      {/* Model info */}
      <td className="py-3 px-3 sm:px-4">
        <div className="flex flex-col gap-1 min-w-[160px] sm:min-w-[200px]">
          <div className="flex items-center gap-2">
            <span className="font-mono font-medium text-white text-xs sm:text-[13px] group-hover:text-[#60a5fa] transition">
              {model.id}
            </span>
            <button
              type="button"
              onClick={() => onCopy(model.id)}
              className="p-1 rounded text-[#71717a] hover:text-white hover:bg-[#23232b] active:scale-90 transition cursor-pointer shrink-0"
              title={copiedId === model.id ? "Copied!" : "Copy model ID"}
              aria-label={`Copy model ID ${model.id}`}
            >
              {copiedId === model.id ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
            {showBadge && (
              <span
                className={`text-[9px] sm:text-[10px] px-1.5 sm:px-2 py-0.2 sm:py-0.5 rounded-full border font-medium uppercase tracking-wider shrink-0 ${getProviderBadgeColor(
                  provider
                )}`}
              >
                {provider}
              </span>
            )}
          </div>
          {model.name && model.name !== model.id && (
            <span className="text-[10px] sm:text-[11px] text-[#71717a] truncate">{model.name}</span>
          )}
        </div>
      </td>

      {/* Reasoning */}
      <td className="py-3 px-3 sm:px-4 whitespace-nowrap">
        {model.reasoning ? (
          <span className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-medium text-emerald-400 bg-emerald-950/60 border border-emerald-800/50 px-2 py-0.5 rounded-md">
            <Sparkles className="h-3 w-3 shrink-0" /> Yes
          </span>
        ) : (
          <span className="text-[#52525c] text-[11px] font-mono">-</span>
        )}
      </td>

      {/* Context */}
      <td className="py-3 px-3 sm:px-4 whitespace-nowrap">
        <span className="font-mono text-xs text-[#d4d4d8]">{formatTokens(contextLimit)}</span>
      </td>

      {/* Max output */}
      <td className="py-3 px-3 sm:px-4 whitespace-nowrap">
        <span className="font-mono text-xs text-[#a1a1aa]">{formatTokens(outputLimit)}</span>
      </td>

      {/* Latency status */}
      <td className="py-3 px-3 sm:px-4 whitespace-nowrap">
        <ModelPingStatusCell ping={ping} />
      </td>

      {/* Action */}
      <td className="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
        <button
          type="button"
          onClick={() => onPingModel(model)}
          disabled={isPinging}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#202026] hover:bg-[#282832] active:bg-[#1a1a20] border border-[#2a2a34] hover:border-[#383846] text-[11px] font-medium text-[#d4d4d8] hover:text-white transition cursor-pointer disabled:opacity-50"
          title={`Ping live response from ${model.id}`}
        >
          {isPinging ? (
            <Loader2 className="h-3 w-3 animate-spin text-[#3b82f6] shrink-0" />
          ) : (
            <Zap className="h-3 w-3 text-amber-400 shrink-0" />
          )}
          <span>Ping</span>
        </button>
      </td>
    </tr>
  );
}

function matchesFilters(
  m: ModelItem,
  searchQuery: string,
  selectedProvider: string,
  activeHealthChip: "all" | "ok" | "429" | "error",
  capabilityFilter: "all" | "reasoning" | "fast" | "megacontext",
  pingResults: Record<string, PingResult>
): boolean {
  const provider = m.source || m.owned_by || "";
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    const matchesId = m.id.toLowerCase().includes(q);
    const matchesName = m.name?.toLowerCase().includes(q);
    const matchesProvider = provider.toLowerCase().includes(q);
    if (!matchesId && !matchesName && !matchesProvider) return false;
  }
  if (selectedProvider !== "all" && provider.toLowerCase() !== selectedProvider.toLowerCase()) {
    return false;
  }
  if (capabilityFilter === "reasoning" && !m.reasoning) return false;
  if (capabilityFilter === "fast" && m.reasoning) return false;
  const ctx = m.context_window || m.context_length || 0;
  if (capabilityFilter === "megacontext" && ctx < 256000) return false;

  const ping = pingResults[m.id];
  if (activeHealthChip === "ok" && ping?.status !== "ok") return false;
  if (activeHealthChip === "429" && ping?.status !== "rate_limited") return false;
  if (activeHealthChip === "error" && ping?.status !== "error") return false;
  return true;
}

function compareByField(
  a: ModelItem,
  b: ModelItem,
  sortField: "model" | "reasoning" | "context" | "maxOutput" | "latency",
  sortAsc: boolean,
  pingResults: Record<string, PingResult>
): number {
  const dir = sortAsc ? 1 : -1;
  if (sortField === "model") return dir * a.id.localeCompare(b.id);
  if (sortField === "reasoning") {
    return dir * ((b.reasoning ? 1 : 0) - (a.reasoning ? 1 : 0));
  }
  if (sortField === "context") {
    return dir * ((b.context_window || b.context_length || 0) - (a.context_window || a.context_length || 0));
  }
  if (sortField === "maxOutput") {
    return dir * ((b.max_tokens || b.maxTokens || 0) - (a.max_tokens || a.maxTokens || 0));
  }
  const pingA = pingResults[a.id];
  const pingB = pingResults[b.id];
  const latA = pingA?.status === "ok" && typeof pingA.latencyMs === "number" ? pingA.latencyMs : Infinity;
  const latB = pingB?.status === "ok" && typeof pingB.latencyMs === "number" ? pingB.latencyMs : Infinity;
  return dir * (latA - latB);
}

function filterAndSortModels(
  models: ModelItem[],
  searchQuery: string,
  selectedProvider: string,
  activeHealthChip: "all" | "ok" | "429" | "error",
  capabilityFilter: "all" | "reasoning" | "fast" | "megacontext",
  sortField: "default" | "model" | "reasoning" | "context" | "maxOutput" | "latency",
  sortAsc: boolean,
  pingResults: Record<string, PingResult>
): ModelItem[] {
  const list = models.filter((m) =>
    matchesFilters(m, searchQuery, selectedProvider, activeHealthChip, capabilityFilter, pingResults)
  );

  if (sortField !== "default") {
    list.sort((a, b) => compareByField(a, b, sortField, sortAsc, pingResults));
  }

  return list;
}

interface ModelCatalogProps {
  models: ModelItem[];
  loading: boolean;
  onRefreshCatalog: () => void;
  refreshing: boolean;
  pingResults: Record<string, PingResult>;
  isPingingAll: boolean;
  pingProgress?: { current: number; total: number };
  onPingModel: (model: ModelItem) => Promise<void>;
  onPingAll: (models: ModelItem[]) => Promise<void>;
  onCancelPing?: () => void;
  onClearPings?: () => void;
}

interface ModelCardProps {
  model: ModelItem;
  ping?: PingResult;
  copiedId: string | null;
  onCopy: (id: string) => void;
  onPingModel: (model: ModelItem) => Promise<void>;
}

function ModelCard({ model, ping, copiedId, onCopy, onPingModel }: ModelCardProps) {
  const contextLimit = model.context_window || model.context_length;
  const outputLimit = model.max_tokens || model.maxTokens;
  const provider = model.source || model.owned_by;
  const showBadge = provider && provider.toLowerCase() !== "bansos";
  const isPinging = ping?.status === "pinging";

  return (
    <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-2.5 sm:p-3 transition-colors hover:border-[#2e2e38] flex flex-col gap-2 shadow-xs">
      {/* Top row: Model ID, Copy, Provider & Capability Badges */}
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="font-mono font-semibold text-white text-xs sm:text-[13px] truncate" title={model.id}>
            {model.id}
          </span>
          <button
            type="button"
            onClick={() => onCopy(model.id)}
            className="p-1 rounded text-[#71717a] hover:text-white hover:bg-[#23232b] active:scale-90 transition cursor-pointer shrink-0"
            title={copiedId === model.id ? "Copied!" : "Copy model ID"}
            aria-label={`Copy model ID ${model.id}`}
          >
            {copiedId === model.id ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {showBadge && (
            <span
              className={`text-[9px] px-1.5 py-0.2 rounded-full border font-medium uppercase tracking-wider shrink-0 ${getProviderBadgeColor(
                provider
              )}`}
            >
              {provider}
            </span>
          )}
          {model.reasoning && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-medium text-emerald-400 bg-emerald-950/60 border border-emerald-800/50 px-1.5 py-0.2 rounded-md shrink-0">
              <Sparkles className="h-2.5 w-2.5 shrink-0" /> Think
            </span>
          )}
        </div>
      </div>

      {/* Optional Name */}
      {model.name && model.name !== model.id && (
        <p className="text-[11px] text-[#71717a] truncate -mt-1" title={model.name}>
          {model.name}
        </p>
      )}

      {/* Bottom row: Meta Specs (Ctx & Max) + Ping status & action */}
      <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-[#1f1f26]">
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-[#9393a0] truncate">
          <span><span className="text-[#60606b]">Ctx:</span> <strong className="font-medium text-[#d4d4d8]">{formatTokens(contextLimit)}</strong></span>
          <span className="text-[#3f3f46]">•</span>
          <span><span className="text-[#60606b]">Max:</span> <strong className="font-medium text-[#a1a1aa]">{formatTokens(outputLimit)}</strong></span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <ModelPingStatusCell ping={ping} />
          <button
            type="button"
            onClick={() => onPingModel(model)}
            disabled={isPinging}
            className="min-h-[28px] inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-[#202026] hover:bg-[#282832] active:bg-[#1a1a20] border border-[#2a2a34] text-[11px] font-medium text-[#d4d4d8] hover:text-white transition cursor-pointer disabled:opacity-50 shrink-0"
            title={`Ping live response from ${model.id}`}
          >
            {isPinging ? (
              <Loader2 className="h-3 w-3 animate-spin text-[#3b82f6] shrink-0" />
            ) : (
              <Zap className="h-3 w-3 text-amber-400 shrink-0" />
            )}
            <span>Ping</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function ModelCatalog({
  models,
  loading,
  onRefreshCatalog,
  refreshing,
  pingResults,
  isPingingAll,
  pingProgress,
  onPingModel,
  onPingAll,
  onCancelPing,
  onClearPings,
}: ModelCatalogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string>("all");
  const [activeHealthChip, setActiveHealthChip] = useState<"all" | "ok" | "429" | "error">("all");
  const [capabilityFilter, setCapabilityFilter] = useState<"all" | "reasoning" | "fast" | "megacontext">("all");
  const [sortField, setSortField] = useState<"default" | "model" | "reasoning" | "context" | "maxOutput" | "latency">("default");
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [providerDropdownOpen, setProviderDropdownOpen] = useState<boolean>(false);
  const [pageSizeDropdownOpen, setPageSizeDropdownOpen] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  async function handleCopy(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => {
        setCopiedId((curr) => (curr === id ? null : curr));
      }, 2000);
    } catch {
      // Clipboard write failed (e.g. permission denied or unfocused document)
    }
  }

  const providers = useMemo(() => {
    const list = new Set<string>();
    for (const m of models) {
      const p = m.source || m.owned_by;
      if (p && p.toLowerCase() !== "bansos") list.add(p);
    }
    return Array.from(list);
  }, [models]);

  const filteredModels = useMemo(() => {
    return filterAndSortModels(
      models,
      searchQuery,
      selectedProvider,
      activeHealthChip,
      capabilityFilter,
      sortField,
      sortAsc,
      pingResults
    );
  }, [models, searchQuery, selectedProvider, activeHealthChip, capabilityFilter, sortField, sortAsc, pingResults]);

  function handleSort(field: "model" | "reasoning" | "context" | "maxOutput" | "latency") {
    if (sortField === field) {
      if (!sortAsc) {
        setSortField("default");
        setSortAsc(true);
      } else {
        setSortAsc(false);
      }
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  }

  function renderTableBody() {
    if (loading) {
      return (
        <tr>
          <td colSpan={6} className="py-12 text-center text-[#71717a]">
            <div className="flex flex-col items-center justify-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-[#3b82f6]" />
              <span>Loading models...</span>
            </div>
          </td>
        </tr>
      );
    }
    if (models.length === 0) {
      return (
        <tr>
          <td colSpan={6} className="py-12 text-center text-[#71717a]">
            <div className="flex flex-col items-center justify-center gap-2.5 max-w-sm mx-auto px-4">
              <Zap className="h-7 w-7 text-amber-400/80" />
              <span className="text-white font-medium text-sm">No models available</span>
              <span className="text-xs text-[#71717a] leading-relaxed">
                The daemon hasn't fetched models from upstream providers yet or needs a refresh.
              </span>
              <button
                type="button"
                onClick={onRefreshCatalog}
                disabled={refreshing}
                className="mt-1 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#2b64e0] hover:bg-[#3872ee] text-xs font-semibold text-white transition shadow-xs cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                <span>{refreshing ? "Refreshing..." : "Refresh Models"}</span>
              </button>
            </div>
          </td>
        </tr>
      );
    }
    if (filteredModels.length === 0) {
      return (
        <tr>
          <td colSpan={6} className="py-12 text-center text-[#71717a]">
            <div className="flex flex-col items-center justify-center gap-2.5 max-w-sm mx-auto px-4">
              <Search className="h-6 w-6 text-[#52525b]" />
              <span className="text-white font-medium">No matching models found</span>
              <span className="text-xs text-[#71717a]">
                No models matched your search or active filters.
              </span>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setSelectedProvider("all");
                  setActiveHealthChip("all");
                  setCapabilityFilter("all");
                  setCurrentPage(1);
                }}
                className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#202028] hover:bg-[#282834] border border-[#2c2c36] text-xs font-medium text-[#d4d4d8] hover:text-white transition cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Reset filters</span>
              </button>
            </div>
          </td>
        </tr>
      );
    }
    return paginatedModels.map((model) => (
      <ModelCatalogRow
        key={model.id}
        model={model}
        ping={pingResults[model.id]}
        copiedId={copiedId}
        onCopy={handleCopy}
        onPingModel={onPingModel}
      />
    ));
  }

  const totalPages = Math.max(1, Math.ceil(filteredModels.length / pageSize));
  const activePage = Math.min(currentPage, totalPages);

  const paginatedModels = useMemo(() => {
    const start = (activePage - 1) * pageSize;
    return filteredModels.slice(start, start + pageSize);
  }, [filteredModels, activePage, pageSize]);

  const pingStats = useMemo(() => {
    const entries = Object.values(pingResults);
    const ok = entries.filter((r) => r.status === "ok").length;
    const rateLimited = entries.filter((r) => r.status === "rate_limited").length;
    const error = entries.filter((r) => r.status === "error").length;
    const probing = entries.filter((r) => r.status === "pinging").length;
    return { total: entries.length, ok, rateLimited, error, probing };
  }, [pingResults]);

  return (
    <div className="space-y-4">
      {/* Controls & filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-3 bg-[#16161a] border border-[#23232a] rounded-xl p-3 sm:p-3.5 shadow-xs">
        {/* Search */}
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#71717a] shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onInput={(e) => {
              setSearchQuery((e.target as HTMLInputElement).value);
              setCurrentPage(1);
            }}
            placeholder="Search by model name or provider..."
            className="w-full pl-9 pr-8 py-2 bg-[#121215] border border-[#262630] rounded-lg text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-[#2b64e0] transition"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setCurrentPage(1);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-[#71717a] hover:text-rose-400 hover:bg-rose-950/40 cursor-pointer transition flex items-center justify-center"
              title="Clear search"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 w-full sm:w-auto">
          {/* Provider dropdown */}
          <div className="relative flex-1 sm:flex-initial min-w-0 sm:min-w-[120px]">
            <button
              type="button"
              onClick={() => {
                setProviderDropdownOpen(!providerDropdownOpen);
                setPageSizeDropdownOpen(false);
              }}
              className="w-full sm:w-auto min-h-[38px] flex items-center justify-between gap-1.5 sm:gap-2 bg-[#121215] hover:bg-[#18181d] border border-[#262630] hover:border-[#383846] rounded-lg px-2.5 sm:px-3 py-1.5 text-xs font-medium text-[#d4d4d8] transition cursor-pointer"
            >
              <div className="flex items-center gap-1.5 truncate">
                <Filter className="h-3.5 w-3.5 text-[#71717a] shrink-0" />
                <span className="truncate">
                  {selectedProvider === "all"
                    ? `All Providers (${models.length})`
                    : formatProviderLabel(selectedProvider)}
                </span>
              </div>
              <ChevronDown className={`h-3 w-3 text-[#71717a] shrink-0 transition-transform duration-150 ${providerDropdownOpen ? "rotate-180" : ""}`} />
            </button>

            {providerDropdownOpen && (
              <>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="Close provider dropdown"
                  className="fixed inset-0 z-20 cursor-default bg-transparent border-0"
                  onClick={() => setProviderDropdownOpen(false)}
                />
                <div className="absolute right-0 sm:left-0 mt-1.5 w-52 rounded-xl bg-[#16161a] border border-[#282832] shadow-xl py-1 z-30 flex flex-col divide-y divide-[#202026]">
                  <div className="p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedProvider("all");
                        setCurrentPage(1);
                        setProviderDropdownOpen(false);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition flex items-center justify-between cursor-pointer ${
                        selectedProvider === "all"
                          ? "bg-[#2b64e0]/15 text-[#60a5fa] font-semibold"
                          : "text-[#d4d4d8] hover:bg-[#202028] hover:text-white"
                      }`}
                    >
                      <span>All Providers</span>
                      <span className="text-[11px] font-mono opacity-70">
                        {models.length}
                      </span>
                    </button>
                  </div>
                  <div className="p-1">
                    {providers.map((p) => {
                      const count = models.filter(
                        (m) => (m.source || m.owned_by || "").toLowerCase() === p.toLowerCase()
                      ).length;
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => {
                            setSelectedProvider(p);
                            setCurrentPage(1);
                            setProviderDropdownOpen(false);
                          }}
                          className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition flex items-center justify-between cursor-pointer ${
                            selectedProvider.toLowerCase() === p.toLowerCase()
                              ? "bg-[#2b64e0]/15 text-[#60a5fa] font-semibold"
                              : "text-[#d4d4d8] hover:bg-[#202028] hover:text-white"
                          }`}
                        >
                          <span>{formatProviderLabel(p)}</span>
                          <span className="text-[11px] font-mono opacity-70">
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
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
              onClick={() => onPingAll(filteredModels)}
              disabled={filteredModels.length === 0}
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
            <RefreshCw className={`h-3.5 w-3.5 shrink-0 ${refreshing ? "animate-spin" : ""}`} />
            <span className="whitespace-nowrap">{refreshing ? "Refreshing..." : "Refresh"}</span>
          </button>
        </div>
      </div>

      {/* Capability filter chips */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5 px-0.5 text-xs">
        <span className="text-[10px] sm:text-[11px] font-semibold text-[#8b8b96] uppercase tracking-wider shrink-0 mr-0.5">
          Capability:
        </span>
        <button
          type="button"
          onClick={() => {
            setCapabilityFilter("all");
            setCurrentPage(1);
          }}
          className={`shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
            capabilityFilter === "all"
              ? "bg-[#2b64e0] text-white"
              : "bg-[#18181f] text-[#a1a1aa] hover:text-white border border-[#262630]"
          }`}
        >
          All Models ({models.length})
        </button>

        <button
          type="button"
          onClick={() => {
            setCapabilityFilter(capabilityFilter === "reasoning" ? "all" : "reasoning");
            setCurrentPage(1);
          }}
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
          onClick={() => {
            setCapabilityFilter(capabilityFilter === "fast" ? "all" : "fast");
            setCurrentPage(1);
          }}
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
          onClick={() => {
            setCapabilityFilter(capabilityFilter === "megacontext" ? "all" : "megacontext");
            setCurrentPage(1);
          }}
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

      {/* Ping summary */}
      {pingStats.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-3 sm:px-4 py-2.5 bg-[#16161a] border border-[#23232a] rounded-xl text-xs shadow-xs animate-in fade-in">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-[#8b8b96] uppercase tracking-wider text-[10px] sm:text-[11px] mr-1">
              Ping Filter:
            </span>

            {/* Filter: All */}
            <button
              type="button"
              onClick={() => {
                setActiveHealthChip("all");
                setCurrentPage(1);
              }}
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
              onClick={() => {
                setActiveHealthChip(activeHealthChip === "ok" ? "all" : "ok");
                setCurrentPage(1);
              }}
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
                onClick={() => {
                  setActiveHealthChip(activeHealthChip === "429" ? "all" : "429");
                  setCurrentPage(1);
                }}
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
                onClick={() => {
                  setActiveHealthChip(activeHealthChip === "error" ? "all" : "error");
                  setCurrentPage(1);
                }}
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
                  setActiveHealthChip("all");
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
      )}

      {/* Model listing: Mobile cards (< md) vs Desktop table (>= md) */}
      <div className="rounded-xl border border-[#23232a] bg-[#16161a] overflow-hidden shadow-xs">
        {/* Mobile View: Cards Grid */}
        <div className="block md:hidden p-2.5 sm:p-3">
          {loading ? (
            <div className="py-12 text-center text-[#71717a] flex flex-col items-center justify-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-[#3b82f6]" />
              <span className="text-xs">Loading models...</span>
            </div>
          ) : models.length === 0 ? (
            <div className="py-10 text-center text-[#71717a] flex flex-col items-center justify-center gap-2 px-4">
              <Zap className="h-7 w-7 text-amber-400/80" />
              <span className="text-white font-medium text-sm">No models available</span>
              <span className="text-xs text-[#71717a] leading-relaxed">
                The daemon hasn't fetched models from upstream providers yet or needs a refresh.
              </span>
              <button
                type="button"
                onClick={onRefreshCatalog}
                disabled={refreshing}
                className="mt-1 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#2b64e0] hover:bg-[#3872ee] text-xs font-semibold text-white transition cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                <span>{refreshing ? "Refreshing..." : "Refresh Models"}</span>
              </button>
            </div>
          ) : filteredModels.length === 0 ? (
            <div className="py-10 text-center text-[#71717a] flex flex-col items-center justify-center gap-2 px-4">
              <Search className="h-6 w-6 text-[#52525b]" />
              <span className="text-white font-medium text-sm">No matching models</span>
              <span className="text-xs text-[#71717a]">
                No models matched your search or active filters.
              </span>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setSelectedProvider("all");
                  setActiveHealthChip("all");
                  setCapabilityFilter("all");
                  setCurrentPage(1);
                }}
                className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#202028] hover:bg-[#282834] border border-[#2c2c36] text-xs font-medium text-[#d4d4d8] hover:text-white transition cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Reset filters</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {paginatedModels.map((model) => (
                <ModelCard
                  key={model.id}
                  model={model}
                  ping={pingResults[model.id]}
                  copiedId={copiedId}
                  onCopy={handleCopy}
                  onPingModel={onPingModel}
                />
              ))}
            </div>
          )}
        </div>

        {/* Desktop View: Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead className="bg-[#121215] border-b border-[#23232a] text-[10px] sm:text-[11px] font-semibold text-[#8b8b96] uppercase tracking-wider select-none">
              <tr>
                {/* Model column */}
                <th
                  onClick={() => handleSort("model")}
                  className="py-3 px-3 sm:px-4 hover:text-white transition cursor-pointer group"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Model & Provider</span>
                    {getSortIcon("model", sortField, sortAsc)}
                  </div>
                </th>

                {/* Reasoning column */}
                <th
                  onClick={() => handleSort("reasoning")}
                  className="py-3 px-3 sm:px-4 hover:text-white transition cursor-pointer group"
                  title="Sort reasoning-enabled models"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Reasoning</span>
                    {getSortIcon("reasoning", sortField, sortAsc)}
                  </div>
                </th>

                {/* Context column */}
                <th
                  onClick={() => handleSort("context")}
                  className="py-3 px-3 sm:px-4 hover:text-white transition cursor-pointer group"
                  title="Sort by context limit"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Context</span>
                    {getSortIcon("context", sortField, sortAsc)}
                  </div>
                </th>

                {/* Max Output column */}
                <th
                  onClick={() => handleSort("maxOutput")}
                  className="py-3 px-3 sm:px-4 hover:text-white transition cursor-pointer group"
                  title="Sort by max generation output"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Max Output</span>
                    {getSortIcon("maxOutput", sortField, sortAsc)}
                  </div>
                </th>

                {/* Health / Latency column */}
                <th
                  onClick={() => handleSort("latency")}
                  className="py-3 px-3 sm:px-4 hover:text-white transition cursor-pointer group"
                  title="Sort by live latency"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Live Latency</span>
                    {pingStats.total === 0 ? (
                      <Zap className="h-3 w-3 text-amber-400/80 shrink-0" />
                    ) : (
                      getSortIcon("latency", sortField, sortAsc)
                    )}
                  </div>
                </th>

                <th className="py-3 px-3 sm:px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#202026] text-xs">
              {renderTableBody()}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="bg-[#121215] border-t border-[#23232a] px-3 sm:px-4 py-3 flex flex-col sm:flex-row items-center justify-between text-xs text-[#71717a] gap-3">
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 sm:gap-4 w-full sm:w-auto">
            <div className="text-center sm:text-left">
              Showing{" "}
              <span className="text-white font-medium">
                {filteredModels.length === 0
                  ? 0
                  : (activePage - 1) * pageSize + 1}
                {" – "}
                {Math.min(activePage * pageSize, filteredModels.length)}
              </span>{" "}
              of <span className="text-white font-medium">{filteredModels.length}</span> models
              {filteredModels.length !== models.length && (
                <span className="text-[#52525c] ml-1.5">
                  (filtered from {models.length})
                </span>
              )}
            </div>

            {/* Page size dropdown */}
            <div className="relative flex items-center gap-2 pl-3 sm:pl-3.5 border-l border-[#282832]">
              <span className="text-[11px] text-[#71717a]">Per page:</span>
              <button
                type="button"
                onClick={() => {
                  setPageSizeDropdownOpen(!pageSizeDropdownOpen);
                  setProviderDropdownOpen(false);
                }}
                className="flex items-center gap-1 bg-[#16161a] hover:bg-[#202028] border border-[#262630] rounded px-2 py-0.5 text-xs text-[#d4d4d8] hover:text-white transition cursor-pointer"
              >
                <span>{pageSize}</span>
                <ChevronDown className={`h-2.5 w-2.5 text-[#71717a] transition-transform duration-150 ${pageSizeDropdownOpen ? "rotate-180" : ""}`} />
              </button>

              {pageSizeDropdownOpen && (
                <>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Close page size dropdown"
                    className="fixed inset-0 z-20 cursor-default bg-transparent border-0"
                    onClick={() => setPageSizeDropdownOpen(false)}
                  />
                  <div className="absolute bottom-full mb-1.5 left-8 w-20 rounded-lg bg-[#16161a] border border-[#282832] shadow-xl p-1 z-30 flex flex-col">
                    {[5, 10, 20, 50].map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => {
                          setPageSize(size);
                          setCurrentPage(1);
                          setPageSizeDropdownOpen(false);
                        }}
                        className={`text-center px-2 py-1 rounded text-xs transition cursor-pointer ${
                          pageSize === size
                            ? "bg-[#2b64e0]/20 text-[#60a5fa] font-semibold"
                            : "text-[#d4d4d8] hover:bg-[#202028] hover:text-white"
                        }`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Page navigation */}
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCurrentPage(1)}
                disabled={activePage <= 1}
                className="p-1.5 rounded-md bg-[#16161a] hover:bg-[#202028] disabled:opacity-30 disabled:hover:bg-[#16161a] border border-[#262630] text-[#a1a1aa] hover:text-white transition cursor-pointer disabled:cursor-not-allowed"
                title="First Page"
                aria-label="First page"
              >
                <ChevronsLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={activePage <= 1}
                className="p-1.5 rounded-md bg-[#16161a] hover:bg-[#202028] disabled:opacity-30 disabled:hover:bg-[#16161a] border border-[#262630] text-[#a1a1aa] hover:text-white transition cursor-pointer disabled:cursor-not-allowed"
                title="Previous Page"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>

              <span className="px-2 text-xs font-mono text-[#d4d4d8] select-none">
                Page <span className="text-white font-medium">{activePage}</span> of{" "}
                <span className="text-white font-medium">{totalPages}</span>
              </span>

              <button
                type="button"
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={activePage >= totalPages}
                className="p-1.5 rounded-md bg-[#16161a] hover:bg-[#202028] disabled:opacity-30 disabled:hover:bg-[#16161a] border border-[#262630] text-[#a1a1aa] hover:text-white transition cursor-pointer disabled:cursor-not-allowed"
                title="Next Page"
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage(totalPages)}
                disabled={activePage >= totalPages}
                className="p-1.5 rounded-md bg-[#16161a] hover:bg-[#202028] disabled:opacity-30 disabled:hover:bg-[#16161a] border border-[#262630] text-[#a1a1aa] hover:text-white transition cursor-pointer disabled:cursor-not-allowed"
                title="Last Page"
                aria-label="Last page"
              >
                <ChevronsRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
