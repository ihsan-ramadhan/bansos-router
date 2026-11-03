import { ChevronDown, ChevronRight, Brain, Eye, Search } from "lucide-preact";
import type { ModelItem, WireProtocol } from "../../types";
import { formatProviderLabel } from "../../utils/playground";

interface PlaygroundSidebarProps {
  models: ModelItem[];
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
  activeModelObj?: ModelItem;
  modelDropdownOpen: boolean;
  onToggleModelDropdown: () => void;
  onCloseModelDropdown: () => void;
  modelSearchQuery: string;
  onModelSearchQueryChange: (q: string) => void;
  groupedModels: Array<{ provider: string; label: string; models: ModelItem[] }>;
  selectedProtocol: WireProtocol;
  onSelectProtocol: (protocol: WireProtocol) => void;
  getEndpointLabel: (protocol: WireProtocol) => string;
  showSystemPrompt: boolean;
  onToggleSystemPrompt: () => void;
  systemPrompt: string;
  onSystemPromptChange: (val: string) => void;
  daemonPort: number;
  messageCount: number;
}

export function PlaygroundSidebar({
  selectedModel,
  onSelectModel,
  activeModelObj,
  modelDropdownOpen,
  onToggleModelDropdown,
  onCloseModelDropdown,
  modelSearchQuery,
  onModelSearchQueryChange,
  groupedModels,
  selectedProtocol,
  onSelectProtocol,
  getEndpointLabel,
  showSystemPrompt,
  onToggleSystemPrompt,
  systemPrompt,
  onSystemPromptChange,
  daemonPort,
  messageCount,
}: PlaygroundSidebarProps) {
  const endpointHost = typeof window !== "undefined" && window.location.host
    ? (window.location.hostname === "localhost" ? `127.0.0.1:${window.location.port || daemonPort}` : window.location.host)
    : `127.0.0.1:${daemonPort}`;
  return (
    <div className="lg:col-span-4 h-full min-h-0 overflow-y-auto no-scrollbar space-y-3">
      <div className="rounded-xl border border-[#1c1f2b] bg-[#10121a] p-3.5 sm:p-4 shadow-xs space-y-4">
        {/* Model Selector Dropdown */}
        <div className="space-y-1.5">
          <span className="text-[10px] sm:text-[11px] font-semibold text-[#8b8b96] uppercase tracking-wider block">
            Active Model
          </span>

          <div className="relative">
            <button
              type="button"
              onClick={onToggleModelDropdown}
              className="w-full min-h-10.5 flex items-center justify-between bg-[#0c0e14] hover:bg-[#131620] border border-[#1c1f2b] hover:border-[#2b334a] rounded-lg px-3 py-2 text-xs font-mono text-white transition cursor-pointer"
            >
              <div className="flex items-center gap-2 truncate">
                <span className="font-semibold truncate">{selectedModel || "Select Model..."}</span>
                <div className="flex items-center gap-1 shrink-0">
                  {activeModelObj?.reasoning && (
                    <span className="p-0.5 text-blue-400" title="Reasoning">
                      <Brain className="h-3 w-3" />
                    </span>
                  )}
                  {Array.isArray(activeModelObj?.input) && activeModelObj.input.includes("image") && (
                    <span className="p-0.5 text-teal-400" title="Vision">
                      <Eye className="h-3 w-3" />
                    </span>
                  )}
                </div>
              </div>
              <ChevronDown
                className={`h-3.5 w-3.5 text-[#71717a] shrink-0 transition-transform duration-150 ${
                  modelDropdownOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {modelDropdownOpen && (
              <>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="Close model dropdown"
                  className="fixed inset-0 z-20 cursor-default bg-transparent border-0"
                  onClick={onCloseModelDropdown}
                />
                <div className="absolute left-0 right-0 mt-1.5 max-h-72 rounded-xl bg-[#10121a] border border-[#1c1f2b] shadow-2xl z-30 flex flex-col overflow-hidden">
                  <div className="p-2 border-b border-[#1c1f2b] shrink-0">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#71717a]" />
                      <input
                        type="text"
                        value={modelSearchQuery}
                        onInput={(e) => onModelSearchQueryChange((e.target as HTMLInputElement).value)}
                        placeholder="Search models..."
                        className="w-full pl-8 pr-3 py-1.5 bg-[#0c0e14] border border-[#1c1f2b] rounded-md text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-[#2563eb]"
                      />
                    </div>
                  </div>

                  <div className="overflow-y-auto p-1.5 space-y-2 flex-1">
                    {groupedModels.length === 0 ? (
                      <div className="py-6 text-center text-xs text-[#71717a]">
                        No models matching "{modelSearchQuery}"
                      </div>
                    ) : (
                      groupedModels.map((group) => (
                        <div key={group.provider} className="space-y-0.5">
                          <div className="px-2 pt-1 pb-0.5 flex items-center justify-between text-[10px] font-semibold tracking-wider uppercase text-[#8b8b96] select-none">
                            <span className="flex items-center gap-1.5">
                              <span
                                className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                                  group.provider === "zen"
                                    ? "bg-blue-400"
                                    : group.provider === "kilo"
                                    ? "bg-purple-400"
                                    : group.provider === "llm7"
                                    ? "bg-emerald-400"
                                    : group.provider === "ovh"
                                    ? "bg-amber-400"
                                    : "bg-zinc-400"
                                }`}
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
                                onCloseModelDropdown();
                              }}
                              className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-mono transition flex items-center justify-between cursor-pointer ${
                                selectedModel === m.id
                                  ? "bg-[#2b64e0]/15 text-[#60a5fa] font-semibold"
                                  : "text-[#d4d4d8] hover:bg-[#202028] hover:text-white"
                              }`}
                            >
                              <div className="flex flex-col truncate pr-2">
                                <span className="truncate">{m.id}</span>
                                {m.name && m.name !== m.id && (
                                  <span className="text-[10px] text-[#71717a] font-sans truncate">{m.name}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-1 shrink-0 ml-2">
                                {m.reasoning && (
                                  <span className="p-0.5 text-blue-400" title="Reasoning">
                                    <Brain className="h-3 w-3" />
                                  </span>
                                )}
                                {Array.isArray(m.input) && m.input.includes("image") && (
                                  <span className="p-0.5 text-teal-400" title="Vision">
                                    <Eye className="h-3 w-3" />
                                  </span>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Protocol Selector */}
        <div className="space-y-1.5">
          <span className="text-[10px] sm:text-[11px] font-semibold text-[#8b8b96] uppercase tracking-wider flex items-center justify-between">
            <span>API Protocol</span>
            <span className="text-[10px] text-[#60a5fa] font-mono lowercase truncate ml-2">
              {getEndpointLabel(selectedProtocol)}
            </span>
          </span>

          <div className="grid grid-cols-3 gap-1 bg-[#0c0e14] p-1 rounded-lg border border-[#1c1f2b]">
            <button
              type="button"
              onClick={() => onSelectProtocol("chat")}
              className={`py-1.5 px-1 rounded text-center text-xs font-medium transition cursor-pointer truncate ${
                selectedProtocol === "chat"
                  ? "bg-[#2563eb] text-white shadow-xs"
                  : "text-[#94a3b8] hover:text-white"
              }`}
            >
              Chat
            </button>
            <button
              type="button"
              onClick={() => onSelectProtocol("responses")}
              className={`py-1.5 px-1 rounded text-center text-xs font-medium transition cursor-pointer truncate ${
                selectedProtocol === "responses"
                  ? "bg-[#2563eb] text-white shadow-xs"
                  : "text-[#94a3b8] hover:text-white"
              }`}
            >
              Responses
            </button>
            <button
              type="button"
              onClick={() => onSelectProtocol("anthropic")}
              className={`py-1.5 px-1 rounded text-center text-xs font-medium transition cursor-pointer truncate ${
                selectedProtocol === "anthropic"
                  ? "bg-[#2563eb] text-white shadow-xs"
                  : "text-[#94a3b8] hover:text-white"
              }`}
            >
              Anthropic
            </button>
          </div>
        </div>

        {/* Optional System Prompt Accordion */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={onToggleSystemPrompt}
              className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-semibold text-[#8b8b96] uppercase tracking-wider hover:text-white transition cursor-pointer"
            >
              {showSystemPrompt ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              )}
              <span>System Instructions</span>
            </button>
            {systemPrompt.trim() && (
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-950/70 text-blue-400 border border-blue-800/40 text-[10px] font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
                  Active
                </span>
                <button
                  type="button"
                  onClick={() => onSystemPromptChange("")}
                  className="text-[10px] text-[#71717a] hover:text-rose-400 transition"
                  title="Clear system instructions"
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          {showSystemPrompt && (
            <div className="pt-1">
              <textarea
                value={systemPrompt}
                onInput={(e) => onSystemPromptChange((e.target as HTMLTextAreaElement).value)}
                placeholder="Optional persona, tone, or instructions for the model..."
                rows={4}
                className="w-full p-2.5 bg-[#0c0e14] border border-[#1c1f2b] rounded-lg text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-[#2563eb] transition font-mono leading-relaxed"
              />
            </div>
          )}
        </div>

        {/* Chat Session Info */}
        <div className="pt-2 border-t border-[#1c1f2b] text-xs text-[#a1a1aa] space-y-1">
          <div className="flex justify-between">
            <span>Daemon Endpoint</span>
            <span className="font-mono text-[#d4d4d8]">{endpointHost}</span>
          </div>
          <div className="flex justify-between">
            <span>Active Protocol</span>
            <span className="font-mono text-[#60a5fa] capitalize">{selectedProtocol}</span>
          </div>
          <div className="flex justify-between">
            <span>Messages</span>
            <span className="font-mono text-[#60a5fa]">{messageCount}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
