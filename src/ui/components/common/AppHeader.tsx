import { Cpu, Wrench, Shield, MessageSquare, Activity } from "lucide-preact";
import type { DaemonStatus } from "../../types";

export type NavTab = "models" | "agent" | "relay" | "playground" | "activity";

interface AppHeaderProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  status: DaemonStatus | null;
  loadingStatus: boolean;
  daemonAddress: string;
  isConnected: boolean;
}

export function AppHeader({
  activeTab,
  onSelectTab,
  status,
  loadingStatus,
  daemonAddress,
  isConnected,
}: AppHeaderProps) {
  let statusColor = "bg-[#71717a]";
  let statusPingColor = "bg-[#71717a]";
  let statusTextColor = "text-[#a1a1aa]";
  let statusLabel = "Connecting...";

  if (isConnected) {
    statusColor = "bg-emerald-500";
    statusPingColor = "bg-emerald-400";
    statusTextColor = "text-emerald-400";
    statusLabel = "Connected";
  } else if (!loadingStatus && !status) {
    statusColor = "bg-rose-500";
    statusPingColor = "bg-rose-400";
    statusTextColor = "text-rose-400";
    statusLabel = "Disconnected";
  }

  return (
    <header className="fixed top-0 left-0 right-0 z-50 w-full bg-[#16161a] border-b border-[#232329] shadow-lg shadow-black/40">
      <div className="max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8">
        <div className="h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <img
              src="/favicon.png"
              alt="Bansos Router"
              className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg border border-[#2e2e38] shadow-xs shrink-0"
            />
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

        {/* Navigation Tabs */}
        <nav className="flex space-x-1 sm:space-x-2 -mb-px pt-1 overflow-x-auto no-scrollbar scroll-smooth w-full min-w-0">
          <button
            type="button"
            onClick={() => onSelectTab("models")}
            className={`shrink-0 flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-2 sm:py-2.5 border-b-2 text-xs sm:text-[13px] font-medium transition whitespace-nowrap cursor-pointer min-h-10.5 ${
              activeTab === "models"
                ? "border-[#2b64e0] text-white"
                : "border-transparent text-[#9393a0] hover:text-[#e4e4e7] hover:border-[#32323d]"
            }`}
          >
            <Cpu className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
            <span>Models</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectTab("agent")}
            className={`shrink-0 flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-2 sm:py-2.5 border-b-2 text-xs sm:text-[13px] font-medium transition whitespace-nowrap cursor-pointer min-h-10.5 ${
              activeTab === "agent"
                ? "border-[#2b64e0] text-white"
                : "border-transparent text-[#9393a0] hover:text-[#e4e4e7] hover:border-[#32323d]"
            }`}
          >
            <Wrench className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
            <span>Agent Setup</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectTab("relay")}
            className={`shrink-0 flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-2 sm:py-2.5 border-b-2 text-xs sm:text-[13px] font-medium transition whitespace-nowrap cursor-pointer min-h-10.5 ${
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
            onClick={() => onSelectTab("playground")}
            className={`shrink-0 flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-2 sm:py-2.5 border-b-2 text-xs sm:text-[13px] font-medium transition whitespace-nowrap cursor-pointer min-h-10.5 ${
              activeTab === "playground"
                ? "border-[#2b64e0] text-white"
                : "border-transparent text-[#9393a0] hover:text-[#e4e4e7] hover:border-[#32323d]"
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
            <span>Playground</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectTab("activity")}
            className={`shrink-0 flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-2 sm:py-2.5 border-b-2 text-xs sm:text-[13px] font-medium transition whitespace-nowrap cursor-pointer min-h-10.5 ${
              activeTab === "activity"
                ? "border-[#2b64e0] text-white"
                : "border-transparent text-[#9393a0] hover:text-[#e4e4e7] hover:border-[#32323d]"
            }`}
          >
            <Activity className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
            <span>Activity</span>
          </button>
        </nav>
      </div>
    </header>
  );
}
