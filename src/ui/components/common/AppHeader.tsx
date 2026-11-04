import { PanelLeft, Sun, Moon } from "lucide-preact";
import type { DaemonStatus } from "../../types";
import { UpdateNotice } from "./UpdateNotice";

export type NavTab = "models" | "agent" | "relay" | "playground" | "activity" | "logs" | "settings";

interface AppHeaderProps {
  status: DaemonStatus | null;
  loadingStatus: boolean;
  daemonAddress: string;
  isConnected: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

export function AppHeader({
  status,
  loadingStatus,
  daemonAddress,
  isConnected,
  sidebarOpen,
  onToggleSidebar,
  theme,
  onToggleTheme,
}: AppHeaderProps) {
  let statusTextColor = "text-[#a1a1aa]";
  let statusLabel = "Connecting...";

  if (isConnected) {
    statusTextColor = "text-emerald-400";
    statusLabel = "Connected";
  } else if (!loadingStatus && !status) {
    statusTextColor = "text-rose-400";
    statusLabel = "Disconnected";
  }

  return (
    <header className="fixed top-0 left-0 right-0 z-40 w-full h-14 bg-[#0e1017] border-b border-[#1c1f2b] shadow-md shadow-black/40">
      <div className="w-full h-full px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4">
        {/* Left: Sidebar Toggle + Brand */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            aria-expanded={sidebarOpen}
            aria-controls="app-sidebar"
            className="hidden md:flex p-1.5 sm:p-2 rounded-lg text-[#a1a1aa] hover:text-white hover:bg-[#202028] border border-transparent hover:border-[#2e2e38] transition cursor-pointer min-h-10 min-w-10 items-center justify-center shrink-0"
          >
            <PanelLeft className="h-4 w-4" />
          </button>

          <img
            src="/favicon.png"
            alt="Bansos Router"
            className="h-6 w-6 rounded-md border border-[#2e2e38] shrink-0"
          />
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-sm tracking-tight text-white truncate">
              Bansos Router
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[#202028] text-[#a1a1aa] border border-[#2c2c36] font-mono shrink-0">
              v{__APP_VERSION__}
            </span>
            {status?.update?.hasUpdate && <UpdateNotice current={status.update.current} latest={status.update.latest} />}
          </div>
        </div>

        {/* Right: Status Indicator + Theme Toggle */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            className="h-8 w-8 sm:h-8.5 sm:w-8.5 flex items-center justify-center rounded-lg bg-[#131620] hover:bg-[#1a1e2b] border border-[#1e2330] text-[#a1a1aa] hover:text-white transition cursor-pointer"
          >
            {theme === "dark" ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-[#2563eb]" />}
          </button>

          <div className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-[#131620] border border-[#1e2330] text-xs shadow-xs">
            <span className="hidden sm:inline font-mono text-[#d4d4d8] text-[11px] sm:text-[12px] tracking-tight">
              {daemonAddress}
            </span>
            <span className="inline-flex items-center sm:pl-2 sm:border-l border-[#1e2330]">
              <span className={`text-[11px] sm:text-xs font-medium ${statusTextColor}`}>
                {statusLabel}
              </span>
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
