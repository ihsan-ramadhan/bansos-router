import { Shield, ShieldAlert, Check, Info, Loader2, Zap, X } from "lucide-preact";
import type { NotificationType } from "../../types";
import { getNotificationClasses } from "../../utils/relay";

interface RelayHeaderProps {
  isEnabled: boolean;
  activeUrl?: string;
  updating: boolean;
  loading: boolean;
  onToggleEnabled: () => void;
  onTestLatency: () => void;
  testingLatency: boolean;
  latencyResult: { ms?: number; ok?: boolean; error?: string } | null;
  notification: { type: NotificationType; message: string } | null;
  onDismissNotification: () => void;
}

export function RelayHeader({
  isEnabled,
  activeUrl,
  updating,
  loading,
  onToggleEnabled,
  onTestLatency,
  testingLatency,
  latencyResult,
  notification,
  onDismissNotification,
}: RelayHeaderProps) {
  return (
    <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-4 sm:p-5 shadow-xs space-y-4">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="p-1.5 rounded-lg bg-teal-500/10 text-teal-400 border border-teal-500/20 shrink-0">
              <Shield className="h-4 w-4" />
            </div>
            <h2 className="text-sm sm:text-base font-bold text-white tracking-tight">
              Relay Proxy
            </h2>
          </div>
          <p className="text-xs text-[#9393a0]">
            Route outbound AI requests through Cloudflare Workers, Vercel Edge, or custom proxies to bypass upstream IP rate limits.
          </p>
        </div>

        <div className="flex items-center gap-3 self-stretch sm:self-auto justify-between sm:justify-end bg-[#121215] border border-[#23232a] px-3 py-2 rounded-xl shrink-0">
          <div className="text-left sm:text-right">
            <div className="text-[10px] text-[#71717a] uppercase font-mono tracking-wider">
              Proxy Routing
            </div>
            <div className="text-xs font-semibold">
              {isEnabled ? (
                <span className="text-emerald-400">Active</span>
              ) : (
                <span className="text-[#8b8b96]">Disabled</span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onToggleEnabled}
            disabled={updating || loading}
            aria-label="Toggle Relay Egress"
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              isEnabled ? "bg-emerald-500" : "bg-[#282832]"
            } ${updating || loading ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                isEnabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Active relay summary */}
      {activeUrl && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-[#23232a] text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] sm:text-[11px] font-mono text-[#71717a] uppercase tracking-wider shrink-0">
              Active Proxy:
            </span>
            <span className="font-mono text-white font-medium text-xs truncate">
              {activeUrl}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onTestLatency}
              disabled={testingLatency}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#202026] hover:bg-[#282832] border border-[#2e2e38] text-[11px] font-medium text-[#d4d4d8] hover:text-white transition cursor-pointer disabled:opacity-50"
              title="Test active proxy latency and response"
            >
              {testingLatency ? (
                <Loader2 className="h-3 w-3 animate-spin text-[#3b82f6] shrink-0" />
              ) : (
                <Zap className="h-3 w-3 text-amber-400 shrink-0" />
              )}
              <span>{testingLatency ? "Testing..." : "Test Latency"}</span>
            </button>

            {latencyResult && (
              <span
                className={`text-[10px] sm:text-[11px] px-2 py-0.5 rounded-full border font-mono ${
                  latencyResult.ok
                    ? "bg-emerald-950/60 text-emerald-400 border-emerald-800/40"
                    : "bg-rose-950/60 text-rose-400 border-rose-800/40"
                }`}
              >
                {latencyResult.ok ? `${latencyResult.ms}ms` : "Unreachable"}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Notification banner */}
      {notification && (
        <div
          className={`p-3 rounded-lg border flex items-center justify-between text-xs transition-all ${getNotificationClasses(
            notification.type
          )}`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {notification.type === "info" && <Info className="h-4 w-4 text-blue-400 shrink-0" />}
            {notification.type === "success" && <Check className="h-4 w-4 text-emerald-400 shrink-0" />}
            {notification.type === "error" && <ShieldAlert className="h-4 w-4 text-rose-400 shrink-0" />}
            <span className="truncate">{notification.message}</span>
          </div>
          <button
            type="button"
            onClick={onDismissNotification}
            className="p-1 rounded-md text-rose-400 hover:text-rose-200 hover:bg-rose-900/40 ml-3 cursor-pointer transition flex items-center justify-center shrink-0"
            title="Dismiss"
            aria-label="Dismiss notification"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
