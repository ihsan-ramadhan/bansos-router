import { useState } from "preact/hooks";
import type { NavTab } from "./components/common/AppHeader";
import { AppHeader } from "./components/common/AppHeader";
import { OfflineBanner } from "./components/common/OfflineBanner";
import { MetricCards } from "./components/common/MetricCards";
import { ModelCatalog } from "./components/models/ModelCatalog";
import { AgentSetup } from "./components/agent/AgentSetup";
import { RelayManager } from "./components/relay/RelayManager";
import { Playground } from "./components/playground/Playground";
import { ActivityView } from "./components/activity/ActivityView";
import { useDaemonStatus } from "./hooks/useDaemonStatus";
import { usePing } from "./hooks/usePing";
import { ExternalLink } from "lucide-preact";

export function App() {
  const [activeTab, setActiveTab] = useState<NavTab>("models");

  const {
    status,
    models,
    loadingStatus,
    loadingModels,
    refreshingCatalog,
    daemonPort,
    daemonAddress,
    isConnected,
    isConnecting,
    loadStatus,
    handleRefreshCatalog,
  } = useDaemonStatus();

  const {
    pingResults,
    isPingingAll,
    pingProgress,
    pingSingle,
    pingAll,
    cancelPing,
    clearPingResults,
  } = usePing();

  return (
    <div className="min-h-screen flex flex-col bg-[#111113] text-[#f4f4f6]">
      {/* Top Navbar */}
      <AppHeader
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        status={status}
        loadingStatus={loadingStatus}
        daemonAddress={daemonAddress}
        isConnected={isConnected}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 pt-29 sm:pt-32 pb-6 sm:pb-8 space-y-4 sm:space-y-6">
        {/* Offline Alert Banner */}
        {!isConnected && !isConnecting && (
          <OfflineBanner
            daemonAddress={daemonAddress}
            loadingStatus={loadingStatus}
            onRetry={() => loadStatus(true)}
          />
        )}

        {/* Global Metric Cards */}
        <MetricCards status={status} loading={loadingStatus} daemonAddress={daemonAddress} />

        {/* Tab 1: Model Catalog */}
        <div className={activeTab === "models" ? "block" : "hidden"}>
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
        </div>

        {/* Tab 2: Agent Setup */}
        <div className={activeTab === "agent" ? "block" : "hidden"}>
          <AgentSetup
            models={models}
            daemonPort={daemonPort}
          />
        </div>

        {/* Tab 3: Relay Proxy */}
        <div className={activeTab === "relay" ? "block" : "hidden"}>
          <RelayManager
            daemonPort={daemonPort}
            onStateChange={loadStatus}
          />
        </div>

        {/* Tab 4: Playground */}
        <div className={activeTab === "playground" ? "block" : "hidden"}>
          <Playground
            models={models}
            daemonPort={daemonPort}
          />
        </div>

        {/* Tab 5: Activity & Usage */}
        <div className={activeTab === "activity" ? "block" : "hidden"}>
          <ActivityView />
        </div>
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
