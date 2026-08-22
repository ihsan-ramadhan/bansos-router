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
  Activity,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Info,
} from "lucide-preact";

interface ModelCatalogProps {
  models: ModelItem[];
  loading: boolean;
  onRefreshCatalog: () => void;
  refreshing: boolean;
  pingResults: Record<string, PingResult>;
  isPingingAll: boolean;
  onPingModel: (modelId: string) => Promise<void>;
  onPingAll: (models: ModelItem[]) => Promise<void>;
  onClearPings?: () => void;
}

export function ModelCatalog({
  models,
  loading,
  onRefreshCatalog,
  refreshing,
  pingResults,
  isPingingAll,
  onPingModel,
  onPingAll,
  onClearPings,
}: ModelCatalogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string>("all");
  const [activeHealthChip, setActiveHealthChip] = useState<"all" | "ok" | "429" | "error">("all");
  const [sortField, setSortField] = useState<"default" | "model" | "reasoning" | "context" | "maxOutput" | "latency">("default");
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Custom Dropdown Open States
  const [providerDropdownOpen, setProviderDropdownOpen] = useState<boolean>(false);
  const [pageSizeDropdownOpen, setPageSizeDropdownOpen] = useState<boolean>(false);

  // Pagination states
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  // Copy model ID helper
  async function handleCopy(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => {
        setCopiedId((curr) => (curr === id ? null : curr));
      }, 2000);
    } catch {
      // fallback
    }
  }

  // Extract upstream providers from models
  const providers = useMemo(() => {
    const list = new Set<string>();
    for (const m of models) {
      const p = m.source || m.owned_by;
      if (p && p.toLowerCase() !== "bansos") list.add(p);
    }
    return Array.from(list);
  }, [models]);

  // Filtered and Sorted models
  const filteredModels = useMemo(() => {
    const list = models.filter((m) => {
      const provider = m.source || m.owned_by || "";
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesId = m.id.toLowerCase().includes(q);
        const matchesName = m.name?.toLowerCase().includes(q);
        const matchesProvider = provider.toLowerCase().includes(q);
        if (!matchesId && !matchesName && !matchesProvider) return false;
      }
      // Provider filter
      if (selectedProvider !== "all" && provider.toLowerCase() !== selectedProvider.toLowerCase()) {
        return false;
      }
      // Health filter via chips
      const ping = pingResults[m.id];
      if (activeHealthChip === "ok") {
        if (!ping || ping.status !== "ok") return false;
      } else if (activeHealthChip === "429") {
        if (!ping || ping.status !== "rate_limited") return false;
      } else if (activeHealthChip === "error") {
        if (!ping || ping.status !== "error") return false;
      }

      return true;
    });

    // Column Header Sorting
    if (sortField === "model") {
      list.sort((a, b) => (sortAsc ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id)));
    } else if (sortField === "reasoning") {
      list.sort((a, b) => {
        const valA = a.reasoning ? 1 : 0;
        const valB = b.reasoning ? 1 : 0;
        return sortAsc ? valB - valA : valA - valB;
      });
    } else if (sortField === "context") {
      list.sort((a, b) => {
        const valA = a.context_window || a.context_length || 0;
        const valB = b.context_window || b.context_length || 0;
        return sortAsc ? valB - valA : valA - valB;
      });
    } else if (sortField === "maxOutput") {
      list.sort((a, b) => {
        const valA = a.max_tokens || a.maxTokens || 0;
        const valB = b.max_tokens || b.maxTokens || 0;
        return sortAsc ? valB - valA : valA - valB;
      });
    } else if (sortField === "latency") {
      list.sort((a, b) => {
        const pingA = pingResults[a.id];
        const pingB = pingResults[b.id];
        const latA = pingA?.status === "ok" && typeof pingA.latencyMs === "number" ? pingA.latencyMs : Infinity;
        const latB = pingB?.status === "ok" && typeof pingB.latencyMs === "number" ? pingB.latencyMs : Infinity;
        return sortAsc ? latA - latB : latB - latA;
      });
    }

    return list;
  }, [models, searchQuery, selectedProvider, activeHealthChip, sortField, sortAsc, pingResults]);

  function handleSort(field: "model" | "reasoning" | "context" | "maxOutput" | "latency") {
    if (sortField === field) {
      if (!sortAsc) {
        // Reset to default sort
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

  // Reset to page 1 whenever filters/search change
  const totalPages = Math.max(1, Math.ceil(filteredModels.length / pageSize));
  const activePage = Math.min(currentPage, totalPages);

  const paginatedModels = useMemo(() => {
    const start = (activePage - 1) * pageSize;
    return filteredModels.slice(start, start + pageSize);
  }, [filteredModels, activePage, pageSize]);

  // Count reasoning models
  const reasoningCount = useMemo(() => {
    return models.filter((m) => m.reasoning).length;
  }, [models]);

  // Ping statistics
  const pingStats = useMemo(() => {
    const entries = Object.values(pingResults);
    const ok = entries.filter((r) => r.status === "ok").length;
    const rateLimited = entries.filter((r) => r.status === "rate_limited").length;
    const error = entries.filter((r) => r.status === "error").length;
    const probing = entries.filter((r) => r.status === "pinging").length;
    return { total: entries.length, ok, rateLimited, error, probing };
  }, [pingResults]);

  // Helper formatting context/output tokens
  function formatTokens(tokens?: number): string {
    if (!tokens) return "-";
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
    if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
    return String(tokens);
  }

  // Helper formatting provider label
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
    // Helper styling for provider badges
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

  return (
    <div className="space-y-4">
      {/* Controls & Filter Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-[#16161a] border border-[#23232a] rounded-xl p-3.5 shadow-sm">
        {/* Left: Search input */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#71717a]" />
          <input
            type="text"
            value={searchQuery}
            onInput={(e) => {
              setSearchQuery((e.target as HTMLInputElement).value);
              setCurrentPage(1);
            }}
            placeholder="Search models by name or provider..."
            className="w-full pl-9 pr-8 py-2 bg-[#121215] border border-[#262630] rounded-lg text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-[#2b64e0] transition"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery("");
                setCurrentPage(1);
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[#71717a] hover:text-white cursor-pointer p-1"
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {/* Right: Filters & Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
          {/* Provider Filter Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setProviderDropdownOpen(!providerDropdownOpen);
                setPageSizeDropdownOpen(false);
              }}
              className="flex items-center gap-2 bg-[#121215] hover:bg-[#18181d] border border-[#262630] hover:border-[#383846] rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#d4d4d8] transition cursor-pointer"
            >
              <Filter className="h-3.5 w-3.5 text-[#71717a]" />
              <span>
                {selectedProvider === "all"
                  ? `All Upstreams (${models.length})`
                  : formatProviderLabel(selectedProvider)}
              </span>
              <ChevronDown className={`h-3 w-3 text-[#71717a] transition-transform duration-150 ${providerDropdownOpen ? "rotate-180" : ""}`} />
            </button>

            {providerDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-20"
                  onClick={() => setProviderDropdownOpen(false)}
                />
                <div className="absolute left-0 mt-1.5 w-48 rounded-xl bg-[#16161a] border border-[#282832] shadow-xl py-1 z-30 flex flex-col divide-y divide-[#202026]">
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
                      <span>All Upstreams</span>
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

          {/* Ping All Button */}
          <button
            onClick={() => onPingAll(filteredModels)}
            disabled={isPingingAll || filteredModels.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#202028] hover:bg-[#282834] active:bg-[#1a1a20] border border-[#2c2c36] text-xs font-medium text-white transition disabled:opacity-50 cursor-pointer"
            title="Ping live latency and status for visible models"
          >
            {isPingingAll ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#3b82f6]" />
            ) : (
              <Zap className="h-3.5 w-3.5 text-amber-400" />
            )}
            <span>{isPingingAll ? "Pinging..." : "Ping All"}</span>
          </button>

          {/* Refresh Catalog Button */}
          <button
            onClick={onRefreshCatalog}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2b64e0] hover:bg-[#3872ee] active:bg-[#2353be] text-xs font-medium text-white transition shadow-sm disabled:opacity-50 cursor-pointer"
            title="Re-run health checks and refresh model catalog"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Ping Probe Summary */}
      {pingStats.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-[#16161a] border border-[#23232a] rounded-xl text-xs shadow-sm">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span className="font-semibold text-[#8b8b96] uppercase tracking-wider text-[11px] mr-1">
              Ping Filter:
            </span>

            {/* Filter Chip: All */}
            <button
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

            {/* Filter Chip: 200 OK */}
            <button
              onClick={() => {
                setActiveHealthChip(activeHealthChip === "ok" ? "all" : "ok");
                setCurrentPage(1);
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition border cursor-pointer ${
                activeHealthChip === "ok"
                  ? "bg-emerald-950/90 text-emerald-300 border-emerald-500 shadow-sm"
                  : "bg-[#121215] border-[#262630] text-emerald-400 hover:border-emerald-700/60"
              }`}
              title="Click to filter verified usable models"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>{pingStats.ok} OK (Usable)</span>
            </button>

            {/* Filter Chip: 429 Rate Limited */}
            {pingStats.rateLimited > 0 && (
              <button
                onClick={() => {
                  setActiveHealthChip(activeHealthChip === "429" ? "all" : "429");
                  setCurrentPage(1);
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition border cursor-pointer ${
                  activeHealthChip === "429"
                    ? "bg-amber-950/90 text-amber-300 border-amber-500 shadow-sm"
                    : "bg-[#121215] border-[#262630] text-amber-400 hover:border-amber-700/60"
                }`}
                title="Click to filter 429 rate-limited models"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>{pingStats.rateLimited} Rate Limited</span>
              </button>
            )}

            {/* Filter Chip: Errors */}
            {pingStats.error > 0 && (
              <button
                onClick={() => {
                  setActiveHealthChip(activeHealthChip === "error" ? "all" : "error");
                  setCurrentPage(1);
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition border cursor-pointer ${
                  activeHealthChip === "error"
                    ? "bg-rose-950/90 text-rose-300 border-rose-500 shadow-sm"
                    : "bg-[#121215] border-[#262630] text-rose-400 hover:border-rose-700/60"
                }`}
                title="Click to filter models with errors"
              >
                <XCircle className="h-3.5 w-3.5" />
                <span>{pingStats.error} Errors</span>
              </button>
            )}

            {/* Pinging State */}
            {pingStats.probing > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[#60a5fa]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{pingStats.probing} pinging...</span>
              </span>
            )}
          </div>

          {onClearPings && (
            <button
              onClick={() => {
                setActiveHealthChip("all");
                onClearPings();
              }}
              className="inline-flex items-center gap-1 text-[11px] text-[#71717a] hover:text-white cursor-pointer transition"
              title="Reset ping results"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Reset results</span>
            </button>
          )}
        </div>
      )}

      {/* Model Catalog Table */}
      <div className="rounded-xl border border-[#23232a] bg-[#16161a] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#121215] border-b border-[#23232a] text-[11px] font-semibold text-[#8b8b96] uppercase tracking-wider select-none">
              <tr>
                {/* Model Column Header (Sortable) */}
                <th
                  onClick={() => handleSort("model")}
                  className="py-3 px-4 hover:text-white transition cursor-pointer"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Model & Provider</span>
                    {sortField === "model" ? (
                      sortAsc ? <ArrowUp className="h-3 w-3 text-[#3b82f6]" /> : <ArrowDown className="h-3 w-3 text-[#3b82f6]" />
                    ) : (
                      <ArrowUpDown className="h-3 w-3 opacity-40 hover:opacity-100" />
                    )}
                  </div>
                </th>

                {/* Reasoning Column Header (Sortable) */}
                <th
                  onClick={() => handleSort("reasoning")}
                  className="py-3 px-4 hover:text-white transition cursor-pointer"
                  title="Sort reasoning-enabled models"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Reasoning</span>
                    {sortField === "reasoning" ? (
                      sortAsc ? <ArrowDown className="h-3 w-3 text-[#3b82f6]" /> : <ArrowUp className="h-3 w-3 text-[#3b82f6]" />
                    ) : (
                      <ArrowUpDown className="h-3 w-3 opacity-40 hover:opacity-100" />
                    )}
                  </div>
                </th>

                {/* Context Column Header (Sortable) */}
                <th
                  onClick={() => handleSort("context")}
                  className="py-3 px-4 hover:text-white transition cursor-pointer"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Context</span>
                    {sortField === "context" ? (
                      sortAsc ? <ArrowUp className="h-3 w-3 text-[#3b82f6]" /> : <ArrowDown className="h-3 w-3 text-[#3b82f6]" />
                    ) : (
                      <ArrowUpDown className="h-3 w-3 opacity-40 hover:opacity-100" />
                    )}
                  </div>
                </th>

                {/* Max Output Column Header (Sortable) */}
                <th
                  onClick={() => handleSort("maxOutput")}
                  className="py-3 px-4 hover:text-white transition cursor-pointer"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Max Output</span>
                    {sortField === "maxOutput" ? (
                      sortAsc ? <ArrowUp className="h-3 w-3 text-[#3b82f6]" /> : <ArrowDown className="h-3 w-3 text-[#3b82f6]" />
                    ) : (
                      <ArrowUpDown className="h-3 w-3 opacity-40 hover:opacity-100" />
                    )}
                  </div>
                </th>

                {/* Live Latency Column Header */}
                <th
                  onClick={() => {
                    if (pingStats.total === 0) {
                      onPingAll(filteredModels);
                    } else {
                      handleSort("latency");
                    }
                  }}
                  className="py-3 px-4 hover:text-white transition cursor-pointer"
                  title={pingStats.total === 0 ? "Click to ping all models and sort by latency" : "Sort by fastest latency"}
                >
                  <div className="flex items-center gap-1.5">
                    <span>Live Latency</span>
                    {pingStats.total === 0 ? (
                      <Zap className="h-3 w-3 text-amber-400/80" />
                    ) : sortField === "latency" ? (
                      sortAsc ? <ArrowUp className="h-3 w-3 text-[#3b82f6]" /> : <ArrowDown className="h-3 w-3 text-[#3b82f6]" />
                    ) : (
                      <ArrowUpDown className="h-3 w-3 opacity-40 hover:opacity-100" />
                    )}
                  </div>
                </th>

                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#202026] text-xs">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-[#71717a]">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Loader2 className="h-6 w-6 animate-spin text-[#3b82f6]" />
                      <span>Loading active catalog from daemon...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredModels.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-[#71717a]">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Search className="h-6 w-6 text-[#52525b]" />
                      <span className="text-white font-medium">No matching models found</span>
                      <span className="text-xs text-[#71717a]">
                        Try adjusting your search query or upstream filters.
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedModels.map((model) => {
                  const ping = pingResults[model.id];
                  const contextLimit = model.context_window || model.context_length;
                  const outputLimit = model.max_tokens || model.maxTokens;
                  const provider = model.source || model.owned_by;
                  const showBadge = provider && provider.toLowerCase() !== "bansos";

                  return (
                    <tr
                      key={model.id}
                      className="hover:bg-[#1a1a20] transition-colors duration-150 group"
                    >
                      {/* Model & Provider */}
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-medium text-white text-[13px] group-hover:text-[#60a5fa] transition">
                              {model.id}
                            </span>
                            <button
                              onClick={() => handleCopy(model.id)}
                              className="p-1 rounded text-[#71717a] hover:text-white hover:bg-[#23232b] active:scale-95 transition cursor-pointer"
                              title={copiedId === model.id ? "Copied!" : "Copy model ID"}
                            >
                              {copiedId === model.id ? (
                                <Check className="h-3.5 w-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>
                            {showBadge && (
                              <span
                                className={`text-[10px] px-2 py-0.5 rounded-full border font-medium uppercase tracking-wider ${getProviderBadgeColor(
                                  provider
                                )}`}
                              >
                                {provider}
                              </span>
                            )}
                          </div>
                          {model.name && model.name !== model.id && (
                            <span className="text-[11px] text-[#71717a]">{model.name}</span>
                          )}
                        </div>
                      </td>

                      {/* Reasoning */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {model.reasoning ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-950/60 border border-emerald-800/50 px-2 py-0.5 rounded-md">
                            <Sparkles className="h-3 w-3" /> Yes
                          </span>
                        ) : (
                          <span className="text-[#52525c] text-[11px] font-mono">-</span>
                        )}
                      </td>

                      {/* Context */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className="font-mono text-[#d4d4d8]">
                          {formatTokens(contextLimit)}
                        </span>
                      </td>

                      {/* Max Output */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className="font-mono text-[#a1a1aa]">
                          {formatTokens(outputLimit)}
                        </span>
                      </td>

                      {/* Live Latency Status */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {!ping || ping.status === "idle" ? (
                          <span className="text-[11px] text-[#52525b] font-mono">Not pinged</span>
                        ) : ping.status === "pinging" ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-[#60a5fa] font-mono">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            <span>pinging...</span>
                          </span>
                        ) : ping.status === "ok" ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-mono text-emerald-400 font-medium">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>{ping.latencyMs}ms</span>
                          </span>
                        ) : ping.status === "rate_limited" ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-mono text-amber-400 font-medium">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            <span>429 ({ping.latencyMs}ms)</span>
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1.5 text-xs font-mono text-rose-400 font-medium"
                            title={ping.error || "Ping failed"}
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            <span>Error {ping.statusCode ? `(${ping.statusCode})` : ""}</span>
                          </span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <button
                          onClick={() => onPingModel(model.id)}
                          disabled={ping?.status === "pinging"}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#202026] hover:bg-[#282832] active:bg-[#1a1a20] border border-[#2a2a34] hover:border-[#383846] text-[11px] font-medium text-[#d4d4d8] hover:text-white transition cursor-pointer disabled:opacity-50"
                          title={`Ping live response from ${model.id}`}
                        >
                          {ping?.status === "pinging" ? (
                            <Loader2 className="h-3 w-3 animate-spin text-[#3b82f6]" />
                          ) : (
                            <Zap className="h-3 w-3 text-amber-400" />
                          )}
                          <span>Ping</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer & Pagination */}
        <div className="bg-[#121215] border-t border-[#23232a] px-4 py-3 flex flex-col sm:flex-row items-center justify-between text-xs text-[#71717a] gap-3">
          {/* Left: Item Counter and Page Size Select */}
          <div className="flex items-center gap-3">
            <div>
              Showing{" "}
              <span className="text-white font-medium">
                {filteredModels.length === 0
                  ? 0
                  : (activePage - 1) * pageSize + 1}
                -
                {Math.min(activePage * pageSize, filteredModels.length)}
              </span>{" "}
              of <span className="text-white font-medium">{filteredModels.length}</span> models
              {filteredModels.length !== models.length && (
                <span className="text-[#52525c] ml-1">
                  (filtered from {models.length})
                </span>
              )}
            </div>

            {/* Custom Page Size Dropdown */}
            <div className="relative flex items-center gap-1.5 pl-2 border-l border-[#23232a]">
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
                  <div
                    className="fixed inset-0 z-20"
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

          {/* Right: Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setCurrentPage(1)}
                disabled={activePage <= 1}
                className="p-1 rounded-md bg-[#16161a] hover:bg-[#202028] disabled:opacity-30 disabled:hover:bg-[#16161a] border border-[#262630] text-[#a1a1aa] hover:text-white transition cursor-pointer disabled:cursor-not-allowed"
                title="First Page"
              >
                <ChevronsLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={activePage <= 1}
                className="p-1 rounded-md bg-[#16161a] hover:bg-[#202028] disabled:opacity-30 disabled:hover:bg-[#16161a] border border-[#262630] text-[#a1a1aa] hover:text-white transition cursor-pointer disabled:cursor-not-allowed"
                title="Previous Page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>

              <span className="px-2 text-xs font-mono text-[#d4d4d8]">
                Page <span className="text-white font-medium">{activePage}</span> of{" "}
                <span className="text-white font-medium">{totalPages}</span>
              </span>

              <button
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={activePage >= totalPages}
                className="p-1 rounded-md bg-[#16161a] hover:bg-[#202028] disabled:opacity-30 disabled:hover:bg-[#16161a] border border-[#262630] text-[#a1a1aa] hover:text-white transition cursor-pointer disabled:cursor-not-allowed"
                title="Next Page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={activePage >= totalPages}
                className="p-1 rounded-md bg-[#16161a] hover:bg-[#202028] disabled:opacity-30 disabled:hover:bg-[#16161a] border border-[#262630] text-[#a1a1aa] hover:text-white transition cursor-pointer disabled:cursor-not-allowed"
                title="Last Page"
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
