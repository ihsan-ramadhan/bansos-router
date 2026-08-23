import { useState, useRef, useEffect, useMemo } from "preact/hooks";
import type { ModelItem, ChatMessage, CompletionMetrics } from "../types/ui";
import {
  MessageSquare,
  Sparkles,
  Send,
  Square,
  Copy,
  Check,
  Sliders,
  ChevronDown,
  ChevronRight,
  Search,
  Code2,
  Terminal,
  AlertCircle,
  Zap,
  Trash2,
  Bot,
  User,
} from "lucide-preact";

interface PlaygroundProps {
  models: ModelItem[];
  daemonPort: number;
}

// Helper for non-streaming completions
async function handleNonStreamCompletion(
  res: Response,
  startTime: number,
  setMessages: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void,
  setRawChunks: (chunks: string[]) => void
) {
  const data = await res.json();
  const endTime = performance.now();
  const totalMs = Math.round(endTime - startTime);

  const choice = data.choices?.[0];
  const content = choice?.message?.content || "";
  const reasoning = choice?.message?.reasoning_content || "";
  const usage = data.usage;

  const metrics: CompletionMetrics = {
    ttftMs: totalMs,
    totalMs,
    promptTokens: usage?.prompt_tokens,
    completionTokens: usage?.completion_tokens,
    totalTokens: usage?.total_tokens,
    tokenCount: usage?.completion_tokens ?? content.split(/\s+/).filter(Boolean).length,
    tokensPerSec: usage?.completion_tokens
      ? Math.round((usage.completion_tokens / (totalMs / 1000)) * 10) / 10
      : undefined,
  };

  setMessages((prev) => [
    ...prev,
    {
      role: "assistant",
      content,
      reasoning: reasoning || undefined,
      metrics,
    },
  ]);

  setRawChunks([JSON.stringify(data, null, 2)]);
}

function buildApiMessages(
  history: ChatMessage[],
  systemPrompt: string
): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt.trim()) {
    messages.push({ role: "system", content: systemPrompt.trim() });
  }
  for (const m of history) {
    messages.push({ role: m.role, content: m.content });
  }
  return messages;
}

async function parseErrorText(res: Response): Promise<string> {
  const errText = await res.text();
  let errMsg = `HTTP ${res.status}: ${res.statusText}`;
  try {
    const parsed = JSON.parse(errText) as { error?: { message?: string } };
    if (parsed.error?.message) errMsg = parsed.error.message;
  } catch {
    if (errText) errMsg = errText;
  }
  return errMsg;
}

interface StreamChunkContext {
  callbacks: {
    setLiveContent: (text: string) => void;
    setLiveReasoning: (text: string) => void;
    setRawChunks: (updater: (prev: string[]) => string[]) => void;
  };
  state: {
    firstTokenTime: number | null;
    tokenCount: number;
    accumulatedContent: string;
    accumulatedReasoning: string;
  };
}

function processStreamDataChunk(dataStr: string, ctx: StreamChunkContext) {
  ctx.callbacks.setRawChunks((prev) => [...prev, dataStr]);
  if (dataStr === "[DONE]") return;

  try {
    const chunk = JSON.parse(dataStr);
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return;

    ctx.state.firstTokenTime ??= performance.now();

    if (delta.reasoning_content) {
      ctx.state.accumulatedReasoning += delta.reasoning_content;
      ctx.callbacks.setLiveReasoning(ctx.state.accumulatedReasoning);
    }

    if (delta.content) {
      ctx.state.accumulatedContent += delta.content;
      ctx.callbacks.setLiveContent(ctx.state.accumulatedContent);
      ctx.state.tokenCount += 1;
    }
  } catch {
    // Ignore partial chunk parse error
  }
}

// Helper for streaming SSE completions
async function handleStreamCompletion(
  res: Response,
  startTime: number,
  callbacks: {
    setLiveContent: (text: string) => void;
    setLiveReasoning: (text: string) => void;
    setRawChunks: (updater: (prev: string[]) => string[]) => void;
    setMessages: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
  }
) {
  if (!res.body) {
    throw new Error("Response body is empty");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const ctx: StreamChunkContext = {
    callbacks,
    state: {
      firstTokenTime: null,
      tokenCount: 0,
      accumulatedContent: "",
      accumulatedReasoning: "",
    },
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":")) continue;

      if (trimmed.startsWith("data:")) {
        processStreamDataChunk(trimmed.slice(5).trim(), ctx);
      }
    }
  }

  callbacks.setMessages((prev) => [...prev, buildStreamMessage(ctx, startTime)]);
  callbacks.setLiveContent("");
  callbacks.setLiveReasoning("");
}

function buildStreamMessage(
  ctx: StreamChunkContext,
  startTime: number
): ChatMessage {
  const endTime = performance.now();
  const totalMs = Math.round(endTime - startTime);
  const ttftMs = ctx.state.firstTokenTime ? Math.round(ctx.state.firstTokenTime - startTime) : totalMs;

  let finalOutput = ctx.state.accumulatedContent;
  let finalReasoning = ctx.state.accumulatedReasoning;

  const thinkExec = /^<think>([\s\S]*?)<\/think>\s*/.exec(finalOutput);
  if (thinkExec?.[1]) {
    finalReasoning = (finalReasoning ? finalReasoning + "\n" : "") + thinkExec[1].trim();
    finalOutput = finalOutput.replace(/^<think>[\s\S]*?<\/think>\s*/, "");
  }

  const finalTokenCount = ctx.state.tokenCount > 0 ? ctx.state.tokenCount : finalOutput.split(/\s+/).filter(Boolean).length;
  const speedDuration = (totalMs - ttftMs) / 1000;
  const tokensPerSec = speedDuration > 0.05 ? Math.round((finalTokenCount / speedDuration) * 10) / 10 : undefined;

  return {
    role: "assistant",
    content: finalOutput,
    reasoning: finalReasoning || undefined,
    metrics: { ttftMs, totalMs, tokenCount: finalTokenCount, tokensPerSec },
  };
}

export function Playground({ models, daemonPort }: PlaygroundProps) {
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState("");

  const [systemPrompt, setSystemPrompt] = useState("");
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);

  const [userPrompt, setUserPrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [stream, setStream] = useState(true);
  const [noFailover, setNoFailover] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [liveReasoning, setLiveReasoning] = useState("");
  const [liveContent, setLiveContent] = useState("");
  const [openReasoningMap, setOpenReasoningMap] = useState<Record<number, boolean>>({});
  const [rawPayload, setRawPayload] = useState<string | null>(null);
  const [rawChunks, setRawChunks] = useState<string[]>([]);
  const [activeViewTab, setActiveViewTab] = useState<"rendered" | "raw">("rendered");
  const [globalError, setGlobalError] = useState<string | null>(null);

  const [copiedMsgIdx, setCopiedMsgIdx] = useState<number | null>(null);
  const [copiedRaw, setCopiedRaw] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selectedModel && models.length > 0 && models[0]) {
      setSelectedModel(models[0].id);
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

  function handleStop() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
  }

  function handleClearChat() {
    handleStop();
    setMessages([]);
    setLiveContent("");
    setLiveReasoning("");
    setRawChunks([]);
    setRawPayload(null);
    setGlobalError(null);
    setOpenReasoningMap({});
  }

  function toggleReasoning(idx: number) {
    setOpenReasoningMap((prev) => ({
      ...prev,
      [idx]: prev[idx] === undefined ? false : !prev[idx],
    }));
  }

  async function handleCopyMessage(text: string, idx: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMsgIdx(idx);
      setTimeout(() => setCopiedMsgIdx(null), 2000);
    } catch {
      // Ignore clipboard write failures
    }
  }

  async function handleCopyRaw(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedRaw(true);
      setTimeout(() => setCopiedRaw(false), 2000);
    } catch {
      // Ignore clipboard write failures
    }
  }

  // Send message and append to session history
  async function handleSendMessage(e?: Event) {
    if (e) e.preventDefault();
    const promptToSend = userPrompt.trim();
    if (!promptToSend || isLoading) return;

    handleStop();
    setIsLoading(true);
    setGlobalError(null);
    setLiveContent("");
    setLiveReasoning("");
    setRawChunks([]);

    // Add User message to history
    const updatedMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: promptToSend },
    ];
    setMessages(updatedMessages);
    setUserPrompt("");

    // Prepare payload
    const apiMessages = buildApiMessages(updatedMessages, systemPrompt);

    const payload = {
      model: selectedModel || models[0]?.id || "tencent/hy3:free",
      messages: apiMessages,
      temperature,
      max_tokens: maxTokens,
      stream,
    };

    setRawPayload(JSON.stringify(payload, null, 2));

    const startTime = performance.now();
    let firstTokenTime: number | null = null;
    let tokenCount = 0;
    let accumulatedContent = "";
    let accumulatedReasoning = "";

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (noFailover) {
        headers["x-bansos-no-failover"] = "1";
      }

      const res = await fetch("/v1/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(await parseErrorText(res));
      }

      if (!stream) {
        await handleNonStreamCompletion(res, startTime, setMessages, setRawChunks);
        setIsLoading(false);
        return;
      }

      await handleStreamCompletion(res, startTime, {
        setLiveContent,
        setLiveReasoning,
        setRawChunks,
        setMessages,
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        const errorMsg = err instanceof Error ? err.message : "Completion request failed";
        setGlobalError(errorMsg);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: accumulatedContent || "Failed to generate response.",
            reasoning: accumulatedReasoning || undefined,
            error: errorMsg,
          },
        ]);
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-5 shadow-sm">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                <MessageSquare className="h-4 w-4" />
              </div>
              <h2 className="text-base font-bold text-white tracking-tight">
                Live Chat Playground
              </h2>
              <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-950/60 text-emerald-400 border border-emerald-800/40 font-mono">
                Multi-Turn Session
              </span>
            </div>
            <p className="text-xs text-[#9393a0]">
              Test continuous chat conversations with context retention, monitor TTFT/streaming speeds, and verify live responses.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSettings(!showSettings)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition cursor-pointer ${
                showSettings
                  ? "bg-[#2b64e0]/15 text-[#60a5fa] border-[#2b64e0]/40"
                  : "bg-[#202028] text-[#d4d4d8] border-[#2c2c36] hover:text-white"
              }`}
            >
              <Sliders className="h-3.5 w-3.5" />
              <span>Parameters</span>
            </button>
            <button
              type="button"
              onClick={handleClearChat}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#202028] hover:bg-[#282834] active:bg-[#1a1a20] border border-[#2c2c36] text-xs font-medium text-[#d4d4d8] hover:text-white transition cursor-pointer"
              title="Clear all messages and start fresh chat"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>New Chat</span>
            </button>
          </div>
        </div>

        {/* Expandable Parameters Bar */}
        {showSettings && (
          <div className="mt-4 pt-4 border-t border-[#23232a] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            <div>
              <div className="flex justify-between text-[#a1a1aa] mb-1.5">
                <span>Temperature</span>
                <span className="font-mono text-white font-medium">{temperature}</span>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="0.05"
                value={temperature}
                onChange={(e) => setTemperature(Number.parseFloat((e.target as HTMLInputElement).value))}
                className="w-full h-1.5 bg-[#202028] rounded-lg appearance-none cursor-pointer accent-[#2b64e0]"
              />
            </div>

            <div>
              <div className="flex justify-between text-[#a1a1aa] mb-1.5">
                <span>Max Output Tokens</span>
                <span className="font-mono text-white font-medium">{maxTokens}</span>
              </div>
              <input
                type="number"
                min="1"
                max="16384"
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number.parseInt((e.target as HTMLInputElement).value, 10) || 2048)}
                className="w-full px-2.5 py-1 bg-[#121215] border border-[#262630] rounded-lg text-xs font-mono text-white focus:outline-none focus:border-[#2b64e0]"
              />
            </div>

            <div className="flex items-center justify-between sm:justify-start gap-3 pt-4 sm:pt-3">
              <span className="text-[#a1a1aa]">Stream SSE</span>
              <button
                type="button"
                onClick={() => setStream(!stream)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  stream ? "bg-emerald-500" : "bg-[#282832]"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    stream ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between sm:justify-start gap-3 pt-4 sm:pt-3">
              <span className="text-[#a1a1aa]">No Failover (Direct)</span>
              <button
                type="button"
                onClick={() => setNoFailover(!noFailover)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  noFailover ? "bg-amber-500" : "bg-[#282832]"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    noFailover ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Side: Model Selector & System Instructions */}
        <div className="lg:col-span-4 space-y-4">
          <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-4 shadow-sm space-y-4">
            {/* Model Selector Dropdown */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-semibold text-[#8b8b96] uppercase tracking-wider block">
                Active Model
              </span>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                  className="w-full flex items-center justify-between bg-[#121215] hover:bg-[#18181d] border border-[#262630] hover:border-[#383846] rounded-lg px-3 py-2 text-xs font-mono text-white transition cursor-pointer"
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="font-semibold">{selectedModel || "Select Model..."}</span>
                    {activeModelObj?.reasoning && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.2 rounded bg-emerald-950/70 text-emerald-300 border border-emerald-800/40">
                        <Sparkles className="h-2.5 w-2.5" /> Think
                      </span>
                    )}
                  </div>
                  <ChevronDown className={`h-3.5 w-3.5 text-[#71717a] transition-transform duration-150 ${modelDropdownOpen ? "rotate-180" : ""}`} />
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
                    <div className="absolute left-0 right-0 mt-1.5 max-h-64 rounded-xl bg-[#16161a] border border-[#282832] shadow-2xl z-30 flex flex-col overflow-hidden">
                      <div className="p-2 border-b border-[#23232a]">
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#71717a]" />
                          <input
                            type="text"
                            value={modelSearchQuery}
                            onInput={(e) => setModelSearchQuery((e.target as HTMLInputElement).value)}
                            placeholder="Filter models..."
                            className="w-full pl-8 pr-3 py-1.5 bg-[#121215] border border-[#262630] rounded-md text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-[#2b64e0]"
                          />
                        </div>
                      </div>

                      <div className="overflow-y-auto p-1 divide-y divide-[#202026]">
                        {filteredModels.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => {
                              setSelectedModel(m.id);
                              setModelDropdownOpen(false);
                            }}
                            className={`w-full text-left px-2.5 py-2 rounded-lg text-xs font-mono transition flex items-center justify-between cursor-pointer ${
                              selectedModel === m.id
                                ? "bg-[#2b64e0]/15 text-[#60a5fa] font-semibold"
                                : "text-[#d4d4d8] hover:bg-[#202028] hover:text-white"
                            }`}
                          >
                            <div className="flex flex-col truncate pr-2">
                              <span className="truncate">{m.id}</span>
                              {m.name && m.name !== m.id && (
                                <span className="text-[10px] text-[#71717a]">{m.name}</span>
                              )}
                            </div>
                            {m.reasoning && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-950/60 text-emerald-400 shrink-0">
                                Think
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Optional System Prompt Accordion */}
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => setShowSystemPrompt(!showSystemPrompt)}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-[#8b8b96] uppercase tracking-wider hover:text-white transition cursor-pointer"
              >
                {showSystemPrompt ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                <span>System Prompt (Optional)</span>
              </button>

              {showSystemPrompt && (
                <textarea
                  value={systemPrompt}
                  onInput={(e) => setSystemPrompt((e.target as HTMLTextAreaElement).value)}
                  placeholder="You are an expert AI assistant providing clear and accurate code solutions..."
                  rows={4}
                  className="w-full p-2.5 bg-[#121215] border border-[#262630] rounded-lg text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-[#2b64e0] transition font-mono"
                />
              )}
            </div>

            {/* Chat Session Info */}
            <div className="pt-2 border-t border-[#23232a] text-xs text-[#71717a] space-y-1">
              <div className="flex justify-between">
                <span>Daemon Endpoint</span>
                <span className="font-mono text-[#d4d4d8]">127.0.0.1:{daemonPort}</span>
              </div>
              <div className="flex justify-between">
                <span>Context Messages</span>
                <span className="font-mono text-[#60a5fa]">{messages.length} messages</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Chat & Streaming */}
        <div className="lg:col-span-8 space-y-4">
          <div className="rounded-xl border border-[#23232a] bg-[#16161a] overflow-hidden shadow-sm flex flex-col min-h-140">
            {/* Tabs & view toggle */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#23232a] bg-[#121215]">
              <div className="flex items-center gap-1 bg-[#1a1a20] p-1 rounded-lg border border-[#262630]">
                <button
                  type="button"
                  onClick={() => setActiveViewTab("rendered")}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition cursor-pointer ${
                    activeViewTab === "rendered"
                      ? "bg-[#2b64e0] text-white"
                      : "text-[#9393a0] hover:text-white"
                  }`}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
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
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition cursor-pointer ${
                    activeViewTab === "raw"
                      ? "bg-[#2b64e0] text-white"
                      : "text-[#9393a0] hover:text-white"
                  }`}
                >
                  <Code2 className="h-3.5 w-3.5" />
                  <span>Raw SSE / JSON</span>
                  {rawChunks.length > 0 && (
                    <span className="text-[10px] px-1 rounded bg-[#262630] font-mono text-[#a1a1aa]">
                      {rawChunks.length}
                    </span>
                  )}
                </button>
              </div>

              {activeViewTab === "raw" && rawChunks.length > 0 && (
                <button
                  type="button"
                  onClick={() => handleCopyRaw(rawChunks.join("\n\n"))}
                  className="inline-flex items-center gap-1 text-xs text-[#a1a1aa] hover:text-white px-2.5 py-1 rounded bg-[#1c1c22] border border-[#282832] transition cursor-pointer"
                >
                  {copiedRaw ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copy Chunks</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Message stream */}
            <div className="flex-1 p-4 overflow-y-auto max-h-125 space-y-4 font-mono text-xs">
              {activeViewTab === "rendered" ? (
                <>
                  {messages.length === 0 && !isLoading && (
                    <div className="h-72 flex flex-col items-center justify-center text-center text-[#71717a] space-y-2">
                      <Terminal className="h-8 w-8 text-[#3f3f46]" />
                      <span className="text-white font-medium">No messages yet</span>
                      <span className="text-xs max-w-xs">
                        Start a conversation below to test continuous multi-turn chat with the selected model.
                      </span>
                    </div>
                  )}

                  {/* Messages */}
                  {messages.map((msg, idx) => (
                    <div
                      key={`msg-${idx}-${msg.role}`}
                      className={`flex flex-col space-y-2 rounded-xl p-3.5 border transition ${
                        msg.role === "user"
                          ? "bg-[#181d28]/70 border-[#2b64e0]/30 ml-6 sm:ml-12"
                          : "bg-[#141418] border-[#24242e] mr-6 sm:mr-12"
                      }`}
                    >
                      {/* Author */}
                      <div className="flex items-center justify-between text-[11px]">
                        <div className="flex items-center gap-1.5 font-semibold">
                          {msg.role === "user" ? (
                            <>
                              <User className="h-3.5 w-3.5 text-[#60a5fa]" />
                              <span className="text-[#60a5fa]">You</span>
                            </>
                          ) : (
                            <>
                              <Bot className="h-3.5 w-3.5 text-emerald-400" />
                              <span className="text-white">{selectedModel}</span>
                            </>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {msg.metrics && (
                            <span className="text-[10px] text-[#71717a] font-mono">
                              {msg.metrics.totalMs}ms • {msg.metrics.tokenCount} tokens
                              {msg.metrics.tokensPerSec ? ` • ${msg.metrics.tokensPerSec} t/s` : ""}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => handleCopyMessage(msg.content, idx)}
                            className="text-[#71717a] hover:text-white p-0.5 rounded transition cursor-pointer"
                            title="Copy message text"
                          >
                            {copiedMsgIdx === idx ? (
                              <Check className="h-3 w-3 text-emerald-400" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Thinking */}
                      {msg.reasoning && (
                        <div className="rounded-lg border border-[#2a2a36] bg-[#101014] overflow-hidden text-[11px]">
                          <button
                            type="button"
                            onClick={() => toggleReasoning(idx)}
                            className="w-full flex items-center justify-between px-3 py-1.5 bg-[#16161c] text-emerald-400 hover:bg-[#1a1a22] transition cursor-pointer"
                          >
                            <div className="flex items-center gap-1.5">
                              <Sparkles className="h-3 w-3" />
                              <span>Thinking Process</span>
                            </div>
                            <ChevronDown
                              className={`h-3 w-3 text-[#71717a] transition-transform duration-150 ${
                                openReasoningMap[idx] === false ? "" : "rotate-180"
                              }`}
                            />
                          </button>
                          {openReasoningMap[idx] !== false && (
                            <div className="p-3 text-[#94a3b8] whitespace-pre-wrap leading-relaxed border-t border-[#202028] bg-[#0c0c10]">
                              {msg.reasoning}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Content */}
                      <div className="text-[#f4f4f6] whitespace-pre-wrap wrap-break-wor leading-relaxed">
                        {msg.content}
                      </div>

                      {msg.error && (
                        <div className="p-2 rounded bg-rose-950/40 border border-rose-800/40 text-rose-300 text-[11px] flex items-center gap-1.5">
                          <AlertCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                          <span>{msg.error}</span>
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Live response */}
                  {isLoading && (
                    <div className="flex flex-col space-y-2 rounded-xl p-3.5 border bg-[#141418] border-[#24242e] mr-6 sm:mr-12 animate-in fade-in">
                      <div className="flex items-center justify-between text-[11px]">
                        <div className="flex items-center gap-1.5 font-semibold">
                          <Bot className="h-3.5 w-3.5 text-emerald-400" />
                          <span className="text-white">{selectedModel}</span>
                        </div>
                        <span className="text-[10px] text-[#60a5fa] animate-pulse">
                          Generating response...
                        </span>
                      </div>

                      {/* Live thinking */}
                      {liveReasoning && (
                        <div className="rounded-lg border border-[#2a2a36] bg-[#101014] overflow-hidden text-[11px]">
                          <div className="px-3 py-1.5 bg-[#16161c] text-emerald-400 flex items-center gap-1.5 font-medium">
                            <Sparkles className="h-3 w-3 animate-spin" />
                            <span>Thinking...</span>
                          </div>
                          <div className="p-3 text-[#94a3b8] whitespace-pre-wrap leading-relaxed border-t border-[#202028] bg-[#0c0c10]">
                            {liveReasoning}
                          </div>
                        </div>
                      )}

                      {/* Live content */}
                      {liveContent && (
                        <div className="text-[#f4f4f6] whitespace-pre-wrap wrap-break-wor leading-relaxed">
                          {liveContent}
                          <span className="inline-block w-2 h-4 ml-1 bg-[#3b82f6] animate-pulse align-middle" />
                        </div>
                      )}
                      {!liveContent && !liveReasoning && (
                        <div className="py-4 flex items-center gap-2 text-xs text-[#60a5fa]">
                          <Zap className="h-3.5 w-3.5 animate-bounce text-amber-400" />
                          <span>Waiting for first token...</span>
                        </div>
                      )}
                    </div>
                  )}

                  {globalError && (
                    <div className="p-3 rounded-lg bg-rose-950/50 border border-rose-800/60 text-rose-300 flex items-start gap-2.5">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-400" />
                      <div className="space-y-1">
                        <div className="font-semibold text-white">Generation Error</div>
                        <div className="text-xs break-all">{globalError}</div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                /* Raw inspector */
                <div className="space-y-4">
                  {rawPayload && (
                    <div>
                      <div className="text-[10px] text-[#71717a] uppercase font-mono mb-1">
                        Latest Request Payload
                      </div>
                      <pre className="p-3 rounded-lg bg-[#0e0e12] border border-[#23232e] text-[#93c5fd] overflow-x-auto text-[11px]">
                        {rawPayload}
                      </pre>
                    </div>
                  )}

                  <div>
                    <div className="text-[10px] text-[#71717a] uppercase font-mono mb-1">
                      Stream Chunks ({rawChunks.length})
                    </div>
                    {rawChunks.length === 0 ? (
                      <div className="p-4 text-center text-[#52525c] border border-dashed border-[#23232a] rounded-lg">
                        No SSE chunks received yet.
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-96 overflow-y-auto">
                        {rawChunks.map((chunk, idx) => (
                          <div
                            key={`chunk-${idx}-${chunk.slice(0, 16)}`}
                            className="p-2 rounded bg-[#0e0e12] border border-[#23232e] text-[#a1a1aa] text-[11px] font-mono break-all"
                          >
                            <span className="text-[#3b82f6] select-none mr-2">[{idx + 1}]</span>
                            {chunk}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>

            {/* Prompt input */}
            <div className="p-3 border-t border-[#23232a] bg-[#121215]">
              <form onSubmit={handleSendMessage} className="space-y-2">
                <div className="relative">
                  <textarea
                    value={userPrompt}
                    onInput={(e) => setUserPrompt((e.target as HTMLTextAreaElement).value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (userPrompt.trim() && !isLoading) {
                          handleSendMessage();
                        }
                      }
                    }}
                    placeholder="Type a message to continue the conversation... (Enter to send, Shift+Enter for new line)"
                    rows={3}
                    className="w-full p-3 pr-24 bg-[#16161a] border border-[#262630] rounded-xl text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-[#2b64e0] transition font-mono leading-relaxed"
                  />
                  <div className="absolute right-2.5 bottom-3 flex items-center gap-1.5">
                    {isLoading ? (
                      <button
                        type="button"
                        onClick={handleStop}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-xs font-semibold text-white transition shadow-sm cursor-pointer"
                      >
                        <Square className="h-3 w-3 fill-white" />
                        <span>Stop</span>
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={!userPrompt.trim()}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#2b64e0] hover:bg-[#3872ee] active:bg-[#2353be] text-xs font-semibold text-white transition shadow-sm disabled:opacity-40 cursor-pointer"
                      >
                        <Send className="h-3.5 w-3.5" />
                        <span>Send</span>
                      </button>
                    )}
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
