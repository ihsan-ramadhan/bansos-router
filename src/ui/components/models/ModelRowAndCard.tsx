import type { ModelItem, PingResult } from "../../types";
import { Loader2, CheckCircle2, AlertTriangle, XCircle, Sparkles, Check, Copy, Zap, Eye } from "lucide-preact";
import { formatTokens, getProviderBadgeColor } from "../../utils/models";

export function ModelPingStatusCell({ ping }: { ping?: PingResult }) {
  if (!ping || ping.status === "idle") {
    return <span className="text-[11px] text-[#52525b] font-mono">Untested</span>;
  }
  if (ping.status === "pinging") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[#60a5fa] font-mono">
        <Loader2 className="h-3 w-3 animate-spin shrink-0" />
        <span>Pinging...</span>
      </span>
    );
  }
  if (ping.status === "ok") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-mono text-emerald-400 font-medium">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <span>{ping.latencyMs}ms</span>
      </span>
    );
  }
  if (ping.status === "rate_limited") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-mono text-amber-400 font-medium">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span>429 ({ping.latencyMs}ms)</span>
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-mono text-rose-400 font-medium"
      title={ping.error || "Ping failed"}
    >
      <XCircle className="h-3.5 w-3.5 shrink-0" />
      <span>Offline {ping.statusCode ? `(${ping.statusCode})` : ""}</span>
    </span>
  );
}

export interface ModelCatalogRowProps {
  model: ModelItem;
  ping?: PingResult;
  copiedId: string | null;
  onCopy: (id: string) => void;
  onPingModel: (model: ModelItem) => Promise<void>;
}

export function ModelCatalogRow({ model, ping, copiedId, onCopy, onPingModel }: ModelCatalogRowProps) {
  const contextLimit = model.context_window || model.context_length;
  const outputLimit = model.max_tokens || model.maxTokens;
  const provider = model.source || model.owned_by;
  const showBadge = provider && provider.toLowerCase() !== "bansos";
  const isPinging = ping?.status === "pinging";

  return (
    <tr className="hover:bg-[#1a1a20] transition-colors duration-150 group">
      {/* Model info */}
      <td className="py-3 px-3 sm:px-4">
        <div className="flex flex-col gap-1 min-w-40 sm:min-w-50">
          <div className="flex items-center gap-2">
            <span className="font-mono font-medium text-white text-xs sm:text-[13px] group-hover:text-[#60a5fa] transition">
              {model.id}
            </span>
            <button
              type="button"
              onClick={() => onCopy(model.id)}
              className="p-1 rounded text-[#71717a] hover:text-white hover:bg-[#23232b] active:scale-90 transition cursor-pointer shrink-0"
              title={copiedId === model.id ? "Copied!" : "Copy model ID"}
              aria-label={`Copy model ID ${model.id}`}
            >
              {copiedId === model.id ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
            {showBadge && (
              <span
                className={`text-[9px] sm:text-[10px] px-1.5 sm:px-2 py-0.2 sm:py-0.5 rounded-full border font-medium uppercase tracking-wider shrink-0 ${getProviderBadgeColor(
                  provider
                )}`}
              >
                {provider}
              </span>
            )}
          </div>
          {model.name && model.name !== model.id && (
            <span className="text-[10px] sm:text-[11px] text-[#71717a] truncate">{model.name}</span>
          )}
        </div>
      </td>

      {/* Capabilities */}
      <td className="py-3 px-3 sm:px-4 whitespace-nowrap">
        <div className="flex flex-wrap items-center gap-1.5">
          {model.reasoning && (
            <span className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-medium text-emerald-400 bg-emerald-950/60 border border-emerald-800/50 px-2 py-0.5 rounded-md">
              <Sparkles className="h-3 w-3 shrink-0" /> Think
            </span>
          )}
          {Array.isArray(model.input) && model.input.includes("image") && (
            <span className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-medium text-amber-400 bg-amber-950/60 border border-amber-800/50 px-2 py-0.5 rounded-md">
              <Eye className="h-3 w-3 shrink-0" /> Vision
            </span>
          )}
          {!model.reasoning && !(Array.isArray(model.input) && model.input.includes("image")) && (
            <span className="text-[#52525c] text-[11px] font-mono">-</span>
          )}
        </div>
      </td>

      {/* Context */}
      <td className="py-3 px-3 sm:px-4 whitespace-nowrap">
        <span className="font-mono text-xs text-[#d4d4d8]">{formatTokens(contextLimit)}</span>
      </td>

      {/* Max output */}
      <td className="py-3 px-3 sm:px-4 whitespace-nowrap">
        <span className="font-mono text-xs text-[#a1a1aa]">{formatTokens(outputLimit)}</span>
      </td>

      {/* Latency status */}
      <td className="py-3 px-3 sm:px-4 whitespace-nowrap">
        <ModelPingStatusCell ping={ping} />
      </td>

      {/* Action */}
      <td className="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
        <button
          type="button"
          onClick={() => onPingModel(model)}
          disabled={isPinging}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#202026] hover:bg-[#282832] active:bg-[#1a1a20] border border-[#2a2a34] hover:border-[#383846] text-[11px] font-medium text-[#d4d4d8] hover:text-white transition cursor-pointer disabled:opacity-50"
          title={`Ping live response from ${model.id}`}
        >
          {isPinging ? (
            <Loader2 className="h-3 w-3 animate-spin text-[#3b82f6] shrink-0" />
          ) : (
            <Zap className="h-3 w-3 text-amber-400 shrink-0" />
          )}
          <span>Ping</span>
        </button>
      </td>
    </tr>
  );
}

export interface ModelCardProps {
  model: ModelItem;
  ping?: PingResult;
  copiedId: string | null;
  onCopy: (id: string) => void;
  onPingModel: (model: ModelItem) => Promise<void>;
}

export function ModelCard({ model, ping, copiedId, onCopy, onPingModel }: ModelCardProps) {
  const contextLimit = model.context_window || model.context_length;
  const outputLimit = model.max_tokens || model.maxTokens;
  const provider = model.source || model.owned_by;
  const showBadge = provider && provider.toLowerCase() !== "bansos";
  const isPinging = ping?.status === "pinging";

  return (
    <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-2.5 sm:p-3 transition-colors hover:border-[#2e2e38] flex flex-col gap-2 shadow-xs">
      {/* Top row: Model ID, Copy, Provider & Capability Badges */}
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="font-mono font-semibold text-white text-xs sm:text-[13px] truncate" title={model.id}>
            {model.id}
          </span>
          <button
            type="button"
            onClick={() => onCopy(model.id)}
            className="p-1 rounded text-[#71717a] hover:text-white hover:bg-[#23232b] active:scale-90 transition cursor-pointer shrink-0"
            title={copiedId === model.id ? "Copied!" : "Copy model ID"}
            aria-label={`Copy model ID ${model.id}`}
          >
            {copiedId === model.id ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {showBadge && (
            <span
              className={`text-[9px] px-1.5 py-0.2 rounded-full border font-medium uppercase tracking-wider shrink-0 ${getProviderBadgeColor(
                provider
              )}`}
            >
              {provider}
            </span>
          )}
          {model.reasoning && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-medium text-emerald-400 bg-emerald-950/60 border border-emerald-800/50 px-1.5 py-0.2 rounded-md shrink-0">
              <Sparkles className="h-2.5 w-2.5 shrink-0" /> Think
            </span>
          )}
          {Array.isArray(model.input) && model.input.includes("image") && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-medium text-amber-400 bg-amber-950/60 border border-amber-800/50 px-1.5 py-0.2 rounded-md shrink-0">
              <Eye className="h-2.5 w-2.5 shrink-0" /> Vision
            </span>
          )}
        </div>
      </div>

      {/* Optional Name */}
      {model.name && model.name !== model.id && (
        <p className="text-[11px] text-[#71717a] truncate -mt-1" title={model.name}>
          {model.name}
        </p>
      )}

      {/* Bottom row: Meta Specs (Ctx & Max) + Ping status & action */}
      <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-[#1f1f26]">
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-[#9393a0] truncate">
          <span><span className="text-[#60606b]">Ctx:</span> <strong className="font-medium text-[#d4d4d8]">{formatTokens(contextLimit)}</strong></span>
          <span className="text-[#3f3f46]">•</span>
          <span><span className="text-[#60606b]">Max:</span> <strong className="font-medium text-[#a1a1aa]">{formatTokens(outputLimit)}</strong></span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <ModelPingStatusCell ping={ping} />
          <button
            type="button"
            onClick={() => onPingModel(model)}
            disabled={isPinging}
            className="min-h-7 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-[#202026] hover:bg-[#282832] active:bg-[#1a1a20] border border-[#2a2a34] text-[11px] font-medium text-[#d4d4d8] hover:text-white transition cursor-pointer disabled:opacity-50 shrink-0"
            title={`Ping live response from ${model.id}`}
          >
            {isPinging ? (
              <Loader2 className="h-3 w-3 animate-spin text-[#3b82f6] shrink-0" />
            ) : (
              <Zap className="h-3 w-3 text-amber-400 shrink-0" />
            )}
            <span>Ping</span>
          </button>
        </div>
      </div>
    </div>
  );
}
