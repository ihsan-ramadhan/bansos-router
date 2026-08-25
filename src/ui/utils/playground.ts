import type { WireProtocol, ChatMessage, CompletionMetrics, NonStreamParsedResult, BuildPayloadOptions } from "../types";
import { formatProviderLabel } from "./models";

export { formatProviderLabel };

export function getEndpointLabel(protocol: WireProtocol): string {
  if (protocol === "chat") return "/v1/chat/completions";
  if (protocol === "responses") return "/v1/responses";
  return "/v1/messages";
}

export function buildApiMessages(
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

export async function parseErrorText(res: Response): Promise<string> {
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

export function buildPayloadForProtocol(options: BuildPayloadOptions): {
  endpoint: string;
  payload: Record<string, unknown>;
} {
  const {
    protocol,
    model,
    messages,
    systemPrompt,
    temperature,
    maxTokens,
    reasoningEffort,
    stream,
  } = options;

  if (protocol === "responses") {
    return {
      endpoint: "/v1/responses",
      payload: {
        model,
        input: messages.map((m) => ({ role: m.role, content: m.content })),
        ...(systemPrompt.trim() ? { instructions: systemPrompt.trim() } : {}),
        ...(reasoningEffort !== "auto" ? { reasoning: { effort: reasoningEffort } } : {}),
        max_output_tokens: maxTokens,
        stream,
      },
    };
  }

  if (protocol === "anthropic") {
    return {
      endpoint: "/v1/messages",
      payload: {
        model,
        messages: messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role, content: m.content })),
        ...(systemPrompt.trim() ? { system: systemPrompt.trim() } : {}),
        max_tokens: maxTokens,
        temperature,
        stream,
      },
    };
  }

  return {
    endpoint: "/v1/chat/completions",
    payload: {
      model,
      messages: buildApiMessages(messages, systemPrompt),
      temperature,
      max_tokens: maxTokens,
      stream,
    },
  };
}

export function parseResponsesPayload(data: any): NonStreamParsedResult {
  const outList = Array.isArray(data.output) ? data.output : [];
  const msgItem = outList.find((o: any) => o?.type === "message") || outList[0];
  const textPart = Array.isArray(msgItem?.content)
    ? msgItem.content.find((c: any) => c?.type === "output_text") || msgItem.content[0]
    : undefined;

  let content = "";
  if (typeof textPart?.text === "string") {
    content = textPart.text;
  } else if (typeof textPart === "string") {
    content = textPart;
  }

  return {
    content,
    promptTokens: data.usage?.input_tokens,
    completionTokens: data.usage?.output_tokens,
    totalTokens: data.usage?.total_tokens,
  };
}

export function parseAnthropicPayload(data: any): NonStreamParsedResult {
  let content = "";
  let reasoning = "";

  if (Array.isArray(data.content)) {
    for (const block of data.content) {
      if (block.type === "text" && typeof block.text === "string") {
        content += block.text;
      } else if (block.type === "thinking" && typeof block.thinking === "string") {
        reasoning += block.thinking;
      }
    }
  }

  const promptTokens = data.usage?.input_tokens;
  const completionTokens = data.usage?.output_tokens;
  const totalTokens = (promptTokens || 0) + (completionTokens || 0);

  return {
    content,
    reasoning: reasoning || undefined,
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

export function parseChatPayload(data: any): NonStreamParsedResult {
  const choice = data.choices?.[0];
  return {
    content: choice?.message?.content || "",
    reasoning: choice?.message?.reasoning_content || undefined,
    promptTokens: data.usage?.prompt_tokens,
    completionTokens: data.usage?.completion_tokens,
    totalTokens: data.usage?.total_tokens,
  };
}

export function parseNonStreamPayload(data: any, protocol: WireProtocol): NonStreamParsedResult {
  if (protocol === "responses") {
    return parseResponsesPayload(data);
  }
  if (protocol === "anthropic") {
    return parseAnthropicPayload(data);
  }
  return parseChatPayload(data);
}

export function extractReasoningFromThinkTags(
  content: string,
  initialReasoning = ""
): { cleanContent: string; reasoning?: string } {
  let reasoning = initialReasoning;
  let cleanContent = content;
  const thinkMatch = /^<think>([\s\S]*?)<\/think>\s*/.exec(content);
  if (thinkMatch?.[1]) {
    reasoning = (reasoning ? reasoning + "\n" : "") + thinkMatch[1].trim();
    cleanContent = content.replace(/^<think>[\s\S]*?<\/think>\s*/, "");
  }
  return {
    cleanContent,
    reasoning: reasoning || undefined,
  };
}

export function extractResponsesDelta(chunk: any): { delta: string; reasoningDelta: string } {
  let delta = "";
  if (chunk.type === "response.output_item.delta" && chunk.delta?.text) {
    delta = chunk.delta.text;
  } else if (chunk.type === "response.content_part.delta" && chunk.delta?.text) {
    delta = chunk.delta.text;
  } else if (chunk.type === "response.text.delta" && chunk.delta) {
    delta = typeof chunk.delta === "string" ? chunk.delta : chunk.delta.text || "";
  }
  return { delta, reasoningDelta: "" };
}

export function extractAnthropicDelta(chunk: any): { delta: string; reasoningDelta: string } {
  let delta = "";
  let reasoningDelta = "";
  if (chunk.type === "content_block_delta") {
    if (chunk.delta?.type === "text_delta" && chunk.delta.text) {
      delta = chunk.delta.text;
    } else if (chunk.delta?.type === "thinking_delta" && chunk.delta.thinking) {
      reasoningDelta = chunk.delta.thinking;
    }
  }
  return { delta, reasoningDelta };
}

export function extractChatDelta(chunk: any): { delta: string; reasoningDelta: string } {
  const delta = chunk.choices?.[0]?.delta?.content || "";
  const reasoningDelta =
    chunk.choices?.[0]?.delta?.reasoning_content ||
    chunk.choices?.[0]?.delta?.reasoning ||
    chunk.choices?.[0]?.delta?.thought ||
    "";
  return { delta, reasoningDelta };
}

export function extractFrameDeltas(
  chunk: any,
  protocol: WireProtocol
): { delta: string; reasoningDelta: string } {
  if (protocol === "responses") {
    return extractResponsesDelta(chunk);
  }
  if (protocol === "anthropic") {
    return extractAnthropicDelta(chunk);
  }
  return extractChatDelta(chunk);
}

export function calculateCompletionMetrics(
  startTime: number,
  endTime: number,
  firstTokenTime: number | undefined,
  tokenCount: number
): CompletionMetrics {
  const totalMs = Math.round(endTime - startTime);
  const ttftMs = firstTokenTime ? Math.round(firstTokenTime - startTime) : totalMs;
  const speedDuration = totalMs - (ttftMs || 0);
  const tokensPerSec =
    tokenCount && speedDuration > 50
      ? Math.round((tokenCount / (speedDuration / 1000)) * 10) / 10
      : undefined;

  return {
    ttftMs,
    totalMs,
    tokenCount,
    tokensPerSec,
  };
}

export function exportChatToFile(
  messages: ChatMessage[],
  format: "markdown" | "json",
  model: string,
  protocol: WireProtocol
) {
  if (messages.length === 0) return;
  let content = "";
  let filename = `bansos-chat-${Date.now()}`;

  if (format === "json") {
    content = JSON.stringify(messages, null, 2);
    filename += ".json";
  } else {
    filename += ".md";
    content = `# Bansos Router Chat Export\nModel: \`${model}\` | Protocol: \`${protocol}\` | Date: ${new Date().toISOString()}\n\n---\n\n`;
    for (const m of messages) {
      const headerRole = m.role === "user" ? "👤 User" : `🤖 Assistant (${m.protocol || "chat"})`;
      content += `### ${headerRole}\n\n`;
      if (m.reasoning) {
        content += `> **Thinking Process**:\n> ${m.reasoning.replaceAll("\n", "\n> ")}\n\n`;
      }
      content += `${m.content}\n\n---\n\n`;
    }
  }

  const blob = new Blob([content], {
    type: format === "json" ? "application/json" : "text/markdown",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
