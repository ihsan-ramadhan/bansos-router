import { useState, useEffect, useCallback } from "preact/hooks";
import { fetchStatus, fetchModels, refreshCatalog } from "./services/api";
import type { DaemonStatus, ModelItem } from "./types/ui";
import { MetricCards } from "./components/MetricCards";
import { ModelCatalog } from "./components/ModelCatalog";
import { HarnessGenerator } from "./components/HarnessGenerator";
import { usePing } from "./hooks/usePing";
import {
  Cpu,
  Wrench,
  Shield,
  MessageSquare,
  RefreshCw,
  Zap,
  ExternalLink,
  Info,
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
    pingSingle,
    pingAll,
    clearPingResults,
  } = usePing();

  const loadStatus = useCallback(async () => {
    try {
      const data = await fetchStatus();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect to daemon");
    } finally {
      setLoadingStatus(false);
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

  return (
    <div className="min-h-screen flex flex-col bg-[#111113] text-[#f4f4f6]">
      {/* Top Header Navbar */}
      <header className="border-b border-[#232329] bg-[#16161a]/90 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="h-16 flex items-center justify-between">
            {/* Logo and Brand */}
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-[#232329] border border-[#2e2e38] flex items-center justify-center text-[#3b82f6] shadow-sm">
                <Zap className="h-5 w-5 fill-[#3b82f6]/20 text-[#3b82f6]" />
              </div>
              <div className="flex items-center gap-2.5">
                <span className="font-semibold text-[15px] tracking-tight text-white">
                  Bansos Router
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#202028] text-[#a1a1aa] border border-[#2c2c36] font-mono">
                  v0.1.7
                </span>
                <span className="hidden md:inline-flex text-[11px] px-2 py-0.5 rounded-full bg-[#202028] text-[#60a5fa] border border-[#2b64e0]/30 font-medium">
                  Free & Keyless
                </span>
              </div>
            </div>

            {/* Right Status Actions */}
            <div className="flex items-center gap-2.5 sm:gap-3">
              {/* Connected / Daemon Pill */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#1a1a20] border border-[#282832] text-xs">
                <span className="relative flex h-2 w-2">
                  <span
                    className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                      status ? "bg-emerald-400" : "bg-rose-400"
                    }`}
                  />
                  <span
                    className={`relative inline-flex rounded-full h-2 w-2 ${
                      status ? "bg-emerald-500" : "bg-rose-500"
                    }`}
                  />
                </span>
                <span className="font-mono text-[#d4d4d8] text-[12px]">
                  {status ? `127.0.0.1:${status.port}` : error ? "Disconnected" : "Connecting..."}
                </span>
                {status && (
                  <span className="hidden sm:inline text-[11px] text-emerald-400 font-medium ml-0.5">
                    • Connected
                  </span>
                )}
              </div>

              {/* Quick Refresh Status Button */}
              <button
                onClick={loadStatus}
                title="Refresh status"
                className="p-2 rounded-lg bg-[#1a1a20] hover:bg-[#23232a] active:bg-[#151518] border border-[#282832] text-[#9393a0] hover:text-white transition cursor-pointer"
              >
                <RefreshCw className={`h-4 w-4 ${loadingStatus ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {/* Sub-header Top Tabs (Tailscale style) */}
          <nav className="flex space-x-1 sm:space-x-2 -mb-px pt-1 overflow-x-auto no-scrollbar scroll-smooth">
            <button
              onClick={() => setActiveTab("catalog")}
              className={`flex items-center gap-2 px-3.5 py-2.5 border-b-2 text-[13px] font-medium transition whitespace-nowrap cursor-pointer ${
                activeTab === "catalog"
                  ? "border-[#2b64e0] text-white"
                  : "border-transparent text-[#9393a0] hover:text-[#e4e4e7] hover:border-[#32323d]"
              }`}
            >
              <Cpu className="h-4 w-4" />
              <span>Models & Health</span>
              {models.length > 0 && (
                <span className="text-[11px] px-1.5 py-0.2 rounded-full bg-[#202028] text-[#a1a1aa] font-mono">
                  {models.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab("harness")}
              className={`flex items-center gap-2 px-3.5 py-2.5 border-b-2 text-[13px] font-medium transition whitespace-nowrap cursor-pointer ${
                activeTab === "harness"
                  ? "border-[#2b64e0] text-white"
                  : "border-transparent text-[#9393a0] hover:text-[#e4e4e7] hover:border-[#32323d]"
              }`}
            >
              <Wrench className="h-4 w-4" />
              <span>Harness Setup</span>
            </button>

            <button
              onClick={() => setActiveTab("relay")}
              className={`flex items-center gap-2 px-3.5 py-2.5 border-b-2 text-[13px] font-medium transition whitespace-nowrap cursor-pointer ${
                activeTab === "relay"
                  ? "border-[#2b64e0] text-white"
                  : "border-transparent text-[#9393a0] hover:text-[#e4e4e7] hover:border-[#32323d]"
              }`}
            >
              <Shield className="h-4 w-4" />
              <span>Relay Egress</span>
            </button>

            <button
              onClick={() => setActiveTab("playground")}
              className={`flex items-center gap-2 px-3.5 py-2.5 border-b-2 text-[13px] font-medium transition whitespace-nowrap cursor-pointer ${
                activeTab === "playground"
                  ? "border-[#2b64e0] text-white"
                  : "border-transparent text-[#9393a0] hover:text-[#e4e4e7] hover:border-[#32323d]"
              }`}
            >
              <MessageSquare className="h-4 w-4" />
              <span>Playground</span>
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content View */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Top Metric Cards */}
        <MetricCards status={status} loading={loadingStatus} />

        {/* Tab 1: Models & Health (Step 2 Active View) */}
        {activeTab === "catalog" && (
          <ModelCatalog
            models={models}
            loading={loadingModels}
            onRefreshCatalog={handleRefreshCatalog}
            refreshing={refreshingCatalog}
            pingResults={pingResults}
            isPingingAll={isPingingAll}
            onPingModel={pingSingle}
            onPingAll={pingAll}
            onClearPings={clearPingResults}
          />
        )}

        {/* Tab 2: Harness Setup (Step 3 Active View) */}
        {activeTab === "harness" && (
          <HarnessGenerator
            models={models}
            daemonPort={status?.port ?? 17070}
          />
        )}

        {/* Tab 3: Relay Egress Placeholder (Step 4) */}
        {activeTab === "relay" && (
          <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-8 shadow-sm text-center">
            <div className="mx-auto h-12 w-12 rounded-xl bg-[#202028] border border-[#2c2c36] flex items-center justify-center text-amber-400 mb-4">
              <Shield className="h-6 w-6" />
            </div>
            <h3 className="text-base font-bold text-white mb-2">
              Relay Egress Manager
            </h3>
            <p className="text-xs text-[#9393a0] max-w-md mx-auto mb-6">
              Bypass IP rate-limits by managing outbound proxy targets and relay workers without restarting the daemon.
            </p>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#121215] border border-[#23232a] text-xs text-[#a1a1aa]">
              <Info className="h-4 w-4 text-amber-400" />
              <span>Scheduled for Step 4 milestone implementation.</span>
            </div>
          </div>
        )}

        {/* Tab 4: Live Playground Placeholder */}
        {activeTab === "playground" && (
          <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-8 shadow-sm text-center">
            <div className="mx-auto h-12 w-12 rounded-xl bg-[#202028] border border-[#2c2c36] flex items-center justify-center text-emerald-400 mb-4">
              <MessageSquare className="h-6 w-6" />
            </div>
            <h3 className="text-base font-bold text-white mb-2">
              Live Test Playground
            </h3>
            <p className="text-xs text-[#9393a0] max-w-md mx-auto mb-6">
              Test streaming SSE completions and verify model outputs directly in the browser against any active model.
            </p>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#121215] border border-[#23232a] text-xs text-[#a1a1aa]">
              <Info className="h-4 w-4 text-emerald-400" />
              <span>Scheduled for Step 4 milestone implementation.</span>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#232329] py-4 bg-[#141417]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#71717a]">
          <div className="flex items-center gap-2">
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
