import { Loader2, Zap, RefreshCw, Search, RotateCcw } from "lucide-preact";

interface ModelEmptyStateProps {
  type: "loading" | "empty" | "no_match";
  refreshing?: boolean;
  onRefreshCatalog?: () => void;
  onResetFilters?: () => void;
}

export function ModelEmptyState({
  type,
  refreshing,
  onRefreshCatalog,
  onResetFilters,
}: ModelEmptyStateProps) {
  if (type === "loading") {
    return (
      <div className="py-12 text-center text-[#71717a] flex flex-col items-center justify-center gap-2">
        <Loader2 className="h-6 w-6 animate-spin text-[#3b82f6]" />
        <span className="text-xs">Loading models...</span>
      </div>
    );
  }

  if (type === "empty") {
    return (
      <div className="py-10 text-center text-[#71717a] flex flex-col items-center justify-center gap-2 px-4 max-w-sm mx-auto">
        <Zap className="h-7 w-7 text-amber-400/80" />
        <span className="text-white font-medium text-sm">No models available</span>
        <span className="text-xs text-[#71717a] leading-relaxed">
          The daemon hasn't fetched models from upstream providers yet or needs a refresh.
        </span>
        {onRefreshCatalog && (
          <button
            type="button"
            onClick={onRefreshCatalog}
            disabled={refreshing}
            className="mt-1 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#2b64e0] hover:bg-[#3872ee] text-xs font-semibold text-white transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span>{refreshing ? "Refreshing..." : "Refresh Models"}</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="py-10 text-center text-[#71717a] flex flex-col items-center justify-center gap-2 px-4 max-w-sm mx-auto">
      <Search className="h-6 w-6 text-[#52525b]" />
      <span className="text-white font-medium text-sm">No matching models found</span>
      <span className="text-xs text-[#71717a]">
        No models matched your search or active filters.
      </span>
      {onResetFilters && (
        <button
          type="button"
          onClick={onResetFilters}
          className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#202028] hover:bg-[#282834] border border-[#2c2c36] text-xs font-medium text-[#d4d4d8] hover:text-white transition cursor-pointer"
        >
          <RotateCcw className="h-3 w-3" />
          <span>Reset filters</span>
        </button>
      )}
    </div>
  );
}
