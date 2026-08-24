import { useState } from "preact/hooks";
import { Check, Copy, Terminal, Lock, Globe, Plus, X, Zap } from "lucide-preact";
import type { RelayStateResponse, ProbeStatus } from "../../types";
import { RelayCardItem, RelayRowItem } from "./RelayItemView";

interface RelayTableSectionProps {
  relayState: RelayStateResponse | null;
  isEnabled: boolean;
  updating: boolean;
  probeMap: Record<string, ProbeStatus>;
  onProbe: (url: string) => void;
  onSetActive: (url: string) => void;
  onRemove: (url: string) => void;
  onAddRelay: (url: string, label: string) => void;
}

export function RelayTableSection({
  relayState,
  isEnabled,
  updating,
  probeMap,
  onProbe,
  onSetActive,
  onRemove,
  onAddRelay,
}: RelayTableSectionProps) {
  const [showAddForm, setShowAddForm] = useState<boolean>(false);
  const [newUrl, setNewUrl] = useState<string>("");
  const [newLabel, setNewLabel] = useState<string>("");

  function handleSubmit(e?: Event) {
    e?.preventDefault();
    if (!newUrl.trim()) return;
    onAddRelay(newUrl, newLabel);
    setNewUrl("");
    setNewLabel("");
    setShowAddForm(false);
  }

  const hasRelays = Boolean(relayState?.relays?.length);

  return (
    <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-4 sm:p-5 shadow-xs space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#23232a] pb-3">
        <div>
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">
            Configured Relay Proxies
          </h3>
          <p className="text-[11px] text-[#71717a]">
            Manage proxy endpoints and fallback priorities.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowAddForm((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer self-start sm:self-auto shadow-xs ${
            showAddForm
              ? "bg-[#202028] hover:bg-[#282834] text-[#d4d4d8] hover:text-white border border-[#2c2c36]"
              : "bg-[#2b64e0] hover:bg-[#2557c7] text-white"
          }`}
        >
          {showAddForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          <span>{showAddForm ? "Cancel" : "Add Proxy"}</span>
        </button>
      </div>

      {/* Add relay form */}
      {showAddForm && (
        <form
          onSubmit={handleSubmit}
          className="p-3 sm:p-4 rounded-xl bg-[#121215] border border-[#2b64e0]/40 space-y-3 animate-in fade-in duration-200"
        >
          <div className="flex items-center gap-2 text-xs font-bold text-white">
            <Zap className="h-3.5 w-3.5 text-[#3b82f6] shrink-0" />
            <span>Connect New Relay Proxy</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
            <div className="sm:col-span-2 space-y-1">
              <span className="block text-[10px] uppercase font-mono tracking-wider text-[#8b8b96]">
                Relay Proxy URL *
              </span>
              <input
                type="text"
                placeholder="https://relay-bansos.workers.dev"
                value={newUrl}
                onInput={(e) => setNewUrl((e.target as HTMLInputElement).value)}
                required
                autoFocus
                className="w-full px-3 py-2 text-xs rounded-lg bg-[#18181c] border border-[#282832] text-white placeholder-[#52525b] focus:outline-none focus:border-[#2b64e0] font-mono"
              />
            </div>
            <div className="space-y-1">
              <span className="block text-[10px] uppercase font-mono tracking-wider text-[#8b8b96]">
                Label / Region (Optional)
              </span>
              <input
                type="text"
                placeholder="e.g. Cloudflare SG / Personal Worker"
                value={newLabel}
                onInput={(e) => setNewLabel((e.target as HTMLInputElement).value)}
                className="w-full px-3 py-2 text-xs rounded-lg bg-[#18181c] border border-[#282832] text-white placeholder-[#52525b] focus:outline-none focus:border-[#2b64e0]"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-3 py-1.5 rounded-lg bg-[#18181c] hover:bg-[#202026] text-xs font-medium text-[#9393a0] hover:text-white transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={updating || !newUrl.trim()}
              className="px-4 py-1.5 rounded-lg bg-[#2b64e0] hover:bg-[#2557c7] text-xs font-semibold text-white transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
            >
              Save & Connect
            </button>
          </div>
        </form>
      )}

      {/* Relay list: Mobile cards (< md) vs Desktop table (>= md) */}
      {hasRelays && relayState ? (
        <div>
          {/* Mobile View: Cards */}
          <div className="block md:hidden space-y-3">
            {relayState.relays.map((relay, idx) => (
              <RelayCardItem
                key={`card-${relay.url}-${idx}`}
                relay={relay}
                isActive={relayState.url === relay.url}
                isEnabled={isEnabled}
                updating={updating}
                probeInfo={probeMap[relay.url]}
                onProbe={onProbe}
                onSetActive={onSetActive}
                onRemove={onRemove}
              />
            ))}
          </div>

          {/* Desktop View: Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#23232a] text-[#71717a] text-[10px] sm:text-[11px] uppercase font-mono tracking-wider">
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Relay Endpoint</th>
                  <th className="py-2.5 px-3">Health / Latency</th>
                  <th className="py-2.5 px-3">Label</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1f1f26]">
                {relayState.relays.map((relay, idx) => (
                  <RelayRowItem
                    key={`${relay.url}-${idx}`}
                    relay={relay}
                    isActive={relayState.url === relay.url}
                    isEnabled={isEnabled}
                    updating={updating}
                    probeInfo={probeMap[relay.url]}
                    onProbe={onProbe}
                    onSetActive={onSetActive}
                    onRemove={onRemove}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Empty state */
        <div className="p-6 sm:p-8 rounded-xl bg-[#121215] border border-dashed border-[#282832] text-center space-y-3">
          <div className="mx-auto h-10 w-10 rounded-xl bg-[#1a1a20] border border-[#282832] flex items-center justify-center text-blue-400">
            <Globe className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <div className="text-xs font-semibold text-white">No relay nodes configured</div>
            <p className="text-[11px] text-[#71717a] max-w-md mx-auto">
              Currently running in <span className="text-white font-medium">Direct IP connection</span>. Add a Cloudflare Worker or Vercel Edge node to proxy upstream requests.
            </p>
          </div>

          {!showAddForm && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowAddForm(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#2b64e0] hover:bg-[#2557c7] text-xs font-semibold text-white transition cursor-pointer shadow-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Relay Node</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function RelayFooterInfo() {
  const [copiedCli, setCopiedCli] = useState<string | null>(null);

  async function handleCopy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCli(id);
      setTimeout(() => setCopiedCli((curr) => (curr === id ? null : curr)), 2000);
    } catch {
      // Clipboard write failed
    }
  }

  return (
    <>
      {/* Allowed target origins */}
      <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-4 sm:p-5 shadow-xs space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-white uppercase tracking-wider">
          <Lock className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          <span>Security & Allowed Upstreams</span>
        </div>
        <p className="text-xs text-[#9393a0] leading-relaxed">
          To ensure relay workers cannot be used as open proxies, forwarded requests via <code className="text-white font-mono bg-[#111113] px-1.5 py-0.5 rounded border border-[#23232a]">x-relay-target</code> are strictly restricted to verified keyless AI providers:
        </p>

        <div className="flex flex-wrap gap-2 pt-1">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#121215] border border-[#282832] text-xs font-mono text-[#d4d4d8]">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
            <span>https://opencode.ai</span>
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#121215] border border-[#282832] text-xs font-mono text-[#d4d4d8]">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
            <span>https://api.kilo.ai</span>
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#121215] border border-[#282832] text-xs font-mono text-[#d4d4d8]">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
            <span>https://llm7.io</span>
          </span>
        </div>
      </div>

      {/* CLI quick commands */}
      <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-4 sm:p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between border-b border-[#23232a] pb-3">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-[#8b8b96] shrink-0" />
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">
              CLI Quick Commands
            </h3>
          </div>
          <span className="text-[10px] sm:text-[11px] font-mono text-[#71717a]">
            Terminal Equivalence
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3 text-xs">
          <div className="p-3 rounded-lg bg-[#121215] border border-[#23232a] flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] text-[#71717a] font-mono uppercase">Toggle Relay</div>
              <code className="text-white font-mono truncate block">bansos relay on | off</code>
            </div>
            <button
              type="button"
              onClick={() => handleCopy("bansos relay on", "cli-toggle")}
              className="p-1.5 rounded-md hover:bg-[#202026] text-[#71717a] hover:text-white transition cursor-pointer shrink-0"
              title="Copy command"
              aria-label="Copy toggle relay command"
            >
              {copiedCli === "cli-toggle" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>

          <div className="p-3 rounded-lg bg-[#121215] border border-[#23232a] flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] text-[#71717a] font-mono uppercase">Switch Active</div>
              <code className="text-white font-mono truncate block">bansos relay use &lt;URL&gt;</code>
            </div>
            <button
              type="button"
              onClick={() => handleCopy("bansos relay use <URL>", "cli-use")}
              className="p-1.5 rounded-md hover:bg-[#202026] text-[#71717a] hover:text-white transition cursor-pointer shrink-0"
              title="Copy command"
              aria-label="Copy switch active relay command"
            >
              {copiedCli === "cli-use" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>

          <div className="p-3 rounded-lg bg-[#121215] border border-[#23232a] flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] text-[#71717a] font-mono uppercase">Save New Relay</div>
              <code className="text-white font-mono truncate block">bansos relay url &lt;URL&gt;</code>
            </div>
            <button
              type="button"
              onClick={() => handleCopy("bansos relay url <URL>", "cli-url")}
              className="p-1.5 rounded-md hover:bg-[#202026] text-[#71717a] hover:text-white transition cursor-pointer shrink-0"
              title="Copy command"
              aria-label="Copy save new relay command"
            >
              {copiedCli === "cli-url" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>

          <div className="p-3 rounded-lg bg-[#121215] border border-[#23232a] flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] text-[#71717a] font-mono uppercase">List Relays</div>
              <code className="text-white font-mono truncate block">bansos relay list</code>
            </div>
            <button
              type="button"
              onClick={() => handleCopy("bansos relay list", "cli-list")}
              className="p-1.5 rounded-md hover:bg-[#202026] text-[#71717a] hover:text-white transition cursor-pointer shrink-0"
              title="Copy command"
              aria-label="Copy list relays command"
            >
              {copiedCli === "cli-list" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
