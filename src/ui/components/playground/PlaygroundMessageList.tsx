import { Bot, User, Sparkles, ChevronDown, Check, Copy, AlertCircle } from "lucide-preact";
import type { ChatMessage } from "../../types";

interface PlaygroundMessageListProps {
  messages: ChatMessage[];
  isLoading: boolean;
  selectedModel: string;
  liveReasoning: string;
  liveContent: string;
  globalError: string | null;
  openReasoningMap: Record<number, boolean>;
  onToggleReasoning: (idx: number) => void;
  copiedMsgIdx: number | null;
  onCopyMessage: (content: string, idx: number) => void;
}

export function PlaygroundMessageList({
  messages,
  isLoading,
  selectedModel,
  liveReasoning,
  liveContent,
  globalError,
  openReasoningMap,
  onToggleReasoning,
  copiedMsgIdx,
  onCopyMessage,
}: PlaygroundMessageListProps) {
  if (messages.length === 0 && !isLoading) {
    return (
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
    );
  }

  return (
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
                onClick={() => onCopyMessage(msg.content, idx)}
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
                onClick={() => onToggleReasoning(idx)}
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
  );
}
