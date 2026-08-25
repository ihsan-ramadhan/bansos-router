import { Search, Code2 } from "lucide-preact";
import type { AdapterSummary } from "../../types";
import { getWireBadge, getWireLabel } from "../../utils/agent";

interface AgentSelectorProps {
  adapters: AdapterSummary[];
  selectedAdapterId: string;
  onSelectAdapter: (id: string) => void;
  onClose: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export function AgentAdapterSelector({
  adapters,
  selectedAdapterId,
  onSelectAdapter,
  onClose,
  searchQuery,
  onSearchChange,
}: AgentSelectorProps) {
  const filteredAdapters = adapters
    .filter((a) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q) || a.wire.toLowerCase().includes(q);
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close agent dropdown"
        className="fixed inset-0 z-20 cursor-default bg-transparent border-0"
        onClick={onClose}
      />
      <div className="absolute left-0 right-0 top-full mt-1.5 rounded-xl bg-[#16161a] border border-[#282832] shadow-2xl p-2 z-30 space-y-2 max-h-64 flex flex-col">
        <div className="relative shrink-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#71717a]" />
          <input
            type="text"
            value={searchQuery}
            onInput={(e) => onSearchChange((e.target as HTMLInputElement).value)}
            placeholder="Search agent..."
            className="w-full pl-8 pr-3 py-1.5 bg-[#121215] border border-[#262630] rounded-lg text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-[#2b64e0]"
          />
        </div>

        <div className="overflow-y-auto space-y-1 pr-1 flex-1">
          {filteredAdapters.map((adapter) => {
            const isSelected = adapter.id === selectedAdapterId;
            return (
              <button
                key={adapter.id}
                type="button"
                onClick={() => {
                  onSelectAdapter(adapter.id);
                  onClose();
                }}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition cursor-pointer ${
                  isSelected
                    ? "bg-[#2b64e0]/20 text-[#60a5fa] font-semibold"
                    : "text-[#d4d4d8] hover:bg-[#202028] hover:text-white"
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <Code2 className={`h-3.5 w-3.5 shrink-0 ${isSelected ? "text-[#60a5fa]" : "text-[#71717a]"}`} />
                  <span className="truncate">{adapter.name}</span>
                </div>
                <span className="text-[10px] font-mono uppercase text-[#71717a] shrink-0 ml-2">
                  {getWireLabel(adapter.wire)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
