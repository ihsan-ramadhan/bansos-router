import { useState, useEffect, useCallback } from "preact/hooks";
import type { RelayStateResponse, NotificationType, ProbeStatus } from "../../types";
import { fetchRelayState, updateRelayState, probeRelay } from "../../services/api";
import { RelayHeader } from "./RelayHeader";
import { RelayTableSection, RelayFooterInfo } from "./RelayTableSection";

interface RelayManagerProps {
  daemonPort: number;
  onStateChange?: () => void;
}

export function RelayManager({ daemonPort: _daemonPort, onStateChange }: RelayManagerProps) {
  const [relayState, setRelayState] = useState<RelayStateResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [updating, setUpdating] = useState<boolean>(false);
  const [notification, setNotification] = useState<{ type: NotificationType; message: string } | null>(null);

  const [testingLatency, setTestingLatency] = useState<boolean>(false);
  const [latencyResult, setLatencyResult] = useState<{ ms?: number; ok?: boolean; error?: string } | null>(null);
  const [probeMap, setProbeMap] = useState<Record<string, ProbeStatus>>({});

  const showToast = useCallback((type: NotificationType, message: string) => {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification((curr) => (curr?.message === message ? null : curr));
    }, 4000);
  }, []);

  const loadState = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchRelayState();
      setRelayState(data);
    } catch (err) {
      console.error("Failed to load relay state:", err);
      showToast("error", err instanceof Error ? err.message : "Failed to load relay configuration");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const probeRelayReachable = useCallback(
    async (url: string): Promise<{ ok: boolean; latencyMs?: number } | null> => {
      setUpdating(true);
      setProbeMap((prev) => ({ ...prev, [url]: { ok: false, probing: true } }));
      try {
        const probeRes = await probeRelay(url);
        setProbeMap((prev) => ({
          ...prev,
          [url]: { ok: probeRes.ok, latencyMs: probeRes.latencyMs, error: probeRes.error, probing: false },
        }));
        setLatencyResult({ ms: probeRes.latencyMs, ok: probeRes.ok, error: probeRes.error });
        if (!probeRes.ok) {
          showToast("error", `Relay unreachable (${probeRes.error || "connection failed"}). Direct Egress preserved.`);
          return null;
        }
        return { ok: true, latencyMs: probeRes.latencyMs };
      } catch (err) {
        setProbeMap((prev) => ({
          ...prev,
          [url]: { ok: false, error: err instanceof Error ? err.message : "Probe failed", probing: false },
        }));
        showToast("error", "Failed to reach relay endpoint. Direct Egress preserved.");
        return null;
      } finally {
        setUpdating(false);
      }
    },
    [showToast]
  );

  const isEnabled = Boolean(relayState?.enabled && relayState?.url);

  async function handleToggleEnabled() {
    if (!relayState) return;

    if (!isEnabled && !relayState.relays?.length && !relayState.url) {
      showToast("info", "Add a relay worker URL first before enabling relay mode.");
      return;
    }

    const nextEnabled = !isEnabled;
    let activeUrl = relayState.url;

    if (nextEnabled && !activeUrl && relayState.relays?.length) {
      activeUrl = relayState.relays[0]?.url ?? "";
    }

    if (nextEnabled && activeUrl) {
      const reachable = await probeRelayReachable(activeUrl);
      if (!reachable) return;
    }

    try {
      setUpdating(true);
      const updated = await updateRelayState({
        enabled: nextEnabled,
        url: activeUrl,
      });
      setRelayState(updated);
      showToast("success", nextEnabled ? "Relay egress enabled" : "Relay disabled (Direct egress)");
      onStateChange?.();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to toggle relay mode");
    } finally {
      setUpdating(false);
    }
  }

  async function handleSetActive(url: string) {
    const reachable = await probeRelayReachable(url);
    if (!reachable) return;

    try {
      setUpdating(true);
      const updated = await updateRelayState({
        url,
        enabled: true,
      });
      setRelayState(updated);
      showToast("success", `Active relay switched to ${url}`);
      onStateChange?.();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to set active relay");
      setProbeMap((prev) => ({
        ...prev,
        [url]: { ok: false, error: "Activation failed", probing: false },
      }));
    } finally {
      setUpdating(false);
    }
  }

  async function handleAddRelay(url: string, label: string) {
    const cleanUrl = url.trim();
    if (!cleanUrl) return;

    if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
      showToast("error", "Relay URL must start with https:// or http://");
      return;
    }

    const shouldAutoActivate = !isEnabled || !relayState?.url;

    let canAutoActivate = false;
    if (shouldAutoActivate) {
      const probeRes = await probeRelayReachable(cleanUrl);
      if (probeRes?.ok) {
        canAutoActivate = true;
      }
    }

    try {
      setUpdating(true);
      const updated = await updateRelayState({
        action: "add",
        url: cleanUrl,
        label: label.trim() || undefined,
        ...(canAutoActivate ? { url: cleanUrl, enabled: true } : {}),
      });
      setRelayState(updated);
      showToast("success", canAutoActivate ? `Relay verified and activated: ${cleanUrl}` : `Relay node saved: ${cleanUrl}`);
      onStateChange?.();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to save relay node");
    } finally {
      setUpdating(false);
    }
  }

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
      showToast("info", `Relay node removed: ${url}`);
      onStateChange?.();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to remove relay");
    } finally {
      setUpdating(false);
    }
  }

  async function handleTestRelay() {
    if (!relayState?.url) return;
    try {
      setTestingLatency(true);
      setLatencyResult(null);
      const res = await probeRelay(relayState.url);
      setLatencyResult({
        ms: res.latencyMs,
        ok: res.ok,
        error: res.error,
      });
      if (res.ok) {
        showToast("success", `Relay responded in ${res.latencyMs}ms`);
      } else {
        showToast("error", `Relay probe failed: ${res.error || "Connection failed"}`);
      }
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Probe failed");
    } finally {
      setTestingLatency(false);
    }
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <RelayHeader
        isEnabled={isEnabled}
        activeUrl={relayState?.url}
        updating={updating}
        loading={loading}
        onToggleEnabled={handleToggleEnabled}
        onTestLatency={handleTestRelay}
        testingLatency={testingLatency}
        latencyResult={latencyResult}
        notification={notification}
        onDismissNotification={() => setNotification(null)}
      />

      <RelayTableSection
        relayState={relayState}
        isEnabled={isEnabled}
        updating={updating}
        probeMap={probeMap}
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
        onAddRelay={handleAddRelay}
      />

      <RelayFooterInfo />
    </div>
  );
}
