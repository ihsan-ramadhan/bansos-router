import type { WireProtocol } from "./common";

export interface CompletionMetrics {
  ttftMs?: number;
  totalMs?: number;
  tokenCount?: number;
  tokensPerSec?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ChatMessage {
  id?: string;
  role: "system" | "user" | "assistant";
  content: string;
  reasoning?: string;
  protocol?: WireProtocol;
  metrics?: CompletionMetrics;
  error?: string;
}

export interface NonStreamParsedResult {
  content: string;
  reasoning?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface BuildPayloadOptions {
  protocol: WireProtocol;
  model: string;
  messages: ChatMessage[];
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  reasoningEffort: "auto" | "low" | "medium" | "high";
  stream: boolean;
}
