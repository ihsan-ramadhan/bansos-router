import { useState, useRef } from "preact/hooks";
import type { ChatMessage, WireProtocol, ModelItem, CompletionMetrics } from "../types";
import {
  buildPayloadForProtocol,
  parseErrorText,
  parseNonStreamPayload,
  extractReasoningFromThinkTags,
  extractFrameDeltas,
  calculateCompletionMetrics,
} from "../utils/playground";

interface UsePlaygroundChatProps {
  models: ModelItem[];
  selectedModel: string;
  selectedProtocol: WireProtocol;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  reasoningEffort: "auto" | "low" | "medium" | "high";
  stream: boolean;
  noFailover: boolean;
}

export function usePlaygroundChat({
  models,
  selectedModel,
  selectedProtocol,
  systemPrompt,
  temperature,
  maxTokens,
  reasoningEffort,
  stream,
  noFailover,
}: UsePlaygroundChatProps) {
  const [userPrompt, setUserPrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [liveReasoning, setLiveReasoning] = useState("");
  const [liveContent, setLiveContent] = useState("");
  const [openReasoningMap, setOpenReasoningMap] = useState<Record<number, boolean>>({});
  const [rawPayload, setRawPayload] = useState<string | null>(null);
  const [rawChunks, setRawChunks] = useState<string[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const [pendingProtocol, setPendingProtocol] = useState<WireProtocol | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  function handleStop() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    setPendingModel(null);
    setPendingProtocol(null);
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

  async function processNonStreamResponse(res: Response, startTime: number, targetModel: string, targetProtocol: WireProtocol) {
    const data = await res.json();
    const endTime = performance.now();
    const totalMs = Math.round(endTime - startTime);

    const parsed = parseNonStreamPayload(data, targetProtocol);
    const { cleanContent, reasoning } = extractReasoningFromThinkTags(
      parsed.content,
      parsed.reasoning || ""
    );

    const tokenCount = parsed.completionTokens ?? cleanContent.split(/\s+/).filter(Boolean).length;
    const tokensPerSec =
      tokenCount && totalMs > 50 ? Math.round((tokenCount / (totalMs / 1000)) * 10) / 10 : undefined;

    const metrics: CompletionMetrics = {
      ttftMs: totalMs,
      totalMs,
      promptTokens: parsed.promptTokens,
      completionTokens: parsed.completionTokens,
      totalTokens: parsed.totalTokens,
      tokenCount,
      tokensPerSec,
    };

    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: cleanContent,
        reasoning,
        protocol: targetProtocol,
        model: targetModel,
        metrics,
      },
    ]);

    setRawChunks([JSON.stringify(data, null, 2)]);
  }

  async function processStreamResponse(res: Response, startTime: number, targetModel: string, targetProtocol: WireProtocol) {
    const reader = res.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = "";
    let firstTokenTime: number | undefined;
    let tokenCount = 0;
    let accumulatedContent = "";
    let accumulatedReasoning = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() || "";

      for (const frame of lines) {
        const trimmed = frame.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;

        const dataStr = trimmed.slice(5).trim();
        if (!dataStr || dataStr === "[DONE]") continue;

        setRawChunks((prev) => [...prev, dataStr]);

        try {
          const chunk = JSON.parse(dataStr);
          if (chunk.error) {
            const errMsg = chunk.error.message || chunk.error.type || JSON.stringify(chunk.error);
            accumulatedContent = `[Error: ${errMsg}]`;
            setLiveContent(`[Error: ${errMsg}]`);
            continue;
          }

          const { delta, reasoningDelta } = extractFrameDeltas(chunk, targetProtocol);
          if (delta || reasoningDelta) {
            if (!firstTokenTime) {
              firstTokenTime = performance.now();
            }
            tokenCount++;

            if (reasoningDelta) {
              accumulatedReasoning += reasoningDelta;
              setLiveReasoning((prev) => prev + reasoningDelta);
            }
            if (delta) {
              accumulatedContent += delta;
              setLiveContent((prev) => prev + delta);
            }
          }
        } catch {
          // Ignore non-JSON comments/keepalives
        }
      }
    }

    const endTime = performance.now();
    const { cleanContent, reasoning } = extractReasoningFromThinkTags(
      accumulatedContent,
      accumulatedReasoning
    );
    const finalTokenCount = tokenCount || cleanContent.split(/\s+/).filter(Boolean).length;
    const metrics = calculateCompletionMetrics(startTime, endTime, firstTokenTime, finalTokenCount);

    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: cleanContent,
        reasoning,
        protocol: targetProtocol,
        model: targetModel,
        metrics,
      },
    ]);
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

    const targetModel = selectedModel || models[0]?.id || "mimo-v2.5-free";
    const targetProtocol = selectedProtocol;
    setPendingModel(targetModel);
    setPendingProtocol(targetProtocol);
    const { endpoint, payload } = buildPayloadForProtocol({
      protocol: targetProtocol,
      model: targetModel,
      messages: updatedMessages,
      systemPrompt,
      temperature,
      maxTokens,
      reasoningEffort,
      stream,
    });

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
        await processNonStreamResponse(res, startTime, targetModel, targetProtocol);
      } else {
        await processStreamResponse(res, startTime, targetModel, targetProtocol);
      }
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
            protocol: targetProtocol,
            model: targetModel,
            error: errorMsg,
          },
        ]);
      }
    } finally {
      setIsLoading(false);
      setPendingModel(null);
      setPendingProtocol(null);
      abortControllerRef.current = null;
    }
  }

  return {
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
  };
}
