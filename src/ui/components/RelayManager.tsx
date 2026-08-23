import { useState, useEffect, useCallback } from "preact/hooks";
import type { RelayStateResponse } from "../types/ui";
import { fetchRelayState, updateRelayState, probeRelay } from "../services/api";
import {
  Shield,
  ShieldAlert,
  Globe,
  Plus,
  Trash2,
  Check,
  Copy,
  Terminal,
  Loader2,
  Info,
  Lock,
  Zap,
} from "lucide-preact";

type NotificationType = "success" | "info" | "error";

interface ProbeStatus {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  probing?: boolean;
}

interface RelayRowItemProps {
  relay: { url: string; label?: string };
  isActive: boolean;
  isEnabled: boolean;
  updating: boolean;
  probeInfo?: ProbeStatus;
  onProbe: (url: string) => void;
  onSetActive: (url: string) => void;
  onRemove: (url: string) => void;
}

function RelayProbeBadge({ probeInfo }: { probeInfo?: ProbeStatus }) {
  if (probeInfo?.probing) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-blue-400 font-mono">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Probing...</span>
      </span>
    );
  }
  if (!probeInfo) {
    return <span className="text-[#52525b] text-[11px] font-mono">—</span>;
  }
  if (probeInfo.ok) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono border bg-emerald-950/60 text-emerald-400 border-emerald-800/40">
        <Check className="h-2.5 w-2.5" />
        <span>{probeInfo.latencyMs}ms</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono border bg-rose-950/60 text-rose-400 border-rose-800/40">
      <ShieldAlert className="h-2.5 w-2.5" />
      <span>Unreachable</span>
    </span>
  );
}

function renderRelayStatusBadge(isActive: boolean, isEnabled: boolean) {
  if (!isActive) {
    return <span className="text-[11px] text-[#52525b] font-mono">Saved</span>;
  }
  const textColor = isEnabled ? "text-emerald-400" : "text-amber-400";
  const dotColor = isEnabled ? "bg-emerald-400" : "bg-amber-400";
  const label = isEnabled ? "Active & Routing" : "Selected (Standby)";
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${textColor}`}>
      <span className={`h-2 w-2 rounded-full ${dotColor}`} />
      <span>{label}</span>
    </span>
  );
}

interface ProbeHooks {
  setProbeMap: (updater: (prev: Record<string, ProbeStatus>) => Record<string, ProbeStatus>) => void;
  setLatencyResult: (v: { ms?: number; ok?: boolean; error?: string } | null) => void;
  showToast: (type: "success" | "info" | "error", message: string) => void;
  setUpdating: (v: boolean) => void;
}

async function probeRelayReachable(
  url: string,
  hooks: ProbeHooks
): Promise<{ ok: boolean; latencyMs?: number } | null> {
  hooks.setUpdating(true);
  hooks.setProbeMap((prev) => ({ ...prev, [url]: { ok: false, probing: true } }));
  try {
    const probeRes = await probeRelay(url);
    hooks.setProbeMap((prev) => ({
      ...prev,
      [url]: { ok: probeRes.ok, latencyMs: probeRes.latencyMs, error: probeRes.error, probing: false },
    }));
    hooks.setLatencyResult({ ms: probeRes.latencyMs, ok: probeRes.ok, error: probeRes.error });
    if (!probeRes.ok) {
      hooks.showToast("error", `Relay unreachable (${probeRes.error || "connection failed"}). Direct Egress preserved.`);
      return null;
    }
    return { ok: true, latencyMs: probeRes.latencyMs };
  } catch (err) {
    hooks.setProbeMap((prev) => ({
      ...prev,
      [url]: { ok: false, error: err instanceof Error ? err.message : "Probe failed", probing: false },
    }));
    hooks.showToast("error", "Failed to reach relay endpoint. Direct Egress preserved.");
    return null;
  } finally {
    hooks.setUpdating(false);
  }
}

function RelayRowItem({
  relay,
  isActive,
  isEnabled,
  updating,
  probeInfo,
  onProbe,
  onSetActive,
  onRemove,
}: RelayRowItemProps) {
  const statusBadge = renderRelayStatusBadge(isActive, isEnabled);

  return (
    <tr className={`hover:bg-[#19191f] transition-colors ${isActive ? "bg-[#141419]" : ""}`}>
      {/* Status */}
      <td className="py-3 px-3 whitespace-nowrap">{statusBadge}</td>

      {/* URL */}
      <td className="py-3 px-3 font-mono text-white break-all">{relay.url}</td>

      {/* Health / Latency badge */}
      <td className="py-3 px-3 whitespace-nowrap">
        <RelayProbeBadge probeInfo={probeInfo} />
      </td>

      {/* Label */}
      <td className="py-3 px-3 text-[#9393a0] whitespace-nowrap">
        {relay.label ? (
          <span className="px-2 py-0.5 rounded-md bg-[#202028] text-xs text-[#d4d4d8] border border-[#282832]">
            {relay.label}
          </span>
        ) : (
          <span className="text-[#52525b] italic">—</span>
        )}
      </td>

      {/* Actions */}
      <td className="py-3 px-3 text-right whitespace-nowrap">
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => onProbe(relay.url)}
            disabled={updating || probeInfo?.probing}
            className="p-1.5 rounded-md text-[#71717a] hover:text-amber-400 hover:bg-amber-950/40 transition cursor-pointer disabled:opacity-40"
            title="Ping relay"
          >
            {probeInfo?.probing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#3b82f6]" />
            ) : (
              <Zap className="h-3.5 w-3.5" />
            )}
          </button>

          {!isActive ? (
            <button
              type="button"
              onClick={() => onSetActive(relay.url)}
              disabled={updating}
              className="p-1.5 rounded-md text-[#71717a] hover:text-emerald-400 hover:bg-emerald-950/40 transition cursor-pointer disabled:opacity-40"
              title="Use relay"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          ) : (
            <span
              className={`p-1.5 flex items-center justify-center ${
                isEnabled ? "text-emerald-400" : "text-amber-400"
              }`}
              title={isEnabled ? "Active" : "Selected"}
            >
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  isEnabled ? "bg-emerald-400 ring-2 ring-emerald-400/30 animate-pulse" : "bg-amber-400 ring-2 ring-amber-400/30"
                }`}
              />
            </span>
          )}

          <button
            type="button"
            onClick={() => onRemove(relay.url)}
            disabled={updating}
            className="p-1.5 rounded-md text-[#71717a] hover:text-rose-400 hover:bg-rose-950/40 transition cursor-pointer disabled:opacity-40"
            title="Delete relay"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function getNotificationClasses(type: NotificationType): string {
  if (type === "success") {
    return "bg-emerald-950/40 border-emerald-800/40 text-emerald-300";
  }
  if (type === "info") {
    return "bg-blue-950/40 border-blue-800/40 text-blue-300";
  }
  return "bg-rose-950/40 border-rose-800/40 text-rose-300";
}

interface RelayManagerProps {
  daemonPort: number;
  onStateChange?: () => void;
}

export function RelayManager({ daemonPort, onStateChange }: RelayManagerProps) {
  const [relayState, setRelayState] = useState<RelayStateResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [updating, setUpdating] = useState<boolean>(false);
  const [notification, setNotification] = useState<{ type: "success" | "info" | "error"; message: string } | null>(null);

  const [showAddForm, setShowAddForm] = useState<boolean>(false);
  const [newUrl, setNewUrl] = useState<string>("");
  const [newLabel, setNewLabel] = useState<string>("");

  const [copiedCli, setCopiedCli] = useState<string | null>(null);

  const [testingLatency, setTestingLatency] = useState<boolean>(false);
  const [latencyResult, setLatencyResult] = useState<{ ms?: number; ok?: boolean; error?: string } | null>(null);
  const [probeMap, setProbeMap] = useState<Record<string, { ok: boolean; latencyMs?: number; error?: string; probing?: boolean }>>({});

  const loadState = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchRelayState();
      setRelayState(data);
    } catch (err) {
      setNotification({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to load relay state",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const showToast = (type: "success" | "info" | "error", message: string) => {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification((curr) => (curr?.message === message ? null : curr));
    }, 3500);
  };

  const hasRelays = Boolean(relayState && relayState.relays.length > 0);
  const isEnabled = Boolean(relayState?.enabled && relayState.url);

  // Toggle relay egress on/off with reachability check
  async function handleToggleEnabled() {
    if (!relayState) return;

    if (!hasRelays && !relayState.enabled) {
      setShowAddForm(true);
      showToast("info", "Please configure at least one relay node before enabling egress.");
      return;
    }

    const nextEnabled = !relayState.enabled;
    let activeUrl = relayState.url;
    if (nextEnabled && !activeUrl && relayState.relays.length > 0) {
      activeUrl = relayState.relays[0]?.url ?? "";
    }

    // Verify relay reachability before enabling
    if (nextEnabled && activeUrl) {
      const reachable = await probeRelayReachable(activeUrl, {
        setProbeMap,
        setLatencyResult,
        showToast,
        setUpdating,
      });
      if (!reachable) return;
    }

    try {
      setUpdating(true);
      const updated = await updateRelayState({
        enabled: nextEnabled,
        url: activeUrl,
      });
      setRelayState(updated);
      showToast(
        "success",
        nextEnabled
          ? `Relay egress verified & activated via ${activeUrl}`
          : "Switched to Direct Egress (local IP)"
      );
      if (onStateChange) onStateChange();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to toggle relay state");
    } finally {
      setUpdating(false);
    }
  }

  // Set active relay
  async function handleSetActive(url: string) {
    try {
      setUpdating(true);
      const reachable = await probeRelayReachable(url, {
        setProbeMap,
        setLatencyResult,
        showToast,
        setUpdating,
      });
      if (!reachable) return;

      const updated = await updateRelayState({
        url,
        enabled: true,
      });
      setRelayState(updated);
      showToast("success", `Active relay set and verified: ${url}`);
      if (onStateChange) onStateChange();
    } catch (err) {
      setProbeMap((prev) => ({
        ...prev,
        [url]: { ok: false, error: err instanceof Error ? err.message : "Probe failed", probing: false },
      }));
      showToast("error", err instanceof Error ? err.message : "Failed to switch relay");
    } finally {
      setUpdating(false);
    }
  }

  // Add new relay node
  async function handleAddRelay(e: Event) {
    e.preventDefault();
    const cleanUrl = newUrl.trim();
    if (!cleanUrl) return;

    if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
      showToast("error", "URL must start with https:// or http://");
      return;
    }

    try {
      setUpdating(true);
      const shouldAutoActivate = !relayState?.url;

      let canAutoActivate = false;
      if (shouldAutoActivate) {
        const probeRes = await probeRelay(cleanUrl);
        setProbeMap((prev) => ({
          ...prev,
          [cleanUrl]: { ok: probeRes.ok, latencyMs: probeRes.latencyMs, error: probeRes.error, probing: false },
        }));
        if (probeRes.ok) {
          canAutoActivate = true;
        } else {
          showToast("info", `Relay saved, but probe failed (${probeRes.error || "unreachable"}). Direct Egress preserved.`);
        }
      }

      const updated = await updateRelayState({
        action: "add",
        url: cleanUrl,
        label: newLabel.trim() || undefined,
        ...(canAutoActivate ? { url: cleanUrl, enabled: true } : {}),
      });

      setRelayState(updated);
      setNewUrl("");
      setNewLabel("");
      setShowAddForm(false);
      
      if (canAutoActivate) {
        showToast("success", `Relay verified & active: ${cleanUrl}`);
      } else if (!shouldAutoActivate) {
        showToast("success", `Saved relay: ${cleanUrl}`);
      }
      if (onStateChange) onStateChange();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to add relay");
    } finally {
      setUpdating(false);
    }
  }

  // Delete relay node
  async function handleRemoveRelay(url: string) {
    try {
      setUpdating(true);
      const isDeletingActive = relayState?.url === url;
      const updated = await updateRelayState({
        action: "remove",
        url,
        ...(isDeletingActive ? { enabled: false } : {}),
      });
      setRelayState(updated);
      setProbeMap((prev) => {
        const next = { ...prev };
        delete next[url];
        return next;
      });
      if (isDeletingActive) {
        setLatencyResult(null);
      }
      showToast(
        "success",
        isDeletingActive
          ? `Removed active relay (${url}). Switched to Direct Egress.`
          : `Removed relay: ${url}`
      );
      if (onStateChange) onStateChange();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to delete relay");
    } finally {
      setUpdating(false);
    }
  }

  // Test active relay latency
  async function handleTestRelay() {
    if (!relayState?.url) return;
    setTestingLatency(true);
    setLatencyResult(null);

    try {
      const res = await probeRelay(relayState.url);
      setLatencyResult({
        ms: res.latencyMs,
        ok: res.ok,
        error: res.error,
      });
    } catch (err) {
      setLatencyResult({
        ok: false,
        error: err instanceof Error ? err.message : "Failed to probe relay",
      });
    } finally {
      setTestingLatency(false);
    }
  }

  async function handleCopy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCli(id);
      setTimeout(() => setCopiedCli((curr) => (curr === id ? null : curr)), 2000);
    } catch {
      // Ignore clipboard write failures
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-5 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-teal-500/10 text-teal-400 border border-teal-500/20">
                <Shield className="h-4 w-4" />
              </div>
              <h2 className="text-base font-bold text-white tracking-tight">
                Relay Egress Manager
              </h2>
              <span
                className={`text-[11px] px-2.5 py-0.5 rounded-full border font-mono ${
                  isEnabled
                    ? "bg-emerald-950/60 text-emerald-400 border-emerald-800/40"
                    : "bg-[#202028] text-[#9393a0] border-[#2c2c36]"
                }`}
              >
                {isEnabled ? "Relay Active" : "Direct Egress"}
              </span>
            </div>
            <p className="text-xs text-[#9393a0]">
              Bypass IP rate-limits by routing outbound upstream requests through Cloudflare / Vercel relay workers.
            </p>
          </div>

          {/* Toggle */}
          <div className="flex items-center gap-3 self-stretch sm:self-auto bg-[#121215] border border-[#23232a] p-2 rounded-xl">
            <div className="text-right">
              <div className="text-[10px] text-[#71717a] uppercase font-mono tracking-wider">
                Egress Mode
              </div>
              <div className="text-xs font-semibold text-white">
                {isEnabled ? (
                  <span className="text-emerald-400">Relay Enabled</span>
                ) : (
                  <span className="text-[#9393a0]">Direct Connection</span>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={handleToggleEnabled}
              disabled={updating || loading}
              aria-label="Toggle Relay Egress"
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                isEnabled ? "bg-emerald-500" : "bg-[#282832]"
              } ${updating || loading ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                  isEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>

        {/* Active relay summary */}
        {relayState?.url && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-[#23232a] text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[11px] font-mono text-[#71717a] uppercase tracking-wider shrink-0">
                Active Node:
              </span>
              <span className="font-mono text-white font-medium truncate">
                {relayState.url}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleTestRelay}
                disabled={testingLatency}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#202026] hover:bg-[#282832] border border-[#2e2e38] text-[11px] font-medium text-[#d4d4d8] hover:text-white transition cursor-pointer disabled:opacity-50"
                title="Ping active relay node to check latency and status"
              >
                {testingLatency ? (
                  <Loader2 className="h-3 w-3 animate-spin text-[#3b82f6]" />
                ) : (
                  <Zap className="h-3 w-3 text-amber-400" />
                )}
                <span>{testingLatency ? "Pinging..." : "Ping Relay"}</span>
              </button>

              {latencyResult && (
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full border font-mono ${
                    latencyResult.ok
                      ? "bg-emerald-950/60 text-emerald-400 border-emerald-800/40"
                      : "bg-rose-950/60 text-rose-400 border-rose-800/40"
                  }`}
                >
                  {latencyResult.ok ? `${latencyResult.ms}ms` : "Unreachable"}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Notification banner */}
        {notification && (
          <div
            className={`p-3 rounded-lg border flex items-center justify-between text-xs transition-all ${getNotificationClasses(
              notification.type
            )}`}
          >
            <div className="flex items-center gap-2">
              {notification.type === "info" && <Info className="h-4 w-4 text-blue-400 shrink-0" />}
              {notification.type === "success" && <Check className="h-4 w-4 text-emerald-400 shrink-0" />}
              {notification.type === "error" && <ShieldAlert className="h-4 w-4 text-rose-400 shrink-0" />}
              <span>{notification.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setNotification(null)}
              className="text-[#9393a0] hover:text-white font-bold ml-3 cursor-pointer"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* Relay nodes table */}
      <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#23232a] pb-3">
          <div>
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">
              Configured Relay Nodes
            </h3>
            <p className="text-[11px] text-[#71717a]">
              Manage egress proxy workers (Cloudflare Workers, Vercel Edge, custom gateways).
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2b64e0] hover:bg-[#2557c7] text-xs font-semibold text-white transition cursor-pointer self-start sm:self-auto shadow-sm"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{showAddForm ? "Cancel" : "Add Relay"}</span>
          </button>
        </div>

        {/* Add relay form */}
        {showAddForm && (
          <form
            onSubmit={handleAddRelay}
            className="p-4 rounded-xl bg-[#121215] border border-[#2b64e0]/40 space-y-3 animate-in fade-in duration-200"
          >
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <Zap className="h-3.5 w-3.5 text-[#3b82f6]" />
              <span>Connect New Relay Worker</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2 space-y-1">
                <span className="block text-[10px] uppercase font-mono tracking-wider text-[#8b8b96]">
                  Relay Worker URL *
                </span>
                <input
                  type="text"
                  placeholder="https://my-relay.workers.dev"
                  value={newUrl}
                  onInput={(e) => setNewUrl((e.target as HTMLInputElement).value)}
                  required
                  autoFocus
                  className="w-full px-3 py-2 text-xs rounded-lg bg-[#18181c] border border-[#282832] text-white placeholder-[#52525b] focus:outline-none focus:border-[#2b64e0] font-mono"
                />
              </div>
              <div className="space-y-1">
                <span className="block text-[10px] uppercase font-mono tracking-wider text-[#8b8b96]">
                  Label (Optional)
                </span>
                <input
                  type="text"
                  placeholder="e.g. Cloudflare SG / Vercel US"
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
                className="px-4 py-1.5 rounded-lg bg-[#2b64e0] hover:bg-[#2557c7] text-xs font-semibold text-white transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                Save Relay
              </button>
            </div>
          </form>
        )}

        {/* Relay list */}
        {relayState && relayState.relays.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#23232a] text-[#71717a] text-[11px] uppercase font-mono tracking-wider">
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
                    onProbe={async (url) => {
                      setProbeMap((prev) => ({ ...prev, [url]: { ok: false, probing: true } }));
                      try {
                        const res = await probeRelay(url);
                        setProbeMap((prev) => ({
                          ...prev,
                          [url]: { ok: res.ok, latencyMs: res.latencyMs, error: res.error, probing: false },
                        }));
                      } catch (err) {
                        setProbeMap((prev) => ({
                          ...prev,
                          [url]: { ok: false, error: err instanceof Error ? err.message : "Probe failed", probing: false },
                        }));
                      }
                    }}
                    onSetActive={handleSetActive}
                    onRemove={handleRemoveRelay}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* Empty state */
          <div className="p-8 rounded-xl bg-[#121215] border border-dashed border-[#282832] text-center space-y-3">
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
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#2b64e0] hover:bg-[#2557c7] text-xs font-semibold text-white transition cursor-pointer shadow-sm"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Relay Node</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Allowed target origins */}
      <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-5 shadow-sm space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-white uppercase tracking-wider">
          <Lock className="h-3.5 w-3.5 text-emerald-400" />
          <span>Security & Target Scope</span>
        </div>
        <p className="text-xs text-[#9393a0]">
          To prevent relay workers from being abused as open proxies, requests forwarded via <code className="text-white font-mono">x-relay-target</code> are strictly restricted to verified keyless upstream origins:
        </p>

        <div className="flex flex-wrap gap-2 pt-1">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#121215] border border-[#282832] text-xs font-mono text-[#d4d4d8]">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {" "}https://opencode.ai
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#121215] border border-[#282832] text-xs font-mono text-[#d4d4d8]">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {" "}https://api.kilo.ai
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#121215] border border-[#282832] text-xs font-mono text-[#d4d4d8]">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {" "}https://llm7.io
          </span>
        </div>
      </div>

      {/* CLI quick commands */}
      <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-[#23232a] pb-3">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-[#8b8b96]" />
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">
              CLI Quick Commands
            </h3>
          </div>
          <span className="text-[11px] font-mono text-[#71717a]">
            Terminal Equivalence
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-[#121215] border border-[#23232a] flex items-center justify-between">
            <div>
              <div className="text-[10px] text-[#71717a] font-mono uppercase">Toggle Relay</div>
              <code className="text-white font-mono">bansos relay on | off</code>
            </div>
            <button
              type="button"
              onClick={() => handleCopy("bansos relay on", "cli-toggle")}
              className="p-1.5 rounded-md hover:bg-[#202026] text-[#71717a] hover:text-white transition cursor-pointer"
              title="Copy"
            >
              {copiedCli === "cli-toggle" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>

          <div className="p-3 rounded-lg bg-[#121215] border border-[#23232a] flex items-center justify-between">
            <div>
              <div className="text-[10px] text-[#71717a] font-mono uppercase">Switch Active</div>
              <code className="text-white font-mono">bansos relay use &lt;URL&gt;</code>
            </div>
            <button
              type="button"
              onClick={() => handleCopy("bansos relay use <URL>", "cli-use")}
              className="p-1.5 rounded-md hover:bg-[#202026] text-[#71717a] hover:text-white transition cursor-pointer"
              title="Copy"
            >
              {copiedCli === "cli-use" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>

          <div className="p-3 rounded-lg bg-[#121215] border border-[#23232a] flex items-center justify-between">
            <div>
              <div className="text-[10px] text-[#71717a] font-mono uppercase">Save New Relay</div>
              <code className="text-white font-mono">bansos relay url &lt;URL&gt;</code>
            </div>
            <button
              type="button"
              onClick={() => handleCopy("bansos relay url <URL>", "cli-url")}
              className="p-1.5 rounded-md hover:bg-[#202026] text-[#71717a] hover:text-white transition cursor-pointer"
              title="Copy"
            >
              {copiedCli === "cli-url" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>

          <div className="p-3 rounded-lg bg-[#121215] border border-[#23232a] flex items-center justify-between">
            <div>
              <div className="text-[10px] text-[#71717a] font-mono uppercase">List Relays</div>
              <code className="text-white font-mono">bansos relay list</code>
            </div>
            <button
              type="button"
              onClick={() => handleCopy("bansos relay list", "cli-list")}
              className="p-1.5 rounded-md hover:bg-[#202026] text-[#71717a] hover:text-white transition cursor-pointer"
              title="Copy"
            >
              {copiedCli === "cli-list" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
