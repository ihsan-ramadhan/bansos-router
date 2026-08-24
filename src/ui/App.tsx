import { useState, useEffect, useCallback } from "preact/hooks";
import { fetchStatus, fetchModels, refreshCatalog } from "./services/api";
import type { DaemonStatus, ModelItem } from "./types/ui";
import { MetricCards } from "./components/MetricCards";
import { ModelCatalog } from "./components/ModelCatalog";
import { HarnessGenerator } from "./components/HarnessGenerator";
import { RelayManager } from "./components/RelayManager";
import { Playground } from "./components/Playground";
import { usePing } from "./hooks/usePing";
import {
  Cpu,
  Wrench,
  Shield,
  MessageSquare,
  RefreshCw,
  Zap,
  ExternalLink,
} from "lucide-preact";

export function App() {
  const [activeTab, setActiveTab] = useState<"catalog" | "harness" | "relay" | "playground">("catalog");
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  const [models, setModels] = useState<ModelItem[]>([]);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingModels, setLoadingModels] = useState(true);
  const [refreshingCatalog, setRefreshingCatalog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    pingResults,
    isPingingAll,
    pingProgress,
    pingSingle,
    pingAll,
    cancelPing,
    clearPingResults,
  } = usePing();

  const loadStatus = useCallback(async (manual = false) => {
    if (manual) {
      setLoadingStatus(true);
    }
    try {
      const [statusData, modelsRes] = await Promise.all([
        fetchStatus(),
        fetchModels(),
      ]);
      setStatus(statusData);
      setModels(modelsRes.data || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect to daemon");
    } finally {
      if (manual) {
        setTimeout(() => setLoadingStatus(false), 500);
      } else {
        setLoadingStatus(false);
      }
      setLoadingModels(false);
    }
  }, []);

  const loadModels = useCallback(async () => {
    try {
      setLoadingModels(true);
      const res = await fetchModels();
      setModels(res.data || []);
    } catch (err) {
      console.error("Failed to load models:", err);
    } finally {
      setLoadingModels(false);
    }
  }, []);

  const handleRefreshCatalog = useCallback(async () => {
    setRefreshingCatalog(true);
    try {
      await refreshCatalog();
      await Promise.all([loadModels(), loadStatus()]);
    } catch (err) {
      console.error("Failed to refresh catalog:", err);
    } finally {
      setRefreshingCatalog(false);
    }
  }, [loadModels, loadStatus]);

  useEffect(() => {
    loadStatus();
    loadModels();

    const interval = setInterval(loadStatus, 5000);
    return () => clearInterval(interval);
  }, [loadStatus, loadModels]);

  const daemonHost = typeof window !== "undefined" && window.location.hostname && window.location.hostname !== "localhost"
    ? window.location.hostname
    : "127.0.0.1";
  const daemonPort = status?.port ?? 17070;
  const daemonAddress = `${daemonHost}:${daemonPort}`;

  const isConnected = Boolean(status && !error);
  const isConnecting = loadingStatus && !status;

  let statusColor = "bg-[#71717a]";
  let statusPingColor = "bg-[#71717a]";
  let statusTextColor = "text-[#a1a1aa]";
  let statusLabel = "Connecting...";

  if (isConnected) {
    statusColor = "bg-emerald-500";
    statusPingColor = "bg-emerald-400";
    statusTextColor = "text-emerald-400";
    statusLabel = "Connected";
  } else if (!loadingStatus && (error || !status)) {
    statusColor = "bg-rose-500";
    statusPingColor = "bg-rose-400";
    statusTextColor = "text-rose-400";
    statusLabel = "Disconnected";
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#111113] text-[#f4f4f6]">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 w-full bg-[#16161a] border-b border-[#232329] shadow-lg shadow-black/40">
        <div className="max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8">
          <div className="h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-4">
            {/* Logo */}
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg bg-[#232329] border border-[#2e2e38] flex items-center justify-center text-[#3b82f6] shadow-xs shrink-0">
                <Zap className="h-4 w-4 sm:h-5 sm:w-5 fill-[#3b82f6]/20 text-[#3b82f6]" />
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0">
                <span className="font-semibold text-sm sm:text-[15px] tracking-tight text-white truncate">
                  Bansos Router
                </span>
                <span className="text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-0.5 rounded-full bg-[#202028] text-[#a1a1aa] border border-[#2c2c36] font-mono shrink-0">
                  v{__APP_VERSION__}
                </span>
                <span className="hidden md:inline-flex text-[11px] px-2 py-0.5 rounded-full bg-[#202028] text-[#60a5fa] border border-[#2b64e0]/30 font-medium shrink-0">
                  Free & Keyless
                </span>
              </div>
            </div>

            {/* Status Indicator */}
            <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
              {/* Daemon status badge */}
              <div className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-[#1a1a20] border border-[#282832] text-xs shadow-xs">
                <span className="hidden sm:inline font-mono text-[#d4d4d8] text-[11px] sm:text-[12px] tracking-tight">
                  {daemonAddress}
                </span>
                <span className="inline-flex items-center gap-1.5 sm:pl-2 sm:border-l sm:border-[#2e2e3a]">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span
                      className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${statusPingColor}`}
                    />
                    <span
                      className={`relative inline-flex rounded-full h-2 w-2 ${statusColor}`}
                    />
                  </span>
                  <span className={`text-[11px] sm:text-xs font-medium ${statusTextColor}`}>
                    {statusLabel}
                  </span>
                </span>
              </div>
            </div>
          </div>

      {/* Navigation */}
          <nav className="flex space-x-1 sm:space-x-2 -mb-px pt-1 overflow-x-auto no-scrollbar scroll-smooth w-full min-w-0">
            <button
              type="button"
              onClick={() => setActiveTab("catalog")}
              className={`shrink-0 flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-2 sm:py-2.5 border-b-2 text-xs sm:text-[13px] font-medium transition whitespace-nowrap cursor-pointer min-h-[42px] ${
                activeTab === "catalog"
                  ? "border-[#2b64e0] text-white"
                  : "border-transparent text-[#9393a0] hover:text-[#e4e4e7] hover:border-[#32323d]"
              }`}
            >
              <Cpu className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
              <span>Models</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("harness")}
              className={`shrink-0 flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-2 sm:py-2.5 border-b-2 text-xs sm:text-[13px] font-medium transition whitespace-nowrap cursor-pointer min-h-[42px] ${
                activeTab === "harness"
                  ? "border-[#2b64e0] text-white"
                  : "border-transparent text-[#9393a0] hover:text-[#e4e4e7] hover:border-[#32323d]"
              }`}
            >
              <Wrench className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
              <span>Agent Setup</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("relay")}
              className={`shrink-0 flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-2 sm:py-2.5 border-b-2 text-xs sm:text-[13px] font-medium transition whitespace-nowrap cursor-pointer min-h-[42px] ${
                activeTab === "relay"
                  ? "border-[#2b64e0] text-white"
                  : "border-transparent text-[#9393a0] hover:text-[#e4e4e7] hover:border-[#32323d]"
              }`}
            >
              <Shield className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
              <span>Relay Proxy</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("playground")}
              className={`shrink-0 flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-2 sm:py-2.5 border-b-2 text-xs sm:text-[13px] font-medium transition whitespace-nowrap cursor-pointer min-h-[42px] ${
                activeTab === "playground"
                  ? "border-[#2b64e0] text-white"
                  : "border-transparent text-[#9393a0] hover:text-[#e4e4e7] hover:border-[#32323d]"
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
              <span>Playground</span>
            </button>
          </nav>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 pt-[116px] sm:pt-[128px] pb-6 sm:pb-8 space-y-4 sm:space-y-6">
        {/* Offline Banner */}
        {!isConnected && !isConnecting && (
          <div className="rounded-xl border border-rose-800/60 bg-rose-950/40 p-3 sm:p-4 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-rose-200 animate-in fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-rose-900/60 text-rose-300 border border-rose-700/50 shrink-0">
                <Zap className="h-4 w-4" />
              </div>
              <div className="space-y-0.5 min-w-0">
                <span className="font-semibold text-white block text-xs sm:text-sm">Daemon Disconnected</span>
                <span className="text-[#a1a1aa] block text-[11px] sm:text-xs">
                  Cannot connect to Bansos Router daemon at <code className="text-white font-mono bg-[#16161a] px-1 py-0.5 rounded border border-[#282832]">{daemonAddress}</code>. Make sure the service is running.
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 self-stretch sm:self-auto shrink-0 font-mono w-full sm:w-auto justify-end">
              <span className="px-2.5 py-1 rounded bg-[#16161a] border border-[#282832] text-white text-[11px] select-all truncate">
                bansos start
              </span>
              <button
                type="button"
                onClick={() => loadStatus(true)}
                disabled={loadingStatus}
                className="px-3 py-1 rounded bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-sans text-xs font-semibold cursor-pointer transition disabled:opacity-50 shrink-0"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Metrics */}
        <MetricCards status={status} loading={loadingStatus} daemonAddress={daemonAddress} />

        {/* Model Catalog */}
        {activeTab === "catalog" && (
          <ModelCatalog
            models={models}
            loading={loadingModels}
            onRefreshCatalog={handleRefreshCatalog}
            refreshing={refreshingCatalog}
            pingResults={pingResults}
            isPingingAll={isPingingAll}
            pingProgress={pingProgress}
            onPingModel={pingSingle}
            onPingAll={pingAll}
            onCancelPing={cancelPing}
            onClearPings={clearPingResults}
          />
        )}

        {/* Agent Setup */}
        {activeTab === "harness" && (
          <HarnessGenerator
            models={models}
            daemonPort={status?.port ?? 17070}
          />
        )}

        {/* Relay Proxy */}
        {activeTab === "relay" && (
          <RelayManager
            daemonPort={status?.port ?? 17070}
            onStateChange={loadStatus}
          />
        )}

        {/* Playground */}
        {activeTab === "playground" && (
          <Playground
            models={models}
            daemonPort={status?.port ?? 17070}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#232329] py-4 bg-[#141417] mt-auto">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#71717a]">
          <div className="flex items-center gap-2 text-center sm:text-left">
            <span className="font-medium text-[#a1a1aa]">Bansos Router</span>
            <span>•</span>
            <span>Free & Keyless Coding Models</span>
          </div>
          <div className="flex items-center gap-4 text-[11px]">
            <a
              href="https://github.com/ihsan-ramadhan/bansos-router"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[#8b8b96] hover:text-white transition cursor-pointer"
            >
              <span>GitHub</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
