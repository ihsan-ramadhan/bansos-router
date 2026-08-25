import { Zap } from "lucide-preact";

interface OfflineBannerProps {
  daemonAddress: string;
  loadingStatus: boolean;
  onRetry: () => void;
}

export function OfflineBanner({ daemonAddress, loadingStatus, onRetry }: OfflineBannerProps) {
  return (
    <div className="rounded-xl border border-rose-800/60 bg-rose-950/40 p-3 sm:p-4 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-rose-200 animate-in fade-in">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-rose-900/60 text-rose-300 border border-rose-700/50 shrink-0">
          <Zap className="h-4 w-4" />
        </div>
        <div className="space-y-0.5 min-w-0">
          <span className="font-semibold text-white block text-xs sm:text-sm">Daemon Disconnected</span>
          <span className="text-[#a1a1aa] block text-[11px] sm:text-xs">
            Cannot connect to Bansos Router daemon at{" "}
            <code className="text-white font-mono bg-[#16161a] px-1 py-0.5 rounded border border-[#282832]">
              {daemonAddress}
            </code>
            . Make sure the service is running.
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 self-stretch sm:self-auto shrink-0 font-mono w-full sm:w-auto justify-end">
        <span className="px-2.5 py-1 rounded bg-[#16161a] border border-[#282832] text-white text-[11px] select-all truncate">
          bansos start
        </span>
        <button
          type="button"
          onClick={onRetry}
          disabled={loadingStatus}
          className="px-3 py-1 rounded bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-sans text-xs font-semibold cursor-pointer transition disabled:opacity-50 shrink-0"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
