import { useState, useEffect, useMemo, useRef } from "preact/hooks";
import type { AdapterSummary, AdapterRenderResponse, ModelItem, ModelPick, SetupResult } from "../../types";
import { applyHarness, fetchAdapters, renderAdapter } from "../../services/api";
import {
  Wrench,
  Copy,
  Check,
  Terminal,
  ChevronDown,
  Code2,
  Cpu,
  Loader2,
  Undo2,
  TriangleAlert,
} from "lucide-preact";
import { getHarnessStrategy, getWireBadge, pickFromChecked, pickedModels, setupCommand } from "../../utils/agent";
import { AgentAdapterSelector } from "./AgentSelector";
import { AgentModelSelector } from "./AgentModelSelector";
import { AgentModelChecklist } from "./AgentModelChecklist";
import { AgentConfigViewer } from "./AgentConfigViewer";

interface AgentSetupProps {
  models: ModelItem[];
  daemonPort: number;
  onCatalogStale?: () => void;
}

export function AgentSetup({ models, daemonPort, onCatalogStale }: AgentSetupProps) {
  const [adapters, setAdapters] = useState<AdapterSummary[]>([]);
  const [selectedAdapterId, setSelectedAdapterId] = useState<string>("opencode");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [modelPick, setModelPick] = useState<ModelPick | null>(null);
  const adapterTriggerRef = useRef<HTMLButtonElement>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const [renderData, setRenderData] = useState<AdapterRenderResponse | null>(null);
  const [rendering, setRendering] = useState<boolean>(false);
  const [copiedCli, setCopiedCli] = useState<boolean>(false);
  const [copiedConfigIndex, setCopiedConfigIndex] = useState<number | null>(null);
  const [adapterDropdownOpen, setAdapterDropdownOpen] = useState<boolean>(false);
  const [adapterSearchQuery, setAdapterSearchQuery] = useState<string>("");
  const [modelDropdownOpen, setModelDropdownOpen] = useState<boolean>(false);
  const [modelSearchQuery, setModelSearchQuery] = useState<string>("");
  const [applying, setApplying] = useState<"apply" | "undo" | null>(null);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [setupResult, setSetupResult] = useState<SetupResult | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    setSetupResult(null);
    setSetupError(null);
    setConfirmUndo(false);
  }, [selectedAdapterId]);

  const activeAdapter = useMemo(() => adapters.find((a) => a.id === selectedAdapterId), [adapters, selectedAdapterId]);
  const mode = activeAdapter?.modelMode ?? "single";
  const picksList = mode === "list" || mode === "tiered";
  const picked = useMemo(() => (modelPick === null ? models : pickedModels(models, modelPick)), [models, modelPick]);
  const checkedCount = picked.length;
  const nothingChecked = picksList && checkedCount === 0;

  const pick = useMemo<ModelPick>(() => {
    if (mode === "discovery") return {};
    if (mode === "single") return selectedModel ? { model: selectedModel } : {};
    return modelPick === null ? {} : pickFromChecked(models, picked.map((m) => m.id));
  }, [mode, selectedModel, modelPick, models, picked]);
  const pickKey = JSON.stringify(pick);

  function closeModelDropdown() {
    setModelDropdownOpen(false);
    modelTriggerRef.current?.focus();
  }

  async function handleSetup(undo: boolean) {
    setConfirmUndo(false);
    setApplying(undo ? "undo" : "apply");
    setSetupError(null);
    try {
      const res = await applyHarness(selectedAdapterId, undo ? { undo } : pick);
      setSetupResult(res);
      if (res.harness) {
        const status = res.harness.status;
        setAdapters((list) => list.map((a) => (a.id === selectedAdapterId ? { ...a, status } : a)));
      }
    } catch (err) {
      setSetupResult(null);
      setSetupError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setApplying(null);
    }
  }

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

  useEffect(() => {
    if (!selectedAdapterId || nothingChecked) return;

    let isMounted = true;
    async function fetchRender() {
      setRendering(true);
      setRenderError(null);
      try {
        const res = await renderAdapter(selectedAdapterId, pick);
        if (isMounted) setRenderData(res);
      } catch (err) {
        if (!isMounted) return;
        setRenderData(null);
        const message = err instanceof Error ? err.message : "Failed to render the config";
        // the daemon refreshed its catalog after this page loaded; reload the list instead of waiting for the next poll
        if (message.startsWith("unknown or unavailable model") && onCatalogStale) {
          setRenderError("The model list just changed. Loading the new one...");
          onCatalogStale();
        } else {
          setRenderError(message);
        }
      } finally {
        if (isMounted) setRendering(false);
      }
    }

    fetchRender();
    return () => {
      isMounted = false;
    };
  }, [selectedAdapterId, pickKey, nothingChecked]);

  const cliCommand = setupCommand(selectedAdapterId, pick);
  const strategy = mode === "single" && selectedModel ? null : getHarnessStrategy(mode, checkedCount);
  const modelFieldLabel = { list: "Models to add", tiered: "Models for Haiku, Sonnet and Opus", single: "Default model (optional)", discovery: "Models" }[mode];
  const modelTriggerText = modelPick === null
    ? `All models (${models.length})`
    : checkedCount === 0
      ? "No models selected"
      : checkedCount === 1
        ? picked[0]!.id
        : `${checkedCount} of ${models.length} models`;

  async function handleCopyCli() {
    if (nothingChecked) return;
    try {
      await navigator.clipboard.writeText(cliCommand);
      setCopiedCli(true);
      setTimeout(() => setCopiedCli(false), 2000);
    } catch {
      // Clipboard write failed (e.g. permission denied or unfocused document)
    }
  }

  async function handleCopyConfig(content: string, index: number) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedConfigIndex(index);
      setTimeout(() => setCopiedConfigIndex((curr) => (curr === index ? null : curr)), 2000);
    } catch {
      // Clipboard write failed (e.g. permission denied or unfocused document)
    }
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0">
                <Wrench className="h-4 w-4" />
              </div>
              <h2 className="text-sm sm:text-base font-bold text-white tracking-tight">
                Coding Agent Setup (Harness)
              </h2>
              <span className="text-[10px] sm:text-[11px] px-2 py-0.5 rounded-full bg-[#202028] text-emerald-400 border border-emerald-800/40 font-mono shrink-0">
                {adapters.length > 0 ? `${adapters.length} Agents Supported` : "Agents Supported"}
              </span>
            </div>
            <p className="text-xs text-[#9393a0]">
              Generate 1-click terminal setup commands and configuration files for your AI coding agents.
            </p>
          </div>

          <div className="flex items-center gap-2 self-stretch sm:self-auto justify-between sm:justify-end shrink-0">
            <div className="text-left sm:text-right">
              <div className="text-[10px] text-[#71717a] uppercase font-mono tracking-wider">Local API Endpoint</div>
              <div className="text-xs font-mono text-emerald-400">http://127.0.0.1:{daemonPort}/v1</div>
            </div>
          </div>
        </div>
      </div>

      {/* Configuration */}
      <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#23232a] pb-3">
          <div>
            <span className="text-xs font-bold text-white tracking-tight uppercase">
              Agent & Model Configuration
            </span>
            <p className="text-[11px] text-[#71717a]">
              Pick your coding agent, then which models bansos writes into its config.
            </p>
          </div>

          {activeAdapter && (
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap self-start sm:self-auto">
              <span className="text-[11px] font-mono text-[#71717a] hidden sm:inline">
                API Protocol:
              </span>
              <span className={`text-[10px] sm:text-[11px] px-2 sm:px-2.5 py-0.5 rounded-full border font-medium ${getWireBadge(activeAdapter.wire).color}`}>
                {getWireBadge(activeAdapter.wire).label}
              </span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 items-start">
          {/* Target Harness */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-[#8b8b96]">
                Coding Agent / Tool
              </span>
              <span className="text-[10px] sm:text-[11px] font-mono text-[#71717a]">
                {adapters.length} available
              </span>
            </div>

            <div
              className="relative"
              onKeyDown={(e) => {
                if (e.key === "Escape" && adapterDropdownOpen) {
                  setAdapterDropdownOpen(false);
                  adapterTriggerRef.current?.focus();
                }
              }}
            >
              <button
                ref={adapterTriggerRef}
                type="button"
                aria-expanded={adapterDropdownOpen}
                onClick={() => {
                  setAdapterDropdownOpen(!adapterDropdownOpen);
                  setModelDropdownOpen(false);
                }}
                className="w-full min-h-10.5 flex items-center justify-between bg-[#121215] hover:bg-[#18181d] border border-[#262630] hover:border-[#383846] rounded-lg px-3 py-2 text-xs font-medium text-white transition cursor-pointer"
              >
                <div className="flex items-center gap-2 truncate">
                  <Code2 className="h-4 w-4 text-[#60a5fa] shrink-0" />
                  <span className="truncate">
                    {activeAdapter ? activeAdapter.name : "Select Agent..."}
                  </span>
                  {activeAdapter && (
                    <span className="text-[10px] font-mono uppercase text-[#71717a] ml-1 shrink-0">
                      ({activeAdapter.wire})
                    </span>
                  )}
                </div>
                <ChevronDown className={`h-3.5 w-3.5 text-[#71717a] shrink-0 transition-transform duration-150 ${adapterDropdownOpen ? "rotate-180" : ""}`} />
              </button>

              {adapterDropdownOpen && (
                <AgentAdapterSelector
                  adapters={adapters}
                  selectedAdapterId={selectedAdapterId}
                  onSelectAdapter={setSelectedAdapterId}
                  onClose={() => setAdapterDropdownOpen(false)}
                  searchQuery={adapterSearchQuery}
                  onSearchChange={setAdapterSearchQuery}
                />
              )}
            </div>
          </div>

          {/* Models */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-[#8b8b96]">
                {modelFieldLabel}
              </span>
              {mode !== "discovery" && (
                <span className="text-[10px] sm:text-[11px] font-mono text-[#9393a0]">
                  {models.length} available
                </span>
              )}
            </div>

            {mode === "discovery" ? (
              <p className="min-h-10.5 flex items-center rounded-lg border border-dashed border-[#2e2e38] px-3 py-2 text-xs text-[#9393a0]">
                {activeAdapter?.name ?? "This agent"} lists the live models from /v1/models itself, so there is nothing to pick here.
              </p>
            ) : (
              <div
                className="relative"
                onKeyDown={(e) => {
                  if (e.key === "Escape" && modelDropdownOpen) closeModelDropdown();
                }}
              >
                <button
                  ref={modelTriggerRef}
                  type="button"
                  aria-expanded={modelDropdownOpen}
                  aria-haspopup="dialog"
                  onClick={() => {
                    setModelDropdownOpen(!modelDropdownOpen);
                    setAdapterDropdownOpen(false);
                  }}
                  className={`w-full min-h-10.5 flex items-center justify-between bg-[#121215] hover:bg-[#18181d] border rounded-lg px-3 py-2 text-xs font-medium text-white transition cursor-pointer ${
                    nothingChecked ? "border-rose-500" : "border-[#262630] hover:border-[#383846]"
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <Cpu className="h-3.5 w-3.5 text-[#9393a0] shrink-0" />
                    <span className="truncate font-mono">
                      {picksList ? modelTriggerText : selectedModel || "Auto (catalog default)"}
                    </span>
                  </div>
                  <ChevronDown className={`h-3.5 w-3.5 text-[#9393a0] shrink-0 transition-transform duration-150 ${modelDropdownOpen ? "rotate-180" : ""}`} />
                </button>

                {modelDropdownOpen && picksList && (
                  <AgentModelChecklist
                    models={models}
                    checked={modelPick}
                    onChange={setModelPick}
                    onClose={closeModelDropdown}
                    searchQuery={modelSearchQuery}
                    onSearchChange={setModelSearchQuery}
                  />
                )}
                {modelDropdownOpen && !picksList && (
                  <AgentModelSelector
                    models={models}
                    selectedModel={selectedModel}
                    onSelectModel={setSelectedModel}
                    onClose={closeModelDropdown}
                    searchQuery={modelSearchQuery}
                    onSearchChange={setModelSearchQuery}
                  />
                )}
              </div>
            )}
            {nothingChecked && (
              <p className="text-[11px] text-rose-300 flex items-center gap-1.5">
                <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                Pick at least one model, or check All models.
              </p>
            )}
            {mode === "tiered" && !nothingChecked && (
              <p className="text-[11px] text-[#9393a0]">Haiku gets the fastest model you check; Sonnet and Opus get reasoning models.</p>
            )}
          </div>
        </div>
      </div>

      {/* Setup & Config */}
      <div className="space-y-4">
        {/* Terminal setup */}
        <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-4 sm:p-5 shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-[#3b82f6] shrink-0" />
              <span className="text-xs font-bold text-white tracking-tight">
                1-Click Terminal Setup
              </span>
            </div>
            <span className="text-[10px] sm:text-[11px] font-mono text-[#71717a]">
              Automatically updates agent config without overwriting your custom keys
            </span>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={handleCopyCli}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleCopyCli();
              }
            }}
            className="flex items-center justify-between gap-2.5 p-2.5 sm:p-3 rounded-lg bg-[#111113] border border-[#23232a] hover:border-[#383846] transition cursor-pointer group min-w-0 w-full"
            title="Click to copy terminal command"
          >
            <code className={`text-xs font-mono truncate min-w-0 flex-1 ${nothingChecked ? "text-[#9393a0]" : "text-emerald-400 select-all"}`}>
              {nothingChecked ? "Pick at least one model first" : cliCommand}
            </code>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleCopyCli();
              }}
              className="shrink-0 flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md bg-[#202026] group-hover:bg-[#282832] active:bg-[#1a1a20] border border-[#2a2a34] text-xs font-medium text-white transition cursor-pointer shadow-xs"
              title="Copy terminal command"
            >
              {copiedCli ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span className="text-emerald-400 font-semibold text-xs">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-[#a1a1aa] shrink-0" />
                  <span className="text-xs">Copy</span>
                </>
              )}
            </button>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-[#23232a]">
            <div className="text-[11px] text-[#9393a0] min-w-0">
              {activeAdapter?.status === "configured" ? (
                <span className="text-emerald-400">{activeAdapter.name} already points at bansos.</span>
              ) : activeAdapter?.status === "unconfigured" ? (
                <span className="text-amber-300">{activeAdapter.name} has a config file, but bansos is not in it yet.</span>
              ) : (
                <span>Or let bansos write the config for you on the machine it runs on.</span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {confirmUndo ? (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirmUndo(false)}
                    className="px-3 min-h-9 rounded-md bg-[#202026] border border-[#2e2e38] text-xs text-[#d4d4d8] hover:text-white cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSetup(true)}
                    className="px-3 min-h-9 rounded-md bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white cursor-pointer"
                  >
                    Remove bansos config
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirmUndo(true)}
                    disabled={applying !== null || activeAdapter?.status === "missing"}
                    className="inline-flex items-center gap-1.5 px-3 min-h-9 rounded-md bg-[#202026] hover:bg-[#282832] border border-[#2e2e38] text-xs font-medium text-[#d4d4d8] hover:text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {applying === "undo" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                    <span>Undo</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSetup(false)}
                    disabled={applying !== null || !activeAdapter || nothingChecked}
                    className="inline-flex items-center gap-1.5 px-3 min-h-9 rounded-md bg-[#2b64e0] hover:bg-[#3a72ec] text-xs font-semibold text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {applying === "apply" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    <span>{activeAdapter?.status === "configured" ? "Apply again" : "Apply"}</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {setupError && (
            <p className="text-xs text-rose-300 flex items-center gap-1.5">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
              {setupError}
            </p>
          )}

          {setupResult && (
            <ul className="rounded-lg bg-[#111113] border border-[#23232a] p-3 space-y-1 text-[11px] font-mono">
              {setupResult.lines.length === 0 && <li className="text-[#71717a]">Nothing to change.</li>}
              {setupResult.lines.map((line, i) => (
                <li
                  key={i}
                  className={`break-all ${
                    line.kind === "ok"
                      ? "text-emerald-400"
                      : line.kind === "error"
                        ? "text-rose-300"
                        : line.kind === "removed"
                          ? "text-amber-200"
                          : "text-[#9393a0]"
                  }`}
                >
                  {line.kind === "ok" ? "✓" : line.kind === "skip" ? "·" : "✗"} {line.text}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Generated config files */}
        <AgentConfigViewer
          renderData={nothingChecked ? null : renderData}
          rendering={rendering && !nothingChecked}
          error={nothingChecked ? "Pick at least one model to see the config bansos would write." : renderError}
          activeAdapter={activeAdapter}
          strategy={strategy}
          copiedConfigIndex={copiedConfigIndex}
          onCopyConfig={handleCopyConfig}
          selectedAdapterId={selectedAdapterId}
        />
      </div>
    </div>
  );
}
