import { useState, useRef, useEffect, useMemo } from "preact/hooks";
import type { ModelItem, WireProtocol } from "../../types";
import {
  MessageSquare,
  Copy,
  Check,
  Sliders,
  Trash2,
  Download,
  Maximize2,
  Minimize2,
  Code2,
} from "lucide-preact";
import { exportChatToFile, getEndpointLabel } from "../../utils/playground";
import { groupModelsByProvider } from "../../utils/agent";
import { PlaygroundParameters } from "./PlaygroundParameters";
import { PlaygroundSidebar } from "./PlaygroundSidebar";
import { PlaygroundMessageList } from "./PlaygroundMessageList";
import { PlaygroundRawViewer } from "./PlaygroundRawViewer";
import { PlaygroundInput } from "./PlaygroundInput";
import { usePlaygroundChat } from "../../hooks/usePlaygroundChat";

interface PlaygroundProps {
  models: ModelItem[];
  daemonPort: number;
}

export function Playground({ models, daemonPort }: PlaygroundProps) {
  const [selectedProtocol, setSelectedProtocol] = useState<WireProtocol>("chat");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState("");

  const [systemPrompt, setSystemPrompt] = useState("");
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);

  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [reasoningEffort, setReasoningEffort] = useState<"auto" | "low" | "medium" | "high">("auto");
  const [stream, setStream] = useState(true);
  const [noFailover, setNoFailover] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [activeViewTab, setActiveViewTab] = useState<"rendered" | "raw">("rendered");
  const [copiedMsgIdx, setCopiedMsgIdx] = useState<number | null>(null);
  const [copiedRaw, setCopiedRaw] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  const {
    userPrompt,
    setUserPrompt,
    messages,
    isLoading,
    liveReasoning,
    liveContent,
    openReasoningMap,
    rawPayload,
    rawChunks,
    globalError,
    pendingModel,
    pendingProtocol,
    handleSendMessage,
    handleStop,
    handleClearChat,
    toggleReasoning,
  } = usePlaygroundChat({
    models,
    selectedModel,
    selectedProtocol,
    systemPrompt,
    temperature,
    maxTokens,
    reasoningEffort,
    stream,
    noFailover,
  });

  useEffect(() => {
    if (!selectedModel && models.length > 0) {
      const preferred = models.find(
        (m) =>
          m.id === "tencent/hy3:free" ||
          m.id === "hy3-free" ||
          m.id === "nemotron-3-ultra-free" ||
          m.reasoning
      );
      setSelectedModel(preferred?.id || models[0]?.id || "");
    }
  }, [models, selectedModel]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, liveContent, liveReasoning]);

  const activeModelObj = useMemo(() => {
    return models.find((m) => m.id === selectedModel);
  }, [models, selectedModel]);

  const filteredModels = useMemo(() => {
    if (!modelSearchQuery.trim()) return models;
    const q = modelSearchQuery.toLowerCase();
    return models.filter((m) => m.id.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q));
  }, [models, modelSearchQuery]);

  const groupedModels = useMemo(() => groupModelsByProvider(filteredModels), [filteredModels]);

  async function handleCopyMessage(content: string, idx: number) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMsgIdx(idx);
      setTimeout(() => setCopiedMsgIdx((curr) => (curr === idx ? null : curr)), 2000);
    } catch {
      // Clipboard write failed
    }
  }

  async function handleCopyRaw(customText?: string) {
    const textToCopy = customText ?? rawPayload;
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedRaw(true);
      setTimeout(() => setCopiedRaw(false), 2000);
    } catch {
      // Clipboard write failed
    }
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 sm:gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shrink-0">
                <MessageSquare className="h-4 w-4" />
              </div>
              <h2 className="text-sm sm:text-base font-bold text-white tracking-tight">
                Model Playground
              </h2>
              <span className="text-[10px] sm:text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-950/60 text-emerald-400 border border-emerald-800/40 font-mono shrink-0">
                Live Session
              </span>
            </div>
            <p className="text-xs text-[#9393a0]">
              Chat with models, experiment with prompts, and inspect live responses.
            </p>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap w-full sm:w-auto justify-start sm:justify-end">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => exportChatToFile(messages, "markdown", selectedModel, selectedProtocol)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#202028] hover:bg-[#282834] border border-[#2c2c36] text-xs font-medium text-[#d4d4d8] hover:text-white transition cursor-pointer shrink-0"
                title="Export conversation as Markdown"
              >
                <Download className="h-3.5 w-3.5 shrink-0" />
                <span>Export (Markdown)</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowSettings(!showSettings)}
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border text-xs font-medium transition cursor-pointer shrink-0 ${
                showSettings
                  ? "bg-[#2b64e0]/15 text-[#60a5fa] border-[#2b64e0]/40"
                  : "bg-[#202028] text-[#d4d4d8] border-[#2c2c36] hover:text-white"
              }`}
            >
              <Sliders className="h-3.5 w-3.5 shrink-0" />
              <span>Parameters</span>
            </button>
            <button
              type="button"
              onClick={handleClearChat}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-[#202028] hover:bg-[#282834] active:bg-[#1a1a20] border border-[#2c2c36] text-xs font-medium text-[#d4d4d8] hover:text-white transition cursor-pointer shrink-0"
              title="Clear all messages and start a new conversation"
            >
              <Trash2 className="h-3.5 w-3.5 shrink-0" />
              <span>New Chat</span>
            </button>
          </div>
        </div>

        {/* Expandable Parameters Bar */}
        {showSettings && (
          <PlaygroundParameters
            temperature={temperature}
            onTemperatureChange={setTemperature}
            maxTokens={maxTokens}
            onMaxTokensChange={setMaxTokens}
            reasoningEffort={reasoningEffort}
            onReasoningEffortChange={setReasoningEffort}
            stream={stream}
            onStreamChange={setStream}
            noFailover={noFailover}
            onNoFailoverChange={setNoFailover}
          />
        )}
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
        {/* Left Side: Model Selector, Protocol & System Instructions */}
        <PlaygroundSidebar
          models={models}
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
          activeModelObj={activeModelObj}
          modelDropdownOpen={modelDropdownOpen}
          onToggleModelDropdown={() => setModelDropdownOpen(!modelDropdownOpen)}
          onCloseModelDropdown={() => setModelDropdownOpen(false)}
          modelSearchQuery={modelSearchQuery}
          onModelSearchQueryChange={setModelSearchQuery}
          groupedModels={groupedModels}
          selectedProtocol={selectedProtocol}
          onSelectProtocol={setSelectedProtocol}
          getEndpointLabel={getEndpointLabel}
          showSystemPrompt={showSystemPrompt}
          onToggleSystemPrompt={() => setShowSystemPrompt(!showSystemPrompt)}
          systemPrompt={systemPrompt}
          onSystemPromptChange={setSystemPrompt}
          daemonPort={daemonPort}
          messageCount={messages.length}
        />

        {/* Right Side: Chat & Streaming */}
        <div className={`space-y-4 ${isFullscreen ? "fixed inset-0 z-50 p-3 sm:p-6 bg-[#111113]/95 backdrop-blur-md flex flex-col" : "lg:col-span-8"}`}>
          <div className={`rounded-xl border border-[#23232a] bg-[#16161a] overflow-hidden shadow-xs flex flex-col ${isFullscreen ? "flex-1 min-h-0" : "h-[620px] sm:h-[680px] max-h-[85vh]"}`}>
            {/* Tabs & view toggle */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 sm:px-4 py-2 sm:py-3 border-b border-[#23232a] bg-[#121215] shrink-0">
              <div className="flex items-center gap-1 bg-[#1a1a20] p-0.5 sm:p-1 rounded-lg border border-[#262630]">
                <button
                  type="button"
                  onClick={() => setActiveViewTab("rendered")}
                  className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded text-[11px] sm:text-xs font-medium transition cursor-pointer ${
                    activeViewTab === "rendered"
                      ? "bg-[#2b64e0] text-white"
                      : "text-[#9393a0] hover:text-white"
                  }`}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                  <span>Conversation</span>
                  {messages.length > 0 && (
                    <span className="text-[10px] px-1 rounded bg-[#162038] font-mono text-[#60a5fa]">
                      {messages.length}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveViewTab("raw")}
                  className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded text-[11px] sm:text-xs font-medium transition cursor-pointer ${
                    activeViewTab === "raw"
                      ? "bg-[#2b64e0] text-white"
                      : "text-[#9393a0] hover:text-white"
                  }`}
                >
                  <Code2 className="h-3.5 w-3.5 shrink-0" />
                  <span>Raw SSE / JSON</span>
                  {rawChunks.length > 0 && (
                    <span className="text-[10px] px-1 rounded bg-[#262630] font-mono text-[#a1a1aa]">
                      {rawChunks.length}
                    </span>
                  )}
                </button>
              </div>

              <div className="flex items-center gap-1.5 sm:gap-2">
                {activeViewTab === "raw" && rawChunks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => handleCopyRaw(rawChunks.join("\n\n"))}
                    className="inline-flex items-center gap-1 text-[11px] sm:text-xs text-[#a1a1aa] hover:text-white px-2 py-1 rounded bg-[#1c1c22] border border-[#282832] transition cursor-pointer shrink-0"
                  >
                    {copiedRaw ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400 shrink-0" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3 shrink-0" />
                        <span>Copy Chunks</span>
                      </>
                    )}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setIsFullscreen(!isFullscreen)}
                  className="inline-flex items-center gap-1 text-[11px] sm:text-xs text-[#a1a1aa] hover:text-white px-2 py-1 rounded bg-[#1c1c22] hover:bg-[#23232a] border border-[#282832] transition cursor-pointer shrink-0"
                  title={isFullscreen ? "Exit Fullscreen" : "Fullscreen Chat"}
                  aria-label={isFullscreen ? "Exit Fullscreen" : "Fullscreen Chat"}
                >
                  {isFullscreen ? (
                    <>
                      <Minimize2 className="h-3.5 w-3.5 shrink-0" />
                      <span className="hidden sm:inline">Exit Fullscreen</span>
                    </>
                  ) : (
                    <>
                      <Maximize2 className="h-3.5 w-3.5 shrink-0" />
                      <span className="hidden sm:inline">Fullscreen</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Message stream */}
            <div className="flex-1 p-3 sm:p-4 overflow-y-auto min-h-0 flex flex-col font-mono text-xs">
              {activeViewTab === "rendered" ? (
                <PlaygroundMessageList
                  messages={messages}
                  isLoading={isLoading}
                  selectedModel={selectedModel}
                  pendingModel={pendingModel}
                  pendingProtocol={pendingProtocol}
                  liveReasoning={liveReasoning}
                  liveContent={liveContent}
                  globalError={globalError}
                  openReasoningMap={openReasoningMap}
                  onToggleReasoning={toggleReasoning}
                  copiedMsgIdx={copiedMsgIdx}
                  onCopyMessage={handleCopyMessage}
                />
              ) : (
                <PlaygroundRawViewer rawPayload={rawPayload} rawChunks={rawChunks} />
              )}
              <div ref={chatBottomRef} />
            </div>

            {/* Prompt input */}
            <PlaygroundInput
              userPrompt={userPrompt}
              onUserPromptChange={setUserPrompt}
              onSubmit={handleSendMessage}
              onStop={handleStop}
              isLoading={isLoading}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
