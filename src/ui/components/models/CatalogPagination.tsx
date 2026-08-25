import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
} from "lucide-preact";
import { useState } from "preact/hooks";

interface CatalogPaginationProps {
  totalItems: number;
  filteredCount: number;
  activePage: number;
  pageSize: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export function CatalogPagination({
  totalItems,
  filteredCount,
  activePage,
  pageSize,
  totalPages,
  onPageChange,
  onPageSizeChange,
}: CatalogPaginationProps) {
  const [pageSizeDropdownOpen, setPageSizeDropdownOpen] = useState(false);

  return (
    <div className="bg-[#121215] border-t border-[#23232a] px-3 sm:px-4 py-3 flex flex-col sm:flex-row items-center justify-between text-xs text-[#71717a] gap-3">
      <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 sm:gap-4 w-full sm:w-auto">
        <div className="text-center sm:text-left">
          Showing{" "}
          <span className="text-white font-medium">
            {filteredCount === 0 ? 0 : (activePage - 1) * pageSize + 1}
            {" – "}
            {Math.min(activePage * pageSize, filteredCount)}
          </span>{" "}
          of <span className="text-white font-medium">{filteredCount}</span> models
          {filteredCount !== totalItems && (
            <span className="text-[#52525c] ml-1.5">
              (filtered from {totalItems})
            </span>
          )}
        </div>

        {/* Page size dropdown */}
        <div className="relative flex items-center gap-2 pl-3 sm:pl-3.5 border-l border-[#282832]">
          <span className="text-[11px] text-[#71717a]">Per page:</span>
          <button
            type="button"
            onClick={() => setPageSizeDropdownOpen(!pageSizeDropdownOpen)}
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
                      onPageSizeChange(size);
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
            onClick={() => onPageChange(1)}
            disabled={activePage <= 1}
            className="p-1.5 rounded-md bg-[#16161a] hover:bg-[#202028] disabled:opacity-30 disabled:hover:bg-[#16161a] border border-[#262630] text-[#a1a1aa] hover:text-white transition cursor-pointer disabled:cursor-not-allowed"
            title="First Page"
            aria-label="First page"
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, activePage - 1))}
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
            onClick={() => onPageChange(Math.min(totalPages, activePage + 1))}
            disabled={activePage >= totalPages}
            className="p-1.5 rounded-md bg-[#16161a] hover:bg-[#202028] disabled:opacity-30 disabled:hover:bg-[#16161a] border border-[#262630] text-[#a1a1aa] hover:text-white transition cursor-pointer disabled:cursor-not-allowed"
            title="Next Page"
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onPageChange(totalPages)}
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
  );
}
