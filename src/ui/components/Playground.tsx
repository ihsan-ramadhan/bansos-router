import { useState, useRef, useEffect, useMemo } from "preact/hooks";
import type { ModelItem, ChatMessage, CompletionMetrics, WireProtocol } from "../types/ui";
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
  Download,
  Layers,
  Maximize2,
  Minimize2,
} from "lucide-preact";

interface PlaygroundProps {
  models: ModelItem[];
  daemonPort: number;
}

function formatProviderLabel(provider: string): string {
  switch (provider.toLowerCase()) {
    case "zen":
      return "OpenCode Zen";
    case "kilo":
      return "KiloCode";
    case "llm7":
      return "LLM7";
    case "local":
      return "Local / OpenAI";
    default:
      return provider.toUpperCase();
  }
}

async function handleNonStreamCompletion(
  res: Response,
  startTime: number,
  protocol: WireProtocol,
  setMessages: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void,
  setRawChunks: (chunks: string[]) => void,
) {
  const data = await res.json();
  const endTime = performance.now();
  const totalMs = Math.round(endTime - startTime);

  let content = "";
  let reasoning = "";
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  let totalTokens: number | undefined;

  if (protocol === "responses") {
    const outList = Array.isArray(data.output) ? data.output : [];
    const msgItem = outList.find((o: any) => o?.type === "message") || outList[0];
    const textPart = Array.isArray(msgItem?.content)
      ? msgItem.content.find((c: any) => c?.type === "output_text") || msgItem.content[0]
      : undefined;
    content = typeof textPart?.text === "string" ? textPart.text : (typeof textPart === "string" ? textPart : "");
    promptTokens = data.usage?.input_tokens;
    completionTokens = data.usage?.output_tokens;
    totalTokens = data.usage?.total_tokens;
  } else if (protocol === "anthropic") {
    if (Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === "text" && typeof block.text === "string") {
          content += block.text;
        } else if (block.type === "thinking" && typeof block.thinking === "string") {
          reasoning += block.thinking;
        }
      }
    }
    promptTokens = data.usage?.input_tokens;
    completionTokens = data.usage?.output_tokens;
    totalTokens = (promptTokens || 0) + (completionTokens || 0);
  } else {
    const choice = data.choices?.[0];
    content = choice?.message?.content || "";
    reasoning = choice?.message?.reasoning_content || "";
    promptTokens = data.usage?.prompt_tokens;
    completionTokens = data.usage?.completion_tokens;
    totalTokens = data.usage?.total_tokens;
  }

  // Parse embedded reasoning blocks (<think>...</think>) if present in content
  const thinkMatch = /^<think>([\s\S]*?)<\/think>\s*/.exec(content);
  if (thinkMatch?.[1]) {
    reasoning = (reasoning ? reasoning + "\n" : "") + thinkMatch[1].trim();
    content = content.replace(/^<think>[\s\S]*?<\/think>\s*/, "");
  }

  const tokenCount = completionTokens ?? content.split(/\s+/).filter(Boolean).length;
  const tokensPerSec = tokenCount && totalMs > 50
    ? Math.round((tokenCount / (totalMs / 1000)) * 10) / 10
    : undefined;

  const metrics: CompletionMetrics = {
    ttftMs: totalMs,
    totalMs,
    promptTokens,
    completionTokens,
    totalTokens,
    tokenCount,
    tokensPerSec,
  };

  setMessages((prev) => [
    ...prev,
    {
      role: "assistant",
      content,
      reasoning: reasoning || undefined,
      protocol,
      metrics,
    },
  ]);

  setRawChunks([JSON.stringify(data, null, 2)]);
}

function buildApiMessages(
  history: ChatMessage[],
  systemPrompt: string,
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
  protocol: WireProtocol;
  callbacks: {
    setLiveContent: (updater: (prev: string) => string) => void;
    setLiveReasoning: (updater: (prev: string) => string) => void;
    setRawChunks: (updater: (prev: string[]) => string[]) => void;
  };
  state: {
    firstTokenTime?: number;
    tokenCount: number;
    accumulatedContent: string;
    accumulatedReasoning: string;
  };
}

function processStreamFrame(frame: string, ctx: StreamChunkContext) {
  if (!frame.startsWith("data:")) return;
  const dataStr = frame.slice(5).trim();
  if (!dataStr || dataStr === "[DONE]") return;

  ctx.callbacks.setRawChunks((prev) => [...prev, dataStr]);

  try {
    const chunk = JSON.parse(dataStr);

    if (chunk.error) {
      const errMsg = chunk.error.message || chunk.error.type || JSON.stringify(chunk.error);
      ctx.state.accumulatedContent = `[Error: ${errMsg}]`;
      ctx.callbacks.setLiveContent(() => `[Error: ${errMsg}]`);
      return;
    }

    let delta = "";
    let reasoningDelta = "";

    if (ctx.protocol === "responses") {
      if (chunk.type === "response.output_item.delta" && chunk.delta?.text) {
        delta = chunk.delta.text;
      } else if (chunk.type === "response.content_part.delta" && chunk.delta?.text) {
        delta = chunk.delta.text;
      } else if (chunk.type === "response.text.delta" && chunk.delta) {
        delta = typeof chunk.delta === "string" ? chunk.delta : chunk.delta.text || "";
      }
    } else if (ctx.protocol === "anthropic") {
      if (chunk.type === "content_block_delta") {
        if (chunk.delta?.type === "text_delta" && chunk.delta.text) {
          delta = chunk.delta.text;
        } else if (chunk.delta?.type === "thinking_delta" && chunk.delta.thinking) {
          reasoningDelta = chunk.delta.thinking;
        }
      }
    } else {
      delta = chunk.choices?.[0]?.delta?.content || "";
      reasoningDelta =
        chunk.choices?.[0]?.delta?.reasoning_content ||
        chunk.choices?.[0]?.delta?.reasoning ||
        chunk.choices?.[0]?.delta?.thought ||
        "";
    }

    if (delta || reasoningDelta) {
      if (!ctx.state.firstTokenTime) {
        ctx.state.firstTokenTime = performance.now();
      }
      ctx.state.tokenCount++;

      if (reasoningDelta) {
        ctx.state.accumulatedReasoning += reasoningDelta;
        ctx.callbacks.setLiveReasoning((prev) => prev + reasoningDelta);
      }
      if (delta) {
        ctx.state.accumulatedContent += delta;
        ctx.callbacks.setLiveContent((prev) => prev + delta);
      }
    }
  } catch {
    // Non-JSON frame (e.g. comment or keepalive)
  }
}

async function handleStreamCompletion(
  res: Response,
  startTime: number,
  protocol: WireProtocol,
  callbacks: {
    setLiveContent: (v: string | ((prev: string) => string)) => void;
    setLiveReasoning: (v: string | ((prev: string) => string)) => void;
    setRawChunks: (updater: (prev: string[]) => string[]) => void;
    setMessages: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
  },
) {
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const ctx: StreamChunkContext = {
    protocol,
    callbacks,
    state: {
      firstTokenTime: undefined,
      tokenCount: 0,
      accumulatedContent: "",
      accumulatedReasoning: "",
    },
  };

  if (!reader) return;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop() || "";

    for (const frame of lines) {
      const trimmed = frame.trim();
      if (trimmed) {
        processStreamFrame(trimmed, ctx);
      }
    }
  }

  // Build final message
  const finalMsg = buildStreamMessage(startTime, protocol, ctx.state);
  callbacks.setMessages((prev) => [...prev, finalMsg]);
}

function buildStreamMessage(
  startTime: number,
  protocol: WireProtocol,
  state: {
    firstTokenTime?: number;
    tokenCount: number;
    accumulatedContent: string;
    accumulatedReasoning: string;
  },
): ChatMessage {
  const endTime = performance.now();
  const totalMs = Math.round(endTime - startTime);
  const ttftMs = state.firstTokenTime ? Math.round(state.firstTokenTime - startTime) : totalMs;

  let finalOutput = state.accumulatedContent;
  let finalReasoning = state.accumulatedReasoning;

  const thinkExec = /^<think>([\s\S]*?)<\/think>\s*/.exec(finalOutput);
  if (thinkExec?.[1]) {
    finalReasoning = (finalReasoning ? finalReasoning + "\n" : "") + thinkExec[1].trim();
    finalOutput = finalOutput.replace(/^<think>[\s\S]*?<\/think>\s*/, "");
  }

  const finalTokenCount = state.tokenCount || finalOutput.split(/\s+/).filter(Boolean).length;
  const speedDuration = totalMs - (ttftMs || 0);
  const tokensPerSec = finalTokenCount && speedDuration > 50
    ? Math.round((finalTokenCount / (speedDuration / 1000)) * 10) / 10
    : undefined;

  return {
    role: "assistant",
    content: finalOutput,
    reasoning: finalReasoning || undefined,
    protocol,
    metrics: {
      ttftMs,
      totalMs,
      tokenCount: finalTokenCount,
      tokensPerSec,
    },
  };
}

export function Playground({ models, daemonPort }: PlaygroundProps) {
  const [selectedProtocol, setSelectedProtocol] = useState<WireProtocol>("chat");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState("");

  const [systemPrompt, setSystemPrompt] = useState("");
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);

  const [userPrompt, setUserPrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [reasoningEffort, setReasoningEffort] = useState<"auto" | "low" | "medium" | "high">("auto");
  const [effortDropdownOpen, setEffortDropdownOpen] = useState(false);
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
  const [isFullscreen, setIsFullscreen] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selectedModel && models.length > 0) {
      // Default to flagship reasoning model or first available model
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

  const groupedModels = useMemo(() => {
    const groups: Record<string, ModelItem[]> = {};
    for (const m of filteredModels) {
      const p = (m.source || m.owned_by || "other").toLowerCase();
      if (!groups[p]) groups[p] = [];
      groups[p].push(m);
    }
    const order = ["zen", "kilo", "llm7", "local"];
    const sortedKeys = Object.keys(groups).sort((a, b) => {
      const idxA = order.indexOf(a);
      const idxB = order.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });
    return sortedKeys.map((k) => ({
      provider: k,
      label: formatProviderLabel(k),
      models: groups[k] ?? [],
    }));
  }, [filteredModels]);

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

  async function handleCopyMessage(content: string, idx: number) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMsgIdx(idx);
      setTimeout(() => setCopiedMsgIdx((curr) => (curr === idx ? null : curr)), 2000);
    } catch {
      // Clipboard write failed (e.g. permission denied or unfocused document)
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
      // Clipboard write failed (e.g. permission denied or unfocused document)
    }
  }

  function handleExportChat(format: "markdown" | "json") {
    if (messages.length === 0) return;
    let content = "";
    let filename = `bansos-chat-${Date.now()}`;

    if (format === "json") {
      content = JSON.stringify(messages, null, 2);
      filename += ".json";
    } else {
      filename += ".md";
      content = `# Bansos Router Chat Export\nModel: \`${selectedModel}\` | Protocol: \`${selectedProtocol}\` | Date: ${new Date().toISOString()}\n\n---\n\n`;
      for (const m of messages) {
        content += `### ${m.role === "user" ? "👤 User" : `🤖 Assistant (${m.protocol || "chat"})`}\n\n`;
        if (m.reasoning) {
          content += `> **Thinking Process**:\n> ${m.reasoning.replace(/\n/g, "\n> ")}\n\n`;
        }
        content += `${m.content}\n\n---\n\n`;
      }
    }

    const blob = new Blob([content], { type: format === "json" ? "application/json" : "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

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

    const updatedMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: promptToSend },
    ];
    setMessages(updatedMessages);
    setUserPrompt("");

    const targetModel = selectedModel || models[0]?.id || "tencent/hy3:free";
    let endpoint = "/v1/chat/completions";
    let payload: Record<string, unknown> = {};

    if (selectedProtocol === "responses") {
      endpoint = "/v1/responses";
      payload = {
        model: targetModel,
        input: updatedMessages.map((m) => ({ role: m.role, content: m.content })),
        ...(systemPrompt.trim() ? { instructions: systemPrompt.trim() } : {}),
        ...(reasoningEffort !== "auto" ? { reasoning: { effort: reasoningEffort } } : {}),
        max_output_tokens: maxTokens,
        stream,
      };
    } else if (selectedProtocol === "anthropic") {
      endpoint = "/v1/messages";
      payload = {
        model: targetModel,
        messages: updatedMessages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
        ...(systemPrompt.trim() ? { system: systemPrompt.trim() } : {}),
        max_tokens: maxTokens,
        temperature,
        stream,
      };
    } else {
      endpoint = "/v1/chat/completions";
      payload = {
        model: targetModel,
        messages: buildApiMessages(updatedMessages, systemPrompt),
        temperature,
        max_tokens: maxTokens,
        stream,
      };
    }

    setRawPayload(JSON.stringify({ endpoint, payload }, null, 2));

    const startTime = performance.now();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (noFailover) {
        headers["x-bansos-no-failover"] = "1";
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(await parseErrorText(res));
      }

      if (!stream) {
        await handleNonStreamCompletion(res, startTime, selectedProtocol, setMessages, setRawChunks);
        setIsLoading(false);
        return;
      }

      await handleStreamCompletion(res, startTime, selectedProtocol, {
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
            content: liveContent || "Failed to generate response.",
            reasoning: liveReasoning || undefined,
            protocol: selectedProtocol,
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
                onClick={() => handleExportChat("markdown")}
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
          <div className="mt-4 pt-4 border-t border-[#23232a] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 text-xs animate-in fade-in duration-150">
            <div>
              <div className="flex justify-between text-[#a1a1aa] mb-1.5">
                <span>Temperature</span>
                <span className="font-mono text-white font-medium">{temperature.toFixed(2)}</span>
              </div>
              <div className="relative flex items-center h-6">
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.05"
                  value={temperature}
                  onInput={(e) => setTemperature(Number.parseFloat((e.target as HTMLInputElement).value))}
                  onChange={(e) => setTemperature(Number.parseFloat((e.target as HTMLInputElement).value))}
                  style={{
                    background: `linear-gradient(to right, #2b64e0 0%, #2b64e0 ${(temperature / 2) * 100}%, #202028 ${(temperature / 2) * 100}%, #202028 100%)`,
                  }}
                  className="w-full h-1.5 rounded-lg cursor-pointer"
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-[#a1a1aa] mb-1.5">
                <span>Max Output Tokens</span>
                <span className="font-mono text-white font-medium">{maxTokens.toLocaleString()}</span>
              </div>
              <div className="relative flex items-center h-6">
                <input
                  type="range"
                  min="256"
                  max="16384"
                  step="256"
                  value={maxTokens}
                  onInput={(e) => setMaxTokens(Number.parseInt((e.target as HTMLInputElement).value, 10))}
                  onChange={(e) => setMaxTokens(Number.parseInt((e.target as HTMLInputElement).value, 10))}
                  style={{
                    background: `linear-gradient(to right, #2b64e0 0%, #2b64e0 ${((maxTokens - 256) / (16384 - 256)) * 100}%, #202028 ${((maxTokens - 256) / (16384 - 256)) * 100}%, #202028 100%)`,
                  }}
                  className="w-full h-1.5 rounded-lg cursor-pointer"
                />
              </div>
            </div>

            <div className="relative">
              <div className="flex justify-between text-[#a1a1aa] mb-1.5">
                <span>Reasoning Effort</span>
                <span className="font-mono text-white font-medium capitalize">{reasoningEffort}</span>
              </div>
              <button
                type="button"
                onClick={() => setEffortDropdownOpen(!effortDropdownOpen)}
                className="w-full flex items-center justify-between px-2.5 py-1.5 bg-[#121215] hover:bg-[#18181d] border border-[#262630] hover:border-[#383846] rounded-lg text-xs font-mono text-white focus:outline-none focus:border-[#2b64e0] transition cursor-pointer"
              >
                <span>
                  {reasoningEffort === "auto" && "Auto (Default)"}
                  {reasoningEffort === "low" && "Low Effort"}
                  {reasoningEffort === "medium" && "Medium Effort"}
                  {reasoningEffort === "high" && "High Effort"}
                </span>
                <ChevronDown className={`h-3 w-3 text-[#71717a] transition-transform duration-150 ${effortDropdownOpen ? "rotate-180" : ""}`} />
              </button>

              {effortDropdownOpen && (
                <>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Close reasoning effort dropdown"
                    className="fixed inset-0 z-20 cursor-default bg-transparent border-0"
                    onClick={() => setEffortDropdownOpen(false)}
                  />
                  <div className="absolute left-0 right-0 mt-1.5 rounded-xl bg-[#16161a] border border-[#282832] shadow-xl py-1 z-30 flex flex-col divide-y divide-[#202026]">
                    {[
                      { id: "auto", label: "Auto (Default)" },
                      { id: "low", label: "Low Effort" },
                      { id: "medium", label: "Medium Effort" },
                      { id: "high", label: "High Effort" },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setReasoningEffort(opt.id as any);
                          setEffortDropdownOpen(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 text-xs font-mono transition flex items-center justify-between cursor-pointer ${
                          reasoningEffort === opt.id
                            ? "bg-[#2b64e0]/15 text-[#60a5fa] font-medium"
                            : "text-[#d4d4d8] hover:bg-[#202026] hover:text-white"
                        }`}
                      >
                        <span>{opt.label}</span>
                        {reasoningEffort === opt.id && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#2b64e0]" />
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center justify-between sm:justify-start gap-3 pt-3 sm:pt-4">
              <span className="text-[#a1a1aa]" title="Stream tokens in real time as they are generated">Stream Response</span>
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

            <div className="flex items-center justify-between sm:justify-start gap-3 pt-3 sm:pt-4">
              <span className="text-[#a1a1aa]" title="Bypass automatic failover and send requests strictly to the selected model">Direct Mode (No Failover)</span>
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
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
        {/* Left Side: Model Selector, Protocol & System Instructions */}
        <div className="lg:col-span-4 space-y-3 sm:space-y-4">
          <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-3.5 sm:p-4 shadow-xs space-y-4">
            {/* Model Selector Dropdown */}
            <div className="space-y-1.5">
              <span className="text-[10px] sm:text-[11px] font-semibold text-[#8b8b96] uppercase tracking-wider block">
                Active Model
              </span>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                  className="w-full min-h-[42px] flex items-center justify-between bg-[#121215] hover:bg-[#18181d] border border-[#262630] hover:border-[#383846] rounded-lg px-3 py-2 text-xs font-mono text-white transition cursor-pointer"
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="font-semibold truncate">{selectedModel || "Select Model..."}</span>
                    {activeModelObj?.reasoning && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.2 rounded bg-emerald-950/70 text-emerald-300 border border-emerald-800/40 shrink-0">
                        <Sparkles className="h-2.5 w-2.5" /> Think
                      </span>
                    )}
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
                    <div className="absolute left-0 right-0 mt-1.5 max-h-72 rounded-xl bg-[#16161a] border border-[#282832] shadow-2xl z-30 flex flex-col overflow-hidden">
                      <div className="p-2 border-b border-[#23232a] shrink-0">
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#71717a]" />
                          <input
                            type="text"
                            value={modelSearchQuery}
                            onInput={(e) => setModelSearchQuery((e.target as HTMLInputElement).value)}
                            placeholder="Search models..."
                            className="w-full pl-8 pr-3 py-1.5 bg-[#121215] border border-[#262630] rounded-md text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-[#2b64e0]"
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
                                    setSelectedModel(m.id);
                                    setModelDropdownOpen(false);
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
                )}
              </div>
            </div>

            {/* Protocol Selector */}
            <div className="space-y-1.5">
              <span className="text-[10px] sm:text-[11px] font-semibold text-[#8b8b96] uppercase tracking-wider flex items-center justify-between">
                <span>API Protocol</span>
                <span className="text-[10px] text-[#60a5fa] font-mono lowercase truncate ml-2">
                  {selectedProtocol === "chat" ? "/v1/chat/completions" : selectedProtocol === "responses" ? "/v1/responses" : "/v1/messages"}
                </span>
              </span>

              <div className="grid grid-cols-3 gap-1 bg-[#121215] p-1 rounded-lg border border-[#262630]">
                <button
                  type="button"
                  onClick={() => setSelectedProtocol("chat")}
                  className={`py-1.5 px-1 rounded text-center text-xs font-medium transition cursor-pointer truncate ${
                    selectedProtocol === "chat"
                      ? "bg-[#2b64e0] text-white shadow-xs"
                      : "text-[#9393a0] hover:text-white"
                  }`}
                >
                  Chat
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedProtocol("responses")}
                  className={`py-1.5 px-1 rounded text-center text-xs font-medium transition cursor-pointer truncate ${
                    selectedProtocol === "responses"
                      ? "bg-purple-600 text-white shadow-xs"
                      : "text-[#9393a0] hover:text-white"
                  }`}
                >
                  Responses
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedProtocol("anthropic")}
                  className={`py-1.5 px-1 rounded text-center text-xs font-medium transition cursor-pointer truncate ${
                    selectedProtocol === "anthropic"
                      ? "bg-amber-600 text-white shadow-xs"
                      : "text-[#9393a0] hover:text-white"
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
                  onClick={() => setShowSystemPrompt(!showSystemPrompt)}
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
                      onClick={() => setSystemPrompt("")}
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
                    onInput={(e) => setSystemPrompt((e.target as HTMLTextAreaElement).value)}
                    placeholder="Optional persona, tone, or instructions for the model..."
                    rows={4}
                    className="w-full p-2.5 bg-[#121215] border border-[#262630] rounded-lg text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-[#2b64e0] transition font-mono leading-relaxed"
                  />
                </div>
              )}
            </div>

            {/* Chat Session Info */}
            <div className="pt-2 border-t border-[#23232a] text-xs text-[#71717a] space-y-1">
              <div className="flex justify-between">
                <span>Daemon Endpoint</span>
                <span className="font-mono text-[#d4d4d8]">127.0.0.1:{daemonPort}</span>
              </div>
              <div className="flex justify-between">
                <span>Active Protocol</span>
                <span className="font-mono text-[#60a5fa] capitalize">{selectedProtocol}</span>
              </div>
              <div className="flex justify-between">
                <span>Messages</span>
                <span className="font-mono text-[#60a5fa]">{messages.length}</span>
              </div>
            </div>
          </div>
        </div>

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
                <>
                  {messages.length === 0 && !isLoading && (
                    <div className="flex-1 my-auto flex flex-col items-center justify-center text-center text-[#71717a] space-y-3 px-4 py-8">
                      <div className="p-3 rounded-2xl bg-[#121215] border border-[#23232a] text-emerald-400 shadow-inner">
                        <Bot className="h-6 w-6 sm:h-7 sm:w-7" />
                      </div>
                      <div className="space-y-1">
                        <span className="text-white font-medium block text-xs sm:text-sm">Start a conversation</span>
                        <span className="text-xs text-[#71717a] max-w-sm block">
                          Type a message below to start chatting with the selected model.
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Messages */}
                  <div className="space-y-3.5 sm:space-y-4">
                    {messages.map((msg, idx) => (
                      <div
                        key={`msg-${idx}-${msg.role}`}
                        className={`flex flex-col space-y-2 rounded-xl p-3 sm:p-3.5 border transition ${
                          msg.role === "user"
                            ? "bg-[#181d28]/70 border-[#2b64e0]/30 ml-1.5 sm:ml-8"
                            : "bg-[#141418] border-[#24242e] mr-1.5 sm:mr-8"
                        }`}
                      >
                      {/* Author */}
                      <div className="flex items-center justify-between text-[11px] gap-2">
                        <div className="flex items-center gap-1.5 font-semibold min-w-0">
                          {msg.role === "user" ? (
                            <>
                              <User className="h-3.5 w-3.5 text-[#60a5fa] shrink-0" />
                              <span className="text-[#60a5fa]">You</span>
                            </>
                          ) : (
                            <>
                              <Bot className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                              <span className="text-white truncate">{selectedModel}</span>
                            </>
                          )}
                        </div>

                        <div className="flex items-center gap-2 text-[#71717a] font-mono text-[10px] shrink-0">
                          {msg.metrics && (
                            <span className="hidden sm:inline">
                              {msg.metrics.totalMs}ms • {msg.metrics.tokenCount} tokens
                              {msg.metrics.tokensPerSec ? ` • ${msg.metrics.tokensPerSec} t/s` : ""}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => handleCopyMessage(msg.content, idx)}
                            className="text-[#71717a] hover:text-white p-1 rounded transition cursor-pointer"
                            title="Copy message text"
                            aria-label="Copy message text"
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
                              <Sparkles className="h-3 w-3 shrink-0" />
                              <span>Thinking Process</span>
                            </div>
                            <ChevronDown
                              className={`h-3 w-3 text-[#71717a] shrink-0 transition-transform duration-150 ${
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
                      <div className="text-[#f4f4f6] whitespace-pre-wrap break-words leading-relaxed text-xs">
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

                  {/* Live streaming message */}
                  {isLoading && (
                    <div className="flex flex-col space-y-2 rounded-xl p-3 sm:p-3.5 border bg-[#141418] border-[#24242e] mr-1.5 sm:mr-8 transition">
                      <div className="flex items-center gap-1.5 font-semibold text-[11px]">
                        <Bot className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span className="text-white truncate">{selectedModel}</span>
                      </div>

                      {/* Live thinking */}
                      {liveReasoning && (
                        <div className="rounded-lg border border-[#2a2a36] bg-[#101014] overflow-hidden text-[11px]">
                          <div className="px-3 py-1.5 bg-[#16161c] text-emerald-400 flex items-center gap-1.5 font-medium">
                            <Sparkles className="h-3 w-3 animate-spin shrink-0" />
                            <span>Thinking...</span>
                          </div>
                          <div className="p-3 text-[#94a3b8] whitespace-pre-wrap leading-relaxed border-t border-[#202028] bg-[#0c0c10]">
                            {liveReasoning}
                          </div>
                        </div>
                      )}

                      {/* Live content */}
                      {liveContent && (
                        <div className="text-[#f4f4f6] whitespace-pre-wrap break-words leading-relaxed text-xs">
                          {liveContent}
                          <span className="inline-block w-2 h-3.5 ml-1 bg-[#3b82f6] animate-pulse align-middle" />
                        </div>
                      )}
                      {!liveContent && !liveReasoning && (
                        <div className="py-2.5 flex items-center gap-2 text-xs text-[#9393a0]">
                          <span className="flex gap-1 items-center">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#3b82f6] animate-pulse" />
                            <span className="w-1.5 h-1.5 rounded-full bg-[#3b82f6] animate-pulse [animation-delay:200ms]" />
                            <span className="w-1.5 h-1.5 rounded-full bg-[#3b82f6] animate-pulse [animation-delay:400ms]" />
                          </span>
                          <span className="font-sans text-[11px] text-[#a1a1aa]">Generating response...</span>
                        </div>
                      )}
                    </div>
                  )}

                  {globalError && (
                    <div className="p-3 rounded-lg bg-rose-950/50 border border-rose-800/60 text-rose-300 flex items-start gap-2.5">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-400" />
                      <div className="space-y-1 min-w-0">
                        <div className="font-semibold text-white">Generation Error</div>
                        <div className="text-xs break-all">{globalError}</div>
                      </div>
                    </div>
                  )}
                </div>
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
            <div className="p-2.5 sm:p-3 border-t border-[#23232a] bg-[#121215]">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="space-y-2"
              >
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
                    placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
                    rows={3}
                    className="w-full p-2.5 sm:p-3 pr-20 sm:pr-24 bg-[#16161a] border border-[#262630] rounded-xl text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-[#2b64e0] transition font-mono leading-relaxed resize-none"
                  />
                  <div className="absolute right-2 bottom-2.5 sm:right-2.5 sm:bottom-3 flex items-center gap-1.5">
                    {isLoading ? (
                      <button
                        type="button"
                        onClick={handleStop}
                        className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-xs font-semibold text-white transition shadow-xs cursor-pointer"
                      >
                        <Square className="h-3 w-3 fill-white" />
                        <span>Stop</span>
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={!userPrompt.trim()}
                        className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 rounded-lg bg-[#2b64e0] hover:bg-[#3872ee] active:bg-[#2353be] text-xs font-semibold text-white transition shadow-xs disabled:opacity-40 cursor-pointer"
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
