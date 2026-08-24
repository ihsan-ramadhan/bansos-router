import { Search } from "lucide-preact";
import type { ModelItem } from "../../types";
import { getProviderDotColor, getHarnessStrategy, groupModelsByProvider } from "../../utils/agent";

interface AgentModelSelectorProps {
  models: ModelItem[];
  selectedModel: string;
  selectedAdapterId: string;
  onSelectModel: (modelId: string) => void;
  onClose: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export function AgentModelSelector({
  models,
  selectedModel,
  selectedAdapterId,
  onSelectModel,
  onClose,
  searchQuery,
  onSearchChange,
}: AgentModelSelectorProps) {
  const filteredModels = searchQuery.trim()
    ? models.filter((m) => m.id.toLowerCase().includes(searchQuery.toLowerCase()) || m.name?.toLowerCase().includes(searchQuery.toLowerCase()))
    : models;

  const groupedModels = groupModelsByProvider(filteredModels);

  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close model dropdown"
        className="fixed inset-0 z-20 cursor-default bg-transparent border-0"
        onClick={onClose}
      />
      <div className="absolute left-0 right-0 top-full mt-1.5 rounded-xl bg-[#16161a] border border-[#282832] shadow-2xl p-2 z-30 space-y-2 max-h-72 flex flex-col">
        <div className="relative shrink-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#71717a]" />
          <input
            type="text"
            value={searchQuery}
            onInput={(e) => onSearchChange((e.target as HTMLInputElement).value)}
            placeholder="Search model..."
            className="w-full pl-8 pr-3 py-1.5 bg-[#121215] border border-[#262630] rounded-lg text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-[#2b64e0]"
          />
        </div>

        <div className="overflow-y-auto space-y-2 pr-1 flex-1">
          {/* Default / recommended option */}
          <button
            type="button"
            onClick={() => {
              onSelectModel("");
              onClose();
            }}
            className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition cursor-pointer flex flex-col gap-0.5 ${
              !selectedModel
                ? "bg-[#2b64e0]/20 text-[#60a5fa] font-semibold border border-[#2b64e0]/30"
                : "text-[#d4d4d8] hover:bg-[#202028] hover:text-white"
            }`}
          >
            <div className="flex items-center justify-between w-full">
              <span>Auto (Recommended Setup)</span>
              <span className="text-[10px] text-emerald-400 font-mono">Default</span>
            </div>
            <span className="text-[10px] text-[#71717a] font-normal">
              {getHarnessStrategy(selectedAdapterId, models.length).description}
            </span>
          </button>

          {groupedModels.length === 0 ? (
            <div className="py-6 text-center text-xs text-[#71717a]">
              No models matching "{searchQuery}"
            </div>
          ) : (
            groupedModels.map((group) => (
              <div key={group.provider} className="space-y-0.5">
                <div className="px-2.5 pt-1.5 pb-0.5 flex items-center justify-between text-[10px] font-semibold tracking-wider uppercase text-[#8b8b96] select-none">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`h-1.5 w-1.5 rounded-full shrink-0 ${getProviderDotColor(
                        group.provider
                      )}`}
                    />
                    <span>{group.label}</span>
                  </span>
                  <span className="font-mono text-[9px] text-[#52525c]">
                    {group.models.length}
                  </span>
                </div>
                {group.models.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      onSelectModel(m.id);
                      onClose();
                    }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-mono transition cursor-pointer flex items-center justify-between ${
                      selectedModel === m.id
                        ? "bg-[#2b64e0]/20 text-[#60a5fa] font-semibold"
                        : "text-[#d4d4d8] hover:bg-[#202028] hover:text-white"
                    }`}
                  >
                    <span className="truncate">{m.id}</span>
                    {m.reasoning && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-950/60 text-emerald-400 shrink-0 ml-2">
                        Think
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
