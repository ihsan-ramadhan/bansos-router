import { useState, useEffect, useCallback } from "preact/hooks";
import { fetchStatus, fetchModels, refreshCatalog } from "../services/api";
import type { DaemonStatus, ModelItem } from "../types";

export function useDaemonStatus() {
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  const [models, setModels] = useState<ModelItem[]>([]);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingModels, setLoadingModels] = useState(true);
  const [refreshingCatalog, setRefreshingCatalog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async (manual = false) => {
    if (manual) {
      setLoadingStatus(true);
    }
    try {
      const [statusData, modelsRes] = await Promise.all([
        fetchStatus(),
        fetchModels(),
      ]);
      setStatus(statusData);
      setModels(modelsRes.data || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect to daemon");
    } finally {
      if (manual) {
        setTimeout(() => setLoadingStatus(false), 500);
      } else {
        setLoadingStatus(false);
      }
      setLoadingModels(false);
    }
  }, []);

  const loadModels = useCallback(async () => {
    try {
      setLoadingModels(true);
      const res = await fetchModels();
      setModels(res.data || []);
    } catch (err) {
      console.error("Failed to load models:", err);
    } finally {
      setLoadingModels(false);
    }
  }, []);

  const handleRefreshCatalog = useCallback(async () => {
    setRefreshingCatalog(true);
    try {
      await refreshCatalog();
      await Promise.all([loadModels(), loadStatus()]);
    } catch (err) {
      console.error("Failed to refresh catalog:", err);
    } finally {
      setRefreshingCatalog(false);
    }
  }, [loadModels, loadStatus]);

  useEffect(() => {
    loadStatus();
    loadModels();

    const interval = setInterval(loadStatus, 5000);
    return () => clearInterval(interval);
  }, [loadStatus, loadModels]);

  const daemonHost =
    typeof window !== "undefined" && window.location.hostname && window.location.hostname !== "localhost"
      ? window.location.hostname
      : "127.0.0.1";
  const daemonPort = status?.port ?? 17070;
  const daemonAddress = `${daemonHost}:${daemonPort}`;

  const isConnected = Boolean(status && !error);
  const isConnecting = loadingStatus && !status;

  return {
    status,
    models,
    loadingStatus,
    loadingModels,
    refreshingCatalog,
    error,
    daemonPort,
    daemonAddress,
    isConnected,
    isConnecting,
    loadStatus,
    handleRefreshCatalog,
  };
}
