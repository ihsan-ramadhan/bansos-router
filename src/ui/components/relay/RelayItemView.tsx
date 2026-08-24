import { ShieldAlert, Check, Loader2, Zap, Trash2 } from "lucide-preact";
import type { ProbeStatus } from "../../types";

export interface RelayRowItemProps {
  relay: { url: string; label?: string };
  isActive: boolean;
  isEnabled: boolean;
  updating: boolean;
  probeInfo?: ProbeStatus;
  onProbe: (url: string) => void;
  onSetActive: (url: string) => void;
  onRemove: (url: string) => void;
}

export function RelayProbeBadge({ probeInfo }: { probeInfo?: ProbeStatus }) {
  if (probeInfo?.probing) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-blue-400 font-mono">
        <Loader2 className="h-3 w-3 animate-spin shrink-0" />
        <span>Probing...</span>
      </span>
    );
  }
  if (!probeInfo) {
    return <span className="text-[#52525b] text-[11px] font-mono">—</span>;
  }
  if (probeInfo.ok) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono border bg-emerald-950/60 text-emerald-400 border-emerald-800/40">
        <Check className="h-2.5 w-2.5 shrink-0" />
        <span>{probeInfo.latencyMs}ms</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono border bg-rose-950/60 text-rose-400 border-rose-800/40">
      <ShieldAlert className="h-2.5 w-2.5 shrink-0" />
      <span>Unreachable</span>
    </span>
  );
}

function renderRelayStatusBadge(isActive: boolean, isEnabled: boolean) {
  if (!isActive) {
    return <span className="text-[11px] text-[#52525b] font-mono">Saved</span>;
  }
  const textColor = isEnabled ? "text-emerald-400" : "text-amber-400";
  const dotColor = isEnabled ? "bg-emerald-400" : "bg-amber-400";
  const label = isEnabled ? "Active & Routing" : "Selected (Standby)";
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${textColor}`}>
      <span className={`h-2 w-2 rounded-full shrink-0 ${dotColor}`} />
      <span>{label}</span>
    </span>
  );
}

export function RelayRowItem({
  relay,
  isActive,
  isEnabled,
  updating,
  probeInfo,
  onProbe,
  onSetActive,
  onRemove,
}: RelayRowItemProps) {
  const statusBadge = renderRelayStatusBadge(isActive, isEnabled);

  return (
    <tr className={`hover:bg-[#19191f] transition-colors ${isActive ? "bg-[#141419]" : ""}`}>
      {/* Status */}
      <td className="py-3 px-3 whitespace-nowrap">{statusBadge}</td>

      {/* URL */}
      <td className="py-3 px-3 font-mono text-white text-xs break-all min-w-[180px]">{relay.url}</td>

      {/* Health / Latency badge */}
      <td className="py-3 px-3 whitespace-nowrap">
        <RelayProbeBadge probeInfo={probeInfo} />
      </td>

      {/* Label */}
      <td className="py-3 px-3 text-[#9393a0] whitespace-nowrap">
        {relay.label ? (
          <span className="px-2 py-0.5 rounded-md bg-[#202028] text-xs text-[#d4d4d8] border border-[#282832]">
            {relay.label}
          </span>
        ) : (
          <span className="text-[#52525b] italic">—</span>
        )}
      </td>

      {/* Actions */}
      <td className="py-3 px-3 text-right whitespace-nowrap">
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => onProbe(relay.url)}
            disabled={updating || probeInfo?.probing}
            className="p-1.5 rounded-md text-[#71717a] hover:text-amber-400 hover:bg-amber-950/40 transition cursor-pointer disabled:opacity-40"
            title="Ping relay"
            aria-label="Ping relay"
          >
            {probeInfo?.probing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#3b82f6]" />
            ) : (
              <Zap className="h-3.5 w-3.5" />
            )}
          </button>

          {!isActive ? (
            <button
              type="button"
              onClick={() => onSetActive(relay.url)}
              disabled={updating}
              className="p-1.5 rounded-md text-[#71717a] hover:text-emerald-400 hover:bg-emerald-950/40 transition cursor-pointer disabled:opacity-40"
              title="Use relay"
              aria-label="Use relay"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          ) : (
            <span
              className={`p-1.5 flex items-center justify-center ${
                isEnabled ? "text-emerald-400" : "text-amber-400"
              }`}
              title={isEnabled ? "Active" : "Selected"}
            >
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  isEnabled ? "bg-emerald-400 ring-2 ring-emerald-400/30 animate-pulse" : "bg-amber-400 ring-2 ring-amber-400/30"
                }`}
              />
            </span>
          )}

          <button
            type="button"
            onClick={() => onRemove(relay.url)}
            disabled={updating}
            className="p-1.5 rounded-md text-[#71717a] hover:text-rose-400 hover:bg-rose-950/40 transition cursor-pointer disabled:opacity-40"
            title="Delete relay"
            aria-label="Delete relay"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

export function RelayCardItem({
  relay,
  isActive,
  isEnabled,
  updating,
  probeInfo,
  onProbe,
  onSetActive,
  onRemove,
}: RelayRowItemProps) {
  const statusBadge = renderRelayStatusBadge(isActive, isEnabled);

  return (
    <div
      className={`rounded-xl border p-3.5 space-y-3 transition-colors ${
        isActive
          ? "bg-[#141419] border-[#2b64e0]/40"
          : "bg-[#121215] border-[#23232a] hover:border-[#2e2e38]"
      }`}
    >
      {/* Top row: Status + Label + Probe */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 min-w-0">
          {statusBadge}
          {relay.label && (
            <span className="px-2 py-0.5 rounded-md bg-[#202028] text-[11px] text-[#d4d4d8] border border-[#282832] truncate max-w-[140px]">
              {relay.label}
            </span>
          )}
        </div>

        <RelayProbeBadge probeInfo={probeInfo} />
      </div>

      {/* URL */}
      <div className="p-2.5 rounded-lg bg-[#0d0d10] border border-[#1f1f26]">
        <div className="text-[10px] uppercase font-mono tracking-wider text-[#71717a] mb-0.5">
          Relay Worker
        </div>
        <div className="font-mono text-white text-xs break-all select-all">
          {relay.url}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#1f1f26]">
        <button
          type="button"
          onClick={() => onProbe(relay.url)}
          disabled={updating || probeInfo?.probing}
          className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#1a1a20] hover:bg-[#22222a] border border-[#282832] text-xs font-medium text-[#d4d4d8] hover:text-white transition cursor-pointer disabled:opacity-50"
        >
          {probeInfo?.probing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#3b82f6]" />
          ) : (
            <Zap className="h-3.5 w-3.5 text-amber-400" />
          )}
          <span>Ping</span>
        </button>

        <div className="flex items-center gap-1.5">
          {!isActive ? (
            <button
              type="button"
              onClick={() => onSetActive(relay.url)}
              disabled={updating}
              className="min-h-[34px] inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-[#202028] hover:bg-[#282834] text-xs font-medium text-emerald-400 border border-emerald-800/40 hover:border-emerald-700 transition cursor-pointer disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              <span>Use Node</span>
            </button>
          ) : (
            <span
              className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-medium border flex items-center gap-1.5 ${
                isEnabled
                  ? "bg-emerald-950/60 text-emerald-400 border-emerald-800/40"
                  : "bg-amber-950/60 text-amber-400 border-amber-800/40"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  isEnabled
                    ? "bg-emerald-400 animate-pulse"
                    : "bg-amber-400"
                }`}
              />
              <span>{isEnabled ? "Active" : "Selected"}</span>
            </span>
          )}

          <button
            type="button"
            onClick={() => onRemove(relay.url)}
            disabled={updating}
            className="min-h-[34px] min-w-[34px] flex items-center justify-center p-1.5 rounded-lg text-[#71717a] hover:text-rose-400 hover:bg-rose-950/40 transition cursor-pointer disabled:opacity-50"
            title="Delete relay"
            aria-label="Delete relay"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
