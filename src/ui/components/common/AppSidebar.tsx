import {
  Cpu,
  Wrench,
  Shield,
  MessageSquare,
  Activity,
  ScrollText,
  Settings,
  ExternalLink,
  type LucideIcon,
} from "lucide-preact";
import type { NavTab } from "./AppHeader";

export interface AppSidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  isOpen: boolean;
}

interface NavItem {
  id: NavTab;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: readonly NavItem[] = [
  { id: "models", label: "Models", icon: Cpu },
  { id: "agent", label: "Agent Setup", icon: Wrench },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "relay", label: "Relay Proxy", icon: Shield },
  { id: "playground", label: "Playground", icon: MessageSquare },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "settings", label: "Settings", icon: Settings },
];

export function AppSidebar({ activeTab, onSelectTab, isOpen }: AppSidebarProps) {
  return (
    <aside
      id="app-sidebar"
      aria-label="Desktop Navigation"
      className={`
        hidden md:flex flex-col justify-between sticky top-14 left-0 z-30
        shrink-0 bg-[#0e1017] border-r border-[#1c1f2b]
        h-[calc(100vh-3.5rem)]
        transition-[width] duration-200 ease-in-out
        ${isOpen ? "w-56" : "w-16"}
      `}
    >
      <div className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden no-scrollbar">
        {/* Navigation Items */}
        <nav className="p-2 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                aria-current={isActive ? "page" : undefined}
                aria-label={item.label}
                title={!isOpen ? item.label : undefined}
                className={`
                  w-full flex items-center h-10 px-2 rounded-lg text-[13px] font-medium
                  transition-colors cursor-pointer text-left
                  ${
                    isActive
                      ? "bg-[#161822] text-white border border-[#222736] shadow-xs"
                      : "text-[#94a3b8] hover:text-white hover:bg-[#13151e] border border-transparent"
                  }
                `}
              >
                <div className="w-8 h-8 flex items-center justify-center shrink-0">
                  <Icon className={`h-4 w-4 shrink-0 transition-colors ${isActive ? "text-[#3b82f6]" : "text-[#71717a]"}`} />
                </div>
                <span
                  className={`truncate whitespace-nowrap overflow-hidden transition-all duration-200 ease-in-out ${
                    isOpen ? "max-w-36 opacity-100 ml-2" : "max-w-0 opacity-0 ml-0 pointer-events-none"
                  }`}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Sidebar Footer */}
      <div className="p-2 border-t border-[#1c1f2b] bg-[#0b0c12] text-xs text-[#71717a]">
        <a
          href="https://github.com/ihsan-ramadhan/bansos-router"
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub Repository"
          title={!isOpen ? "GitHub Repository" : undefined}
          className="w-full flex items-center h-10 px-2 rounded-lg text-[#94a3b8] hover:text-white hover:bg-[#14161f] transition-colors cursor-pointer"
        >
          <div className="w-8 h-8 flex items-center justify-center shrink-0">
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          </div>
          <span
            className={`text-[11px] font-medium truncate whitespace-nowrap overflow-hidden transition-all duration-200 ease-in-out ${
              isOpen ? "max-w-36 opacity-100 ml-2" : "max-w-0 opacity-0 ml-0 pointer-events-none"
            }`}
          >
            GitHub
          </span>
        </a>
      </div>
    </aside>
  );
}
