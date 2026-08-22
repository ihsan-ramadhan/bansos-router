import { useState, useEffect } from "preact/hooks";
import { fetchStatus } from "./services/api";
import type { DaemonStatus } from "./types/ui";
import {
  Cpu,
  Wrench,
  Shield,
  MessageSquare,
  RefreshCw,
  Zap,
  Server,
  Clock,
  ShieldCheck,
  ShieldAlert,
  ExternalLink,
} from "lucide-preact";

export function App() {
  const [activeTab, setActiveTab] = useState<"catalog" | "harness" | "relay" | "playground">("catalog");
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  async function loadStatus() {
    try {
      const data = await fetchStatus();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect to daemon");
    } finally {
      setLoading(false);
    }
  }

  const uptimeText = status?.uptimeSeconds
    ? status.uptimeSeconds >= 3600
      ? `${Math.floor(status.uptimeSeconds / 3600)}h ${Math.floor((status.uptimeSeconds % 3600) / 60)}m`
      : `${Math.floor(status.uptimeSeconds / 60)}m ${status.uptimeSeconds % 60}s`
    : "0s";

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

              {/* Refresh Button */}
              <button
                onClick={loadStatus}
                title="Refresh status"
                className="p-2 rounded-lg bg-[#1a1a20] hover:bg-[#23232a] active:bg-[#151518] border border-[#282832] text-[#9393a0] hover:text-white transition cursor-pointer"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {/* Sub-header Top Tabs (Tailscale style) */}
          <nav className="flex space-x-1 sm:space-x-2 -mb-px pt-1 overflow-x-auto">
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
        {/* Metric Cards Shell */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Status */}
          <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-4 transition-all duration-200 hover:border-[#2e2e38] shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-[#8b8b96] uppercase tracking-wider">
                Daemon Status
              </span>
              <div className="p-1.5 rounded-lg bg-[#202026] text-[#a1a1aa]">
                <Server className="h-4 w-4" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  status ? "bg-emerald-500 shadow-sm shadow-emerald-500/50" : "bg-rose-500"
                }`}
              />
              <span className="text-lg font-bold text-white tracking-tight">
                {loading && !status ? "Connecting..." : status ? "Online" : "Disconnected"}
              </span>
            </div>
            <div className="text-xs text-[#71717a] mt-1 font-mono">
              Port {status?.port ?? 17070} • 127.0.0.1
            </div>
          </div>

          {/* Card 2: Active Models */}
          <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-4 transition-all duration-200 hover:border-[#2e2e38] shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-[#8b8b96] uppercase tracking-wider">
                Active Models
              </span>
              <div className="p-1.5 rounded-lg bg-[#202026] text-[#3b82f6]">
                <Cpu className="h-4 w-4" />
              </div>
            </div>
            <div className="text-lg font-bold text-white tracking-tight">
              {status?.modelCount ?? 0} <span className="text-sm font-normal text-[#a1a1aa]">Models</span>
            </div>
            <div className="text-xs text-[#71717a] mt-1">
              OpenCode Zen, Kilo, LLM7
            </div>
          </div>

          {/* Card 3: Uptime */}
          <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-4 transition-all duration-200 hover:border-[#2e2e38] shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-[#8b8b96] uppercase tracking-wider">
                Daemon Uptime
              </span>
              <div className="p-1.5 rounded-lg bg-[#202026] text-[#a1a1aa]">
                <Clock className="h-4 w-4" />
              </div>
            </div>
            <div className="text-lg font-bold text-white tracking-tight font-mono">
              {uptimeText}
            </div>
            <div className="text-xs text-emerald-400 mt-1 flex items-center gap-1 font-medium">
              <span>●</span> Auto-failover active
            </div>
          </div>

          {/* Card 4: Egress */}
          <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-4 transition-all duration-200 hover:border-[#2e2e38] shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-[#8b8b96] uppercase tracking-wider">
                Egress Mode
              </span>
              <div className="p-1.5 rounded-lg bg-[#202026] text-[#a1a1aa]">
                {status?.relay?.enabled ? (
                  <ShieldAlert className="h-4 w-4 text-amber-400" />
                ) : (
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  status?.relay?.enabled ? "bg-amber-400" : "bg-emerald-400"
                }`}
              />
              <span className="text-lg font-bold text-white tracking-tight">
                {status?.relay?.enabled ? "Relay Active" : "Direct Egress"}
              </span>
            </div>
            <div className="text-xs text-[#71717a] mt-1 truncate">
              {status?.relay?.enabled && status?.relay?.url ? status.relay.url : "Direct IP connection"}
            </div>
          </div>
        </div>

        {/* Step 1 Clean Foundation View */}
        <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-6 sm:p-8 shadow-sm">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-[#23232a]">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white tracking-tight">
                  {activeTab === "catalog" && "Models & Health Catalog"}
                  {activeTab === "harness" && "Harness Integrations"}
                  {activeTab === "relay" && "Relay Egress Manager"}
                  {activeTab === "playground" && "Live Test Playground"}
                </h2>
                <span className="px-2 py-0.5 text-[11px] rounded-md bg-[#202028] text-[#a1a1aa] border border-[#2c2c36] font-mono">
                  Step 1 Ready
                </span>
              </div>
              <p className="text-xs text-[#9393a0] mt-1">
                {activeTab === "catalog" &&
                  "Live overview of free, keyless models routed with automatic failover."}
                {activeTab === "harness" &&
                  "1-click config generator for OpenCode, Cline, Roo Code, Aider, Codex, and Cursor."}
                {activeTab === "relay" &&
                  "Bypass IP rate-limits by routing outbound queries through private relays."}
                {activeTab === "playground" &&
                  "Direct SSE streaming completions test against any active upstream model."}
              </p>
            </div>

            <button
              onClick={loadStatus}
              className="px-3 py-1.5 rounded-lg bg-[#202028] hover:bg-[#282834] active:bg-[#1a1a20] border border-[#2c2c36] text-xs font-medium text-white transition flex items-center gap-2 cursor-pointer shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-[#3b82f6]" : "text-[#a1a1aa]"}`} />
              <span>Refresh Status</span>
            </button>
          </div>

          {/* Quick Info & Architecture Summary Box */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-[#121215] border border-[#23232a]">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#71717a] mb-1">
                Local Wire API
              </div>
              <div className="text-xs font-mono text-emerald-400">
                http://127.0.0.1:{status?.port ?? 17070}/v1
              </div>
              <div className="text-[11px] text-[#71717a] mt-1">
                OpenAI, Anthropic & SSE wire compatible
              </div>
            </div>

            <div className="p-4 rounded-lg bg-[#121215] border border-[#23232a]">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#71717a] mb-1">
                Zero Configuration
              </div>
              <div className="text-xs text-white font-medium">
                No API Keys Needed
              </div>
              <div className="text-[11px] text-[#71717a] mt-1">
                Routed across 3 keyless upstreams
              </div>
            </div>

            <div className="p-4 rounded-lg bg-[#121215] border border-[#23232a]">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#71717a] mb-1">
                Failover Protection
              </div>
              <div className="text-xs text-white font-medium flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span>Smart Auto-Retry</span>
              </div>
              <div className="text-[11px] text-[#71717a] mt-1">
                Seamless fallback on 429 rate limit
              </div>
            </div>
          </div>
        </div>
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
