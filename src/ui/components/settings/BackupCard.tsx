import { useState, useRef } from "preact/hooks";
import { Download, Upload, Trash2, Check, Loader2, TriangleAlert, FileJson, RotateCcw } from "lucide-preact";
import type { BackupData, RestoreOptions } from "../../types";
import { fetchBackup, restoreBackup, clearActivity } from "../../services/api";

interface BackupCardProps {
  onRestored?: () => void;
}

interface ParsedBackup {
  filename: string;
  sizeKb: number;
  raw: BackupData;
  hasConfig: boolean;
  activityCount: number;
  hasRelay: boolean;
}

export function BackupCard({ onRestored }: BackupCardProps) {
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [parsed, setParsed] = useState<ParsedBackup | null>(null);
  const [restoreConfig, setRestoreConfig] = useState(true);
  const [restoreActivity, setRestoreActivity] = useState(true);
  const [replaceActivity, setReplaceActivity] = useState(false);
  const [restoreRelay, setRestoreRelay] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleExport() {
    setExporting(true);
    setError(null);
    setSuccess(null);
    try {
      const data = await fetchBackup();
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const dateTag = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `bansos-backup-${dateTag}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSuccess("Backup downloaded successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export backup");
    } finally {
      setExporting(false);
    }
  }

  function handleFileSelected(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    setError(null);
    setSuccess(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = String(event.target?.result ?? "");
        const raw = JSON.parse(text) as BackupData;
        const dataObj = raw.data ?? raw;
        const hasConfig = Boolean(dataObj.config && typeof dataObj.config === "object");
        const events = Array.isArray(dataObj.activity?.events)
          ? dataObj.activity.events
          : Array.isArray((dataObj as unknown as { events?: unknown[] }).events)
            ? (dataObj as unknown as { events: unknown[] }).events
            : [];
        const hasRelay = Boolean(dataObj.relay && typeof dataObj.relay === "object");

        if (!hasConfig && events.length === 0 && !hasRelay) {
          setError("File does not contain valid Bansos Router backup components (config, activity, or relay).");
          setParsed(null);
          return;
        }

        setParsed({
          filename: file.name,
          sizeKb: Math.max(1, Math.round(file.size / 1024)),
          raw,
          hasConfig,
          activityCount: events.length,
          hasRelay,
        });
        setRestoreConfig(hasConfig);
        setRestoreActivity(events.length > 0);
        setRestoreRelay(hasRelay);
      } catch {
        setError("Selected file is not valid JSON.");
        setParsed(null);
      }
    };
    reader.readAsText(file);
    target.value = "";
  }

  async function handleApplyRestore() {
    if (!parsed) return;
    setRestoring(true);
    setError(null);
    setSuccess(null);
    try {
      const options: RestoreOptions = {
        restoreConfig,
        restoreActivity,
        replaceActivity,
        restoreRelay,
      };
      const result = await restoreBackup({ data: parsed.raw.data ?? parsed.raw, options });
      const parts: string[] = [];
      if (result.restored.config) parts.push("Config");
      if (result.restored.activityCount > 0) parts.push(`${result.restored.activityCount} activity events`);
      if (result.restored.relay) parts.push("Relay");
      let msg = `Restored: ${parts.join(", ") || "No items selected"}.`;
      if (result.restartRequired.length > 0) {
        msg += ` Note: restart the daemon to apply changes to ${result.restartRequired.join(", ")}.`;
      }
      setSuccess(msg);
      setParsed(null);
      onRestored?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore backup");
    } finally {
      setRestoring(false);
    }
  }

  async function handleClearActivity() {
    setClearing(true);
    setError(null);
    setSuccess(null);
    try {
      await clearActivity();
      setSuccess("Activity history wiped clean.");
      setConfirmClear(false);
      onRestored?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear activity history");
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="rounded-xl border border-[#1c1f2b] bg-[#10121a] p-4 sm:p-5 shadow-xs space-y-4">
      <div className="border-b border-[#1c1f2b] pb-3">
        <span className="text-xs font-bold text-white tracking-tight uppercase">Backup & Data Management</span>
        <p className="text-[11px] text-[#71717a]">
          Export your daemon configuration, usage history, and relay endpoints to a portable JSON file, or restore from a previous snapshot.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-800/40 bg-rose-950/40 p-3 text-xs text-rose-300 flex items-center gap-2">
          <TriangleAlert className="h-4 w-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/40 p-3 text-xs text-emerald-300 flex items-center gap-2">
          <Check className="h-4 w-4 shrink-0 text-emerald-400" />
          <span>{success}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* export section */}
        <div className="rounded-lg border border-[#1c1f2b] bg-[#0c0e14] p-4 flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center gap-2">
              <Download className="h-4 w-4 text-[#2563eb]" />
              <span className="text-xs font-semibold text-white">Export Backup</span>
            </div>
            <p className="text-[11px] text-[#9393a0] mt-1">
              Creates a downloadable JSON bundle containing your security preferences, port/bind config, upstream relay settings, and full activity logs.
            </p>
          </div>
          <button
            type="button"
            disabled={exporting}
            onClick={() => void handleExport()}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[#2563eb] hover:bg-[#3b82f6] text-white text-xs font-medium cursor-pointer disabled:opacity-50 min-h-10 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            <span>{exporting ? "Generating backup..." : "Download Backup (.json)"}</span>
          </button>
        </div>

        {/* restore section */}
        <div className="rounded-lg border border-[#1c1f2b] bg-[#0c0e14] p-4 flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center gap-2">
              <Upload className="h-4 w-4 text-emerald-400" />
              <span className="text-xs font-semibold text-white">Restore from Backup</span>
            </div>
            <p className="text-[11px] text-[#9393a0] mt-1">
              Select a previously exported JSON backup file to selectively restore configuration, request logs, or relay rules.
            </p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileSelected}
            className="hidden"
          />

          <button
            type="button"
            disabled={restoring}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[#1c1f2b] hover:bg-[#2b334a] border border-[#2e2e38] text-white text-xs font-medium cursor-pointer disabled:opacity-50 min-h-10 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
          >
            <Upload className="h-4 w-4" />
            <span>Select Backup File...</span>
          </button>
        </div>
      </div>

      {/* restore preview and selective picker */}
      {parsed && (
        <div className="rounded-lg border border-[#2b334a] bg-[#141824] p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-[#1c1f2b] pb-2">
            <div className="flex items-center gap-2">
              <FileJson className="h-4 w-4 text-emerald-400" />
              <span className="text-xs font-semibold text-white">{parsed.filename}</span>
              <span className="text-[10px] text-[#71717a] font-mono">({parsed.sizeKb} KB)</span>
            </div>
            <button
              type="button"
              onClick={() => setParsed(null)}
              className="text-[11px] text-[#9393a0] hover:text-white cursor-pointer"
            >
              Cancel
            </button>
          </div>

          <span className="block text-[11px] text-[#d4d4d8]">Components detected in backup. Choose what to restore:</span>

          <div className="space-y-2">
            {parsed.hasConfig && (
              <label className="flex items-center gap-2.5 text-xs text-white cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={restoreConfig}
                  onChange={(e) => setRestoreConfig((e.target as HTMLInputElement).checked)}
                  className="rounded border-[#71717a] text-[#2563eb] focus:ring-0 focus:ring-offset-0 bg-[#0c0e14] h-4 w-4"
                />
                <span>Daemon Configuration (port, bind, security policies)</span>
              </label>
            )}

            {parsed.activityCount > 0 && (
              <div className="space-y-1.5 pl-0.5">
                <label className="flex items-center gap-2.5 text-xs text-white cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={restoreActivity}
                    onChange={(e) => setRestoreActivity((e.target as HTMLInputElement).checked)}
                    className="rounded border-[#71717a] text-[#2563eb] focus:ring-0 focus:ring-offset-0 bg-[#0c0e14] h-4 w-4"
                  />
                  <span>Activity & Request History ({parsed.activityCount} events)</span>
                </label>
                {restoreActivity && (
                  <div className="ml-6 flex items-center gap-4 text-[11px] text-[#9393a0]">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="activity-merge-mode"
                        checked={!replaceActivity}
                        onChange={() => setReplaceActivity(false)}
                      />
                      <span>Merge with existing</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="activity-merge-mode"
                        checked={replaceActivity}
                        onChange={() => setReplaceActivity(true)}
                      />
                      <span>Replace existing</span>
                    </label>
                  </div>
                )}
              </div>
            )}

            {parsed.hasRelay && (
              <label className="flex items-center gap-2.5 text-xs text-white cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={restoreRelay}
                  onChange={(e) => setRestoreRelay((e.target as HTMLInputElement).checked)}
                  className="rounded border-[#71717a] text-[#2563eb] focus:ring-0 focus:ring-offset-0 bg-[#0c0e14] h-4 w-4"
                />
                <span>Relay & Upstream Endpoints</span>
              </label>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1c1f2b]">
            <button
              type="button"
              onClick={() => setParsed(null)}
              className="px-3 py-1.5 rounded-md bg-[#202026] hover:bg-[#2b2b36] border border-[#2e2e38] text-xs font-medium text-[#d4d4d8] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={restoring || (!restoreConfig && !restoreActivity && !restoreRelay)}
              onClick={() => void handleApplyRestore()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-800 text-xs font-semibold text-white cursor-pointer disabled:opacity-40"
            >
              {restoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              <span>{restoring ? "Restoring..." : "Restore Selected"}</span>
            </button>
          </div>
        </div>
      )}

      {/* maintenance section */}
      <div className="rounded-lg border border-rose-950/40 bg-[#0e0a0d] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <span className="block text-xs font-semibold text-rose-300">Wipe Activity Logs</span>
          <span className="block text-[11px] text-[#8c7479] mt-0.5">
            Permanently deletes all usage stats and request records in ~/.bansos/activity.json. Configuration remains intact.
          </span>
        </div>

        {confirmClear ? (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={clearing}
              onClick={() => void handleClearActivity()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white cursor-pointer disabled:opacity-50 min-h-9"
            >
              {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              <span>Confirm Wipe</span>
            </button>
            <button
              type="button"
              disabled={clearing}
              onClick={() => setConfirmClear(false)}
              className="px-3 py-1.5 rounded-md bg-[#202026] text-xs font-medium text-[#d4d4d8] cursor-pointer min-h-9"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-rose-900/40 bg-rose-950/20 hover:bg-rose-950/40 text-xs font-medium text-rose-300 cursor-pointer min-h-10 transition shrink-0"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Clear Activity History</span>
          </button>
        )}
      </div>
    </div>
  );
}
