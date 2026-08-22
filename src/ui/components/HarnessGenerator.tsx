import { useState, useEffect, useMemo } from "preact/hooks";
import type { AdapterSummary, AdapterRenderResponse, ModelItem } from "../types/ui";
import { fetchAdapters, renderAdapter } from "../services/api";
import {
  Wrench,
  Copy,
  Check,
  Terminal,
  FileCode,
  ChevronDown,
  Code2,
  Cpu,
  Search,
} from "lucide-preact";

function getWireLabel(wire: string): string {
  if (wire === "anthropic") return "Anthropic";
  if (wire === "responses") return "Responses";
  return "Chat";
}

function getWireBadge(wire?: string) {
  switch (wire) {
    case "anthropic":
      return { label: "Anthropic Messages API", color: "text-amber-300 bg-amber-950/60 border-amber-800/40" };
    case "responses":
      return { label: "OpenAI Responses API", color: "text-purple-300 bg-purple-950/60 border-purple-800/40" };
    default:
      return { label: "OpenAI Chat Completions API", color: "text-blue-300 bg-blue-950/60 border-blue-800/40" };
  }
}

interface HarnessGeneratorProps {
  models: ModelItem[];
  daemonPort: number;
}

export function HarnessGenerator({ models, daemonPort }: HarnessGeneratorProps) {
  const [adapters, setAdapters] = useState<AdapterSummary[]>([]);
  const [selectedAdapterId, setSelectedAdapterId] = useState<string>("opencode");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [renderData, setRenderData] = useState<AdapterRenderResponse | null>(null);
  const [rendering, setRendering] = useState<boolean>(false);
  const [copiedCli, setCopiedCli] = useState<boolean>(false);
  const [copiedConfigIndex, setCopiedConfigIndex] = useState<number | null>(null);
  const [adapterDropdownOpen, setAdapterDropdownOpen] = useState<boolean>(false);
  const [adapterSearchQuery, setAdapterSearchQuery] = useState<string>("");
  const [modelDropdownOpen, setModelDropdownOpen] = useState<boolean>(false);
  const [modelSearchQuery, setModelSearchQuery] = useState<string>("");

  // Load adapters
  useEffect(() => {
    async function loadAdapters() {
      try {
        const list = await fetchAdapters();
        setAdapters(list);
        if (list.length > 0 && !list.some((a) => a.id === selectedAdapterId)) {
          setSelectedAdapterId(list[0]?.id ?? "opencode");
        }
      } catch (err) {
        console.error("Failed to load adapters:", err);
      }
    }
    loadAdapters();
  }, []);

  // Render selected adapter
  useEffect(() => {
    if (!selectedAdapterId) return;

    let isMounted = true;
    async function fetchRender() {
      setRendering(true);
      try {
        const res = await renderAdapter(selectedAdapterId, selectedModel || undefined);
        if (isMounted) {
          setRenderData(res);
        }
      } catch (err) {
        console.error("Failed to render adapter:", err);
      } finally {
        if (isMounted) setRendering(false);
      }
    }

    fetchRender();
    return () => {
      isMounted = false;
    };
  }, [selectedAdapterId, selectedModel]);

  const activeAdapter = useMemo(() => {
    return adapters.find((a) => a.id === selectedAdapterId);
  }, [adapters, selectedAdapterId]);

  // Filter adapters
  const filteredAdapters = useMemo(() => {
    if (!adapterSearchQuery.trim()) return adapters;
    const q = adapterSearchQuery.toLowerCase();
    return adapters.filter(
      (a) => a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q) || a.wire.toLowerCase().includes(q)
    );
  }, [adapters, adapterSearchQuery]);

  // Filter models
  const filteredModels = useMemo(() => {
    if (!modelSearchQuery.trim()) return models;
    const q = modelSearchQuery.toLowerCase();
    return models.filter((m) => m.id.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q));
  }, [models, modelSearchQuery]);

  // Copy CLI command string
  const cliCommand = selectedModel
    ? `bansos setup ${selectedAdapterId} --model ${selectedModel}`
    : `bansos setup ${selectedAdapterId}`;

  async function handleCopyCli() {
    try {
      await navigator.clipboard.writeText(cliCommand);
      setCopiedCli(true);
      setTimeout(() => setCopiedCli(false), 2000);
    } catch {
      // fallback
    }
  }

  async function handleCopyConfig(content: string, index: number) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedConfigIndex(index);
      setTimeout(() => setCopiedConfigIndex((curr) => (curr === index ? null : curr)), 2000);
    } catch {
      // fallback
    }
  }

  // Copy CLI command string
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-5 shadow-sm">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <Wrench className="h-4 w-4" />
              </div>
              <h2 className="text-base font-bold text-white tracking-tight">
                Harness Config Generator
              </h2>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#202028] text-emerald-400 border border-emerald-800/40 font-mono">
                13 Agents Supported
              </span>
            </div>
            <p className="text-xs text-[#9393a0]">
              Generate 1-click terminal setup and configuration files for your coding agent.
            </p>
          </div>

          <div className="flex items-center gap-3 self-stretch sm:self-auto">
            <div className="text-right hidden sm:block">
              <div className="text-[10px] text-[#71717a] uppercase font-mono tracking-wider">Local Endpoint</div>
              <div className="text-xs font-mono text-emerald-400">http://127.0.0.1:{daemonPort}/v1</div>
            </div>
          </div>
        </div>
      </div>

      {/* Configuration */}
      <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-5 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-[#23232a] pb-3">
          <div>
            <span className="text-xs font-bold text-white tracking-tight uppercase">
              Target Configuration
            </span>
            <p className="text-[11px] text-[#71717a]">
              Select your coding harness agent and optionally pin a default model.
            </p>
          </div>

          {activeAdapter && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-[#71717a] hidden sm:inline">
                Protocol:
              </span>
              <span className={`text-[11px] px-2.5 py-0.5 rounded-full border font-medium ${getWireBadge(activeAdapter.wire).color}`}>
                {getWireBadge(activeAdapter.wire).label}
              </span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          {/* Target Harness */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8b8b96]">
                Target Coding Harness
              </span>
              <span className="text-[11px] font-mono text-[#71717a]">
                {adapters.length} available
              </span>
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setAdapterDropdownOpen(!adapterDropdownOpen);
                  setModelDropdownOpen(false);
                }}
                className="w-full flex items-center justify-between bg-[#121215] hover:bg-[#18181d] border border-[#262630] hover:border-[#383846] rounded-lg px-3 py-2 text-xs font-medium text-white transition cursor-pointer"
              >
                <div className="flex items-center gap-2 truncate">
                  <Code2 className="h-4 w-4 text-[#60a5fa] shrink-0" />
                  <span className="truncate">
                    {activeAdapter ? activeAdapter.name : "Select Harness..."}
                  </span>
                  {activeAdapter && (
                    <span className="text-[10px] font-mono uppercase text-[#71717a] ml-1">
                      ({activeAdapter.wire})
                    </span>
                  )}
                </div>
                <ChevronDown className={`h-3.5 w-3.5 text-[#71717a] shrink-0 transition-transform duration-150 ${adapterDropdownOpen ? "rotate-180" : ""}`} />
              </button>

              {adapterDropdownOpen && (
                <>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Close harness dropdown"
                    className="fixed inset-0 z-20 cursor-default bg-transparent border-0"
                    onClick={() => setAdapterDropdownOpen(false)}
                  />
                  <div className="absolute left-0 right-0 top-full mt-1.5 rounded-xl bg-[#16161a] border border-[#282832] shadow-2xl p-2 z-30 space-y-2 max-h-64 flex flex-col">
            {/* Search inside adapter dropdown */}
                    <div className="relative shrink-0">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#71717a]" />
                      <input
                        type="text"
                        value={adapterSearchQuery}
                        onInput={(e) => setAdapterSearchQuery((e.target as HTMLInputElement).value)}
                        placeholder="Search harness (e.g. claude, aider)..."
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
                              setSelectedAdapterId(adapter.id);
                              setAdapterDropdownOpen(false);
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
              )}
            </div>
          </div>

          {/* Model Pinning */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8b8b96]">
                Model Pinning (Optional)
              </span>
              <span className="text-[11px] font-mono text-[#71717a]">
                {models.length} available
              </span>
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setModelDropdownOpen(!modelDropdownOpen);
                  setAdapterDropdownOpen(false);
                }}
                className="w-full flex items-center justify-between bg-[#121215] hover:bg-[#18181d] border border-[#262630] hover:border-[#383846] rounded-lg px-3 py-2 text-xs font-medium text-white transition cursor-pointer"
              >
                <div className="flex items-center gap-2 truncate">
                  <Cpu className="h-3.5 w-3.5 text-[#71717a] shrink-0" />
                  <span className="truncate">
                    {selectedModel || "Auto (Register All Models)"}
                  </span>
                </div>
                <ChevronDown className={`h-3.5 w-3.5 text-[#71717a] shrink-0 transition-transform duration-150 ${modelDropdownOpen ? "rotate-180" : ""}`} />
              </button>

              {modelDropdownOpen && (
                <>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Close model dropdown"
                    className="fixed inset-0 z-20 cursor-default bg-transparent border-0"
                    onClick={() => setModelDropdownOpen(false)}
                  />
                  <div className="absolute left-0 right-0 top-full mt-1.5 rounded-xl bg-[#16161a] border border-[#282832] shadow-2xl p-2 z-30 space-y-2 max-h-64 flex flex-col">
            {/* Search inside model dropdown */}
                    <div className="relative shrink-0">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#71717a]" />
                      <input
                        type="text"
                        value={modelSearchQuery}
                        onInput={(e) => setModelSearchQuery((e.target as HTMLInputElement).value)}
                        placeholder="Filter model ID..."
                        className="w-full pl-8 pr-3 py-1.5 bg-[#121215] border border-[#262630] rounded-lg text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-[#2b64e0]"
                      />
                    </div>

                    <div className="overflow-y-auto space-y-1 pr-1 flex-1">
            {/* Default / all models option */}
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedModel("");
                          setModelDropdownOpen(false);
                        }}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition cursor-pointer flex items-center justify-between ${
                          !selectedModel
                            ? "bg-[#2b64e0]/20 text-[#60a5fa] font-semibold"
                            : "text-[#d4d4d8] hover:bg-[#202028] hover:text-white"
                        }`}
                      >
                        <span>Auto (All Free Models)</span>
                        <span className="text-[10px] text-emerald-400 font-mono">Recommended</span>
                      </button>

                      {filteredModels.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setSelectedModel(m.id);
                            setModelDropdownOpen(false);
                          }}
                          className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition cursor-pointer truncate font-mono ${
                            selectedModel === m.id
                              ? "bg-[#2b64e0]/20 text-[#60a5fa] font-semibold"
                              : "text-[#d4d4d8] hover:bg-[#202028] hover:text-white"
                          }`}
                        >
                          {m.id}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Setup & Config */}
      <div className="space-y-4">
        {/* Terminal setup */}
        <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-[#3b82f6]" />
              <span className="text-xs font-bold text-white tracking-tight">
                1-Click Terminal Setup
              </span>
            </div>
            <span className="text-[11px] font-mono text-[#71717a]">
              Auto-merges safely without overwriting your custom keys
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[#111113] border border-[#23232a]">
            <code className="text-xs font-mono text-emerald-400 select-all truncate">
              {cliCommand}
            </code>
            <button
              type="button"
              onClick={handleCopyCli}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#202026] hover:bg-[#282832] active:bg-[#1a1a20] border border-[#2a2a34] text-xs font-medium text-white transition cursor-pointer shadow-sm"
              title="Copy terminal command"
            >
              {copiedCli ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-emerald-400 font-semibold">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-[#a1a1aa]" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Generated config files */}
        <div className="rounded-xl border border-[#23232a] bg-[#16161a] overflow-hidden shadow-sm">
          <div className="bg-[#121215] border-b border-[#23232a] px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <FileCode className="h-4 w-4 text-[#8b8b96]" />
              <span className="text-xs font-bold text-white tracking-tight">
                Generated Config Output
              </span>
              {activeAdapter && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${getWireBadge(activeAdapter.wire).color}`}>
                  {getWireBadge(activeAdapter.wire).label}
                </span>
              )}
            </div>

            {renderData && renderData.config.length > 0 && (
              <span className="text-[11px] font-mono text-[#71717a]">
                {renderData.config.length} target file(s)
              </span>
            )}
          </div>

          <div className="p-4 space-y-4">
            {rendering && (
              <div className="py-12 text-center text-xs text-[#71717a]">
                Rendering config...
              </div>
            )}
            {!rendering && (!renderData || renderData.config.length === 0) && (
              <div className="py-12 text-center text-xs text-[#71717a]">
                No config template available for this harness.
              </div>
            )}
            {!rendering && renderData && renderData.config.length > 0 && (
              renderData.config.map((cfg, idx) => (
                <div key={`${cfg.path}-${idx}`} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-mono text-[#a1a1aa] truncate">
                      <span className="text-[#60a5fa]">File:</span>
                      <span className="text-white truncate">{cfg.path}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#202028] text-[#71717a] border border-[#2c2c36]">
                        {cfg.mode || "merge"}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleCopyConfig(cfg.content, idx)}
                      className="flex items-center gap-1 text-[11px] text-[#71717a] hover:text-white px-2 py-1 rounded bg-[#16161a] hover:bg-[#202028] border border-[#262630] transition cursor-pointer"
                      title="Copy configuration snippet"
                    >
                      {copiedConfigIndex === idx ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" />
                          <span className="text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>Copy snippet</span>
                        </>
                      )}
                    </button>
                  </div>

                  <pre className="p-3.5 rounded-lg bg-[#111113] border border-[#23232a] text-xs font-mono text-[#e4e4e7] overflow-x-auto max-h-96 select-all leading-relaxed">
                    {cfg.content}
                  </pre>
                </div>
              ))
            )}
          </div>

          {/* Tips */}
          <div className="bg-[#121215] border-t border-[#23232a] px-4 py-2.5 text-[11px] text-[#71717a] flex items-center justify-between">
            <span>💡 You can undo changes anytime with <code>bansos setup {selectedAdapterId} --undo</code></span>
          </div>
        </div>
      </div>
    </div>
  );
}
