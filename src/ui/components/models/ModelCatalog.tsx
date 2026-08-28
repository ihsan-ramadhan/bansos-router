import { useState, useMemo } from "preact/hooks";
import type { ModelItem, PingResult } from "../../types";
import { ArrowUpDown, ArrowUp, ArrowDown, Zap } from "lucide-preact";
import {
  filterAndSortModels,
  type CapabilityFilter,
  type HealthFilter,
  type ModelSortField,
} from "../../utils/models";
import { ModelCatalogRow, ModelCard } from "./ModelRowAndCard";
import { ModelEmptyState } from "./ModelEmptyState";
import { CatalogToolbar, CapabilityFilterChips } from "./CatalogToolbar";
import { PingSummaryBar } from "./PingSummaryBar";
import type { PingStats } from "../../types";
import { CatalogPagination } from "./CatalogPagination";

function getSortIcon(currentField: string, activeField: string, asc: boolean) {
  if (currentField !== activeField) {
    return <ArrowUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100 transition-opacity" />;
  }
  return asc ? <ArrowUp className="h-3 w-3 text-[#3b82f6]" /> : <ArrowDown className="h-3 w-3 text-[#3b82f6]" />;
}

export interface ModelCatalogProps {
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
  const [activeHealthChip, setActiveHealthChip] = useState<HealthFilter>("all");
  const [capabilityFilter, setCapabilityFilter] = useState<CapabilityFilter>("all");
  const [sortField, setSortField] = useState<ModelSortField>("default");
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
      // Clipboard write failed
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
    return filterAndSortModels({
      models,
      searchQuery,
      selectedProvider,
      activeHealthChip,
      capabilityFilter,
      sortField,
      sortAsc,
      pingResults,
    });
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

  function handleResetFilters() {
    setSearchQuery("");
    setSelectedProvider("all");
    setActiveHealthChip("all");
    setCapabilityFilter("all");
    setCurrentPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(filteredModels.length / pageSize));
  const activePage = Math.min(currentPage, totalPages);

  const paginatedModels = useMemo(() => {
    const start = (activePage - 1) * pageSize;
    return filteredModels.slice(start, start + pageSize);
  }, [filteredModels, activePage, pageSize]);

  const pingStats: PingStats = useMemo(() => {
    const entries = Object.values(pingResults);
    const ok = entries.filter((r) => r.status === "ok").length;
    const rateLimited = entries.filter((r) => r.status === "rate_limited").length;
    const error = entries.filter((r) => r.status === "error").length;
    const probing = entries.filter((r) => r.status === "pinging").length;
    return { total: entries.length, ok, rateLimited, error, probing };
  }, [pingResults]);

  function renderTableBody() {
    if (loading) {
      return (
        <tr>
          <td colSpan={6}>
            <ModelEmptyState type="loading" />
          </td>
        </tr>
      );
    }
    if (models.length === 0) {
      return (
        <tr>
          <td colSpan={6}>
            <ModelEmptyState
              type="empty"
              refreshing={refreshing}
              onRefreshCatalog={onRefreshCatalog}
            />
          </td>
        </tr>
      );
    }
    if (filteredModels.length === 0) {
      return (
        <tr>
          <td colSpan={6}>
            <ModelEmptyState type="no_match" onResetFilters={handleResetFilters} />
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

  function renderMobileCards() {
    if (loading) {
      return <ModelEmptyState type="loading" />;
    }
    if (models.length === 0) {
      return (
        <ModelEmptyState
          type="empty"
          refreshing={refreshing}
          onRefreshCatalog={onRefreshCatalog}
        />
      );
    }
    if (filteredModels.length === 0) {
      return <ModelEmptyState type="no_match" onResetFilters={handleResetFilters} />;
    }
    return (
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
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls & filters */}
      <CatalogToolbar
        searchQuery={searchQuery}
        onSearchChange={(q) => {
          setSearchQuery(q);
          setCurrentPage(1);
        }}
        selectedProvider={selectedProvider}
        onSelectProvider={(p) => {
          setSelectedProvider(p);
          setCurrentPage(1);
        }}
        providers={providers}
        totalModelsCount={models.length}
        models={models}
        isPingingAll={isPingingAll}
        pingProgress={pingProgress}
        onCancelPing={onCancelPing}
        onPingAll={() => onPingAll(filteredModels)}
        filteredCount={filteredModels.length}
        refreshing={refreshing}
        onRefreshCatalog={onRefreshCatalog}
      />

      {/* Capability filter chips */}
      <CapabilityFilterChips
        capabilityFilter={capabilityFilter}
        onSelectCapability={(cap) => {
          setCapabilityFilter(cap);
          setCurrentPage(1);
        }}
        totalModelsCount={models.length}
      />

      {/* Ping summary */}
      <PingSummaryBar
        pingStats={pingStats}
        activeHealthChip={activeHealthChip}
        onSelectHealthChip={(chip) => {
          setActiveHealthChip(chip);
          setCurrentPage(1);
        }}
        pingProgress={pingProgress}
        onClearPings={onClearPings}
      />

      {/* Model listing: Mobile cards (< md) vs Desktop table (>= md) */}
      <div className="rounded-xl border border-[#23232a] bg-[#16161a] overflow-hidden shadow-xs">
        {/* Mobile View: Cards Grid */}
        <div className="block md:hidden p-2.5 sm:p-3">
          {renderMobileCards()}
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

                {/* Capabilities column */}
                <th
                  onClick={() => handleSort("reasoning")}
                  className="py-3 px-3 sm:px-4 hover:text-white transition cursor-pointer group"
                  title="Sort by reasoning capability"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Capabilities</span>
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
        <CatalogPagination
          totalItems={models.length}
          filteredCount={filteredModels.length}
          activePage={activePage}
          pageSize={pageSize}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setCurrentPage(1);
          }}
        />
      </div>
    </div>
  );
}
