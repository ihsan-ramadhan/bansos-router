import { useEffect, useRef, useState } from "preact/hooks";
import {
  Cpu,
  MessageSquare,
  Activity,
  Wrench,
  Shield,
  ScrollText,
  Settings,
  MoreHorizontal,
  X,
  ChevronRight,
  type LucideIcon,
} from "lucide-preact";
import type { NavTab } from "./AppHeader";

export interface MobileBottomNavProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
}

interface BottomNavItem {
  id: NavTab;
  label: string;
  icon: LucideIcon;
}

interface MoreSheetItem {
  id: NavTab;
  label: string;
  desc: string;
  icon: LucideIcon;
}

// Exactly 3 primary items + More... in the bottom bar
const PRIMARY_ITEMS: readonly BottomNavItem[] = [
  { id: "models", label: "Models", icon: Cpu },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "playground", label: "Playground", icon: MessageSquare },
];

// Items inside the More bottom sheet
const MORE_ITEMS: readonly MoreSheetItem[] = [
  { id: "agent", label: "Agent Setup", desc: "Harness configuration & CLI setup", icon: Wrench },
  { id: "relay", label: "Relay Proxy", desc: "Outbound proxy nodes & routing", icon: Shield },
  { id: "logs", label: "Daemon Logs", desc: "Live output from bansosd.log", icon: ScrollText },
  { id: "settings", label: "Settings", desc: "Security policy, failover & daemon port", icon: Settings },
];

export function MobileBottomNav({ activeTab, onSelectTab }: MobileBottomNavProps) {
  const [visible, setVisible] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const lastScrollY = useRef(0);

  // Close sheet on Escape key
  useEffect(() => {
    if (!sheetOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSheetOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sheetOpen]);

  // Lock body scroll when sheet is open
  useEffect(() => {
    if (sheetOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [sheetOpen]);

  // Scroll detection to auto-hide / auto-show the floating nav
  useEffect(() => {
    lastScrollY.current = window.scrollY;

    let ticking = false;
    const handleScroll = () => {
      if (ticking) return;
      ticking = true;

      window.requestAnimationFrame(() => {
        const currentY = window.scrollY;
        const diff = currentY - lastScrollY.current;

        // When the bottom sheet is open, keep nav visible
        if (sheetOpen) {
          setVisible(true);
        } else if (currentY < 30) {
          // Always visible near the top of the page
          setVisible(true);
        } else if (diff > 8) {
          // Scrolling down: hide
          setVisible(false);
        } else if (diff < -4) {
          // Scrolling up even slightly: reveal
          setVisible(true);
        }

        lastScrollY.current = currentY;
        ticking = false;
      });
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [sheetOpen]);

  const isMoreActive = MORE_ITEMS.some((item) => item.id === activeTab);

  const handleSelectMoreItem = (id: NavTab) => {
    onSelectTab(id);
    setSheetOpen(false);
  };

  return (
    <>
      {/* Floating Bottom Nav (4 items: Models, Playground, Activity, More...) */}
      <nav
        id="mobile-bottom-nav"
        aria-label="Mobile Navigation"
        className={`
          fixed bottom-3 inset-x-3 z-40 md:hidden
          max-w-sm mx-auto
          transition-all duration-300 ease-in-out
          ${
            visible
              ? "translate-y-0 opacity-100 pointer-events-auto"
              : "translate-y-24 opacity-0 pointer-events-none"
          }
        `}
      >
        <div className="rounded-2xl bg-[#0c0e14]/95 border border-[#1e2330] shadow-2xl backdrop-blur-md p-1.5">
          <div className="grid grid-cols-4 gap-1">
            {PRIMARY_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelectTab(item.id);
                    setSheetOpen(false);
                  }}
                  aria-current={isActive ? "page" : undefined}
                  className={`
                    min-h-11 py-1.5 px-1 rounded-xl flex flex-col items-center justify-center gap-1
                    transition cursor-pointer text-[11px] font-medium
                    ${
                      isActive
                        ? "bg-[#2563eb]/20 text-[#60a5fa] border border-[#2563eb]/35 shadow-xs"
                        : "text-[#a1a1aa] hover:text-white hover:bg-[#151822] border border-transparent"
                    }
                  `}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${isActive ? "text-[#60a5fa]" : "text-[#8b8b96]"}`} />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}

            {/* 4th button: More... */}
            <button
              type="button"
              onClick={() => setSheetOpen((prev) => !prev)}
              aria-label="More options"
              aria-expanded={sheetOpen}
              className={`
                min-h-11 py-1.5 px-1 rounded-xl flex flex-col items-center justify-center gap-1
                transition cursor-pointer text-[11px] font-medium
                ${
                  sheetOpen || isMoreActive
                    ? "bg-[#2563eb]/20 text-[#60a5fa] border border-[#2563eb]/35 shadow-xs"
                    : "text-[#a1a1aa] hover:text-white hover:bg-[#151822] border border-transparent"
                }
              `}
            >
              <MoreHorizontal className={`h-4 w-4 shrink-0 ${sheetOpen || isMoreActive ? "text-[#60a5fa]" : "text-[#8b8b96]"}`} />
              <span className="truncate">More...</span>
            </button>
          </div>
        </div>
      </nav>

      {/* Action Sheet / Bottom Sheet for "More..." */}
      {sheetOpen && (
        <>
          {/* Backdrop */}
          <div
            role="presentation"
            onClick={() => setSheetOpen(false)}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs md:hidden animate-in fade-in duration-150"
            aria-hidden="true"
          />

          {/* Sliding Bottom Sheet */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="More navigation options"
            className="fixed bottom-0 inset-x-0 z-50 md:hidden rounded-t-2xl bg-[#10121a] border-t border-x border-[#1c1f2b] p-4 pb-8 space-y-3 shadow-2xl animate-in slide-in-from-bottom duration-200 max-w-md mx-auto"
          >
            {/* Handle bar */}
            <div className="w-10 h-1 bg-[#2e3447] rounded-full mx-auto" aria-hidden="true" />

            {/* Sheet Header */}
            <div className="flex items-center justify-between pb-2 border-b border-[#1c1f2b]">
              <div>
                <span className="text-sm font-semibold text-white tracking-tight">More Options</span>
                <span className="text-[11px] text-[#8b8b96] block">Harness configuration & tools</span>
              </div>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label="Close options"
                className="p-1.5 rounded-lg text-[#a1a1aa] hover:text-white hover:bg-[#1a1e2b] min-h-10 min-w-10 flex items-center justify-center cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Sheet Items */}
            <div className="space-y-1.5 pt-1">
              {MORE_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectMoreItem(item.id)}
                    aria-current={isActive ? "page" : undefined}
                    className={`
                      w-full flex items-center justify-between p-3 rounded-xl border text-left
                      transition cursor-pointer min-h-12
                      ${
                        isActive
                          ? "bg-[#161a26] border-[#2563eb]/40 text-white shadow-xs"
                          : "bg-[#0c0e14] border-[#1c1f2b] text-[#cbd5e1] hover:bg-[#131620]"
                      }
                    `}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`p-2 rounded-lg border shrink-0 ${isActive ? "bg-[#2563eb]/20 border-[#2563eb]/30 text-[#60a5fa]" : "bg-[#131620] border-[#1e2330] text-[#94a3b8]"}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-xs sm:text-[13px] font-semibold block text-white truncate">
                          {item.label}
                        </span>
                        <span className="text-[11px] text-[#8b8b96] block truncate">
                          {item.desc}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className={`h-4 w-4 shrink-0 ml-2 ${isActive ? "text-[#60a5fa]" : "text-[#52525c]"}`} />
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
