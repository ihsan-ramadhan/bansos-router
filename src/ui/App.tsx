import { useEffect, useMemo, useState } from "preact/hooks";
import type { NavTab } from "./components/common/AppHeader";
import { AppHeader } from "./components/common/AppHeader";
import { AppSidebar } from "./components/common/AppSidebar";
import { MobileBottomNav } from "./components/common/MobileBottomNav";
import { OfflineBanner } from "./components/common/OfflineBanner";
import { MetricCards } from "./components/common/MetricCards";
import { ModelCatalog } from "./components/models/ModelCatalog";
import { AgentSetup } from "./components/agent/AgentSetup";
import { RelayManager } from "./components/relay/RelayManager";
import { Playground } from "./components/playground/Playground";
import { ActivityView } from "./components/activity/ActivityView";
import { LogsView } from "./components/logs/LogsView";
import { SettingsView } from "./components/settings/SettingsView";
import { useDaemonStatus } from "./hooks/useDaemonStatus";
import { usePing } from "./hooks/usePing";

const NAV_TABS: readonly NavTab[] = ["models", "agent", "relay", "playground", "activity", "logs", "settings"];

// Tab state is persisted in localStorage so refresh stays on the last opened tab with a clean URL (no # in address bar)
function initialActiveTab(): NavTab {
  if (typeof window === "undefined") return "models";
  // clean up any lingering hash in address bar
  if (window.location.hash) {
    const fromHash = window.location.hash.replace(/^#/, "");
    if ((NAV_TABS as readonly string[]).includes(fromHash)) {
      try {
        localStorage.setItem("bansos_active_tab", fromHash);
      } catch {}
    }
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  try {
    const saved = localStorage.getItem("bansos_active_tab");
    return saved && (NAV_TABS as readonly string[]).includes(saved) ? (saved as NavTab) : "models";
  } catch {
    return "models";
  }
}

type ThemeMode = "dark" | "light";

function initialTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  try {
    const saved = localStorage.getItem("bansos_theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {}
  return "dark";
}

export function App() {
  const [activeTab, setActiveTab] = useState<NavTab>(initialActiveTab);

  const selectTab = (tab: NavTab) => {
    setActiveTab(tab);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("bansos_active_tab", tab);
      } catch {}
    }
  };
  const [theme, setTheme] = useState<ThemeMode>(initialTheme);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (theme === "light") {
      root.classList.remove("dark");
      root.classList.add("light");
      metaTheme?.setAttribute("content", "#ffffff");
    } else {
      root.classList.remove("light");
      root.classList.add("dark");
      metaTheme?.setAttribute("content", "#090a0f");
    }
    try {
      localStorage.setItem("bansos_theme", theme);
    } catch {}
  }, [theme]);

  const toggleTheme = () => {
    // Disable all transitions during theme swap to eliminate visual tearing and staggered color flashes
    const next = theme === "dark" ? "light" : "dark";
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      root.classList.add("theme-switching");
      if (next === "light") {
        root.classList.remove("dark");
        root.classList.add("light");
      } else {
        root.classList.remove("light");
        root.classList.add("dark");
      }
      const metaTheme = document.querySelector('meta[name="theme-color"]');
      metaTheme?.setAttribute("content", next === "light" ? "#ffffff" : "#090a0f");
      try {
        localStorage.setItem("bansos_theme", next);
      } catch {}
      setTheme(next);
      setTimeout(() => {
        root.classList.remove("theme-switching");
      }, 50);
      return;
    }
    setTheme(next);
  };
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    if (window.innerWidth < 768) return false;
    try {
      const saved = localStorage.getItem("bansos_sidebar_open");
      return saved !== null ? saved === "true" : true;
    } catch {
      return true;
    }
  });

  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      const next = !prev;
      if (typeof window !== "undefined" && window.innerWidth >= 768) {
        try {
          localStorage.setItem("bansos_sidebar_open", String(next));
        } catch {}
      }
      return next;
    });
  };

  // sync sidebar state when crossing the mobile/desktop breakpoint
  useEffect(() => {
    let wasDesktop = typeof window !== "undefined" && window.innerWidth >= 768;
    const handleResize = () => {
      const isDesktop = window.innerWidth >= 768;
      if (wasDesktop !== isDesktop) {
        wasDesktop = isDesktop;
        if (!isDesktop) {
          setSidebarOpen(false);
        } else {
          try {
            const saved = localStorage.getItem("bansos_sidebar_open");
            setSidebarOpen(saved !== null ? saved === "true" : true);
          } catch {
            setSidebarOpen(true);
          }
        }
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

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

  const blockedSources = useMemo(
    () => new Set((status?.providers ?? []).filter((p) => !p.allowed).map((p) => p.id)),
    [status?.providers],
  );
  const usableModels = useMemo(
    () => models.filter((m) => !blockedSources.has(m.source || m.owned_by || "")),
    [models, blockedSources],
  );

  return (
    <div className="min-h-screen md:h-screen flex flex-col bg-[#08090d] text-[#f8fafc] md:overflow-hidden">
      {/* Top Navbar */}
      <AppHeader
        status={status}
        loadingStatus={loadingStatus}
        daemonAddress={daemonAddress}
        isConnected={isConnected}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <div className="flex-1 flex min-h-0 pt-14 md:overflow-hidden">
        <AppSidebar
          activeTab={activeTab}
          onSelectTab={selectTab}
          isOpen={sidebarOpen}
        />

        <div id="main-content-scroll" className="flex-1 min-w-0 flex flex-col md:overflow-y-auto">
          <main className="flex-1 min-h-0 w-full px-3 sm:px-6 py-3.5 sm:py-4 pb-4 flex flex-col space-y-3 sm:space-y-4">
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
            blockedSources={blockedSources}
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
            models={usableModels}
            daemonPort={daemonPort}
            onCatalogStale={() => void loadStatus()}
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
        <div className={activeTab === "playground" ? "flex-1 min-h-0 flex flex-col" : "hidden"}>
          <Playground
            models={usableModels}
            daemonPort={daemonPort}
          />
        </div>

        {/* Tab 5: Activity & Usage */}
        <div className={activeTab === "activity" ? "block" : "hidden"}>
          <ActivityView />
        </div>

        <div className={activeTab === "logs" ? "flex-1 min-h-0 flex flex-col" : "hidden"}>
          <LogsView active={activeTab === "logs"} />
        </div>

        <div className={activeTab === "settings" ? "block" : "hidden"}>
          <SettingsView active={activeTab === "settings"} onApplied={() => void loadStatus()} />
        </div>
          </main>

        </div>
      </div>

      {/* Floating Bottom Nav on Mobile */}
      <MobileBottomNav
        activeTab={activeTab}
        onSelectTab={selectTab}
      />
    </div>
  );
}
