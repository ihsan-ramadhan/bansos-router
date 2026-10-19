import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { Settings, Save, RotateCw, Loader2, TriangleAlert, Check, Info, X } from "lucide-preact";
import type { ConfigState, DaemonSettings, NotificationType } from "../../types";
import { fetchConfig, restartDaemon, saveConfig } from "../../services/api";
import { getNotificationClasses } from "../../utils/relay";
import { HealthCard } from "./HealthCard";
import { AutostartCard } from "./AutostartCard";

interface SettingsViewProps {
  active: boolean;
  onApplied: () => void;
}

const REFRESH_CHOICES = [
  { label: "Off", value: 0 },
  { label: "Every 15 minutes", value: 15 * 60_000 },
  { label: "Every 30 minutes", value: 30 * 60_000 },
  { label: "Every hour", value: 60 * 60_000 },
  { label: "Every 3 hours", value: 3 * 60 * 60_000 },
  { label: "Every 6 hours", value: 6 * 60 * 60_000 },
  { label: "Every 24 hours", value: 24 * 60 * 60_000 },
];

const FIELD_LABELS: Record<string, string> = {
  security: "security",
  refreshIntervalMs: "catalog refresh",
  port: "port",
  bind: "bind address",
};

const isLoopback = (bind: string) => bind === "localhost" || bind.startsWith("127.") || bind === "::1";

function sameSettings(a: DaemonSettings, b: DaemonSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; title: string; detail: string }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={`text-left rounded-lg border px-3 py-2.5 transition cursor-pointer min-h-11 ${
              selected
                ? "border-[#2b64e0] bg-[#2b64e0]/10"
                : "border-[#262630] bg-[#121215] hover:border-[#383846]"
            }`}
          >
            <span className={`block text-xs font-semibold ${selected ? "text-white" : "text-[#d4d4d8]"}`}>{o.title}</span>
            <span className="block text-[11px] text-[#9393a0] mt-0.5">{o.detail}</span>
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: ComponentChildren; children: ComponentChildren }) {
  return (
    <div className="space-y-1.5">
      <span className="block text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-[#8b8b96]">{label}</span>
      {children}
      {hint && <p className="text-[11px] text-[#71717a]">{hint}</p>}
    </div>
  );
}

async function waitForDaemon(): Promise<ConfigState | null> {
  await new Promise((r) => setTimeout(r, 1200));
  for (let i = 0; i < 30; i++) {
    try {
      return await fetchConfig();
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return null;
}

export function SettingsView({ active, onApplied }: SettingsViewProps) {
  const [config, setConfig] = useState<ConfigState | null>(null);
  const [draft, setDraft] = useState<DaemonSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [notice, setNotice] = useState<{ type: NotificationType; message: string } | null>(null);

  async function load() {
    try {
      const next = await fetchConfig();
      setConfig(next);
      setDraft(next.saved);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load settings");
    }
  }

  useEffect(() => {
    if (active && !config) void load();
  }, [active]);

  if (loadError && !config) {
    return (
      <div className="rounded-xl border border-rose-800/40 bg-rose-950/40 p-4 text-xs text-rose-300 flex items-center justify-between gap-3">
        <span>{loadError}</span>
        <button type="button" onClick={() => void load()} className="px-3 py-1.5 rounded-md bg-[#202026] border border-[#2e2e38] text-white cursor-pointer">
          Retry
        </button>
      </div>
    );
  }

  if (!config || !draft) {
    return (
      <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-6 flex items-center gap-2 text-xs text-[#9393a0]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading settings
      </div>
    );
  }

  const dirty = !sameSettings(draft, config.saved);
  const security = draft.security;
  const setSecurity = (patch: Partial<DaemonSettings["security"]>) =>
    setDraft({ ...draft, security: { ...security, ...patch } });
  const portValid = Number.isInteger(draft.port) && draft.port >= 1 && draft.port <= 65535;
  const refreshChoices = REFRESH_CHOICES.some((c) => c.value === draft.refreshIntervalMs)
    ? REFRESH_CHOICES
    : [...REFRESH_CHOICES, { label: `Every ${Math.round(draft.refreshIntervalMs / 60_000)} minutes`, value: draft.refreshIntervalMs }];

  async function handleSave() {
    if (!draft || !config) return;
    setSaving(true);
    setNotice(null);
    try {
      const patch: Partial<DaemonSettings> = { security: draft.security, refreshIntervalMs: draft.refreshIntervalMs };
      if (!config.flags.port) patch.port = draft.port;
      if (!config.flags.bind) patch.bind = draft.bind.trim();
      const next = await saveConfig(patch);
      setConfig(next);
      setDraft(next.saved);
      setNotice({
        type: "success",
        message: next.restartRequired.length > 0
          ? "Saved. Security changes are already active; restart to apply the rest."
          : "Saved and active.",
      });
      onApplied();
    } catch (err) {
      setNotice({ type: "error", message: err instanceof Error ? err.message : "Failed to save settings" });
    } finally {
      setSaving(false);
    }
  }

  async function handleRestart() {
    if (!config) return;
    setConfirmRestart(false);
    setRestarting(true);
    setNotice({ type: "info", message: "Restarting bansos..." });
    try {
      const { port, bind } = await restartDaemon();
      const servedByDaemon = window.location.port === String(config.running.port);
      const reachableHere = isLoopback(bind) || bind === "0.0.0.0" || bind === "::";
      const host = reachableHere ? window.location.hostname : bind.includes(":") ? `[${bind}]` : bind;
      if (servedByDaemon && (port !== config.running.port || host !== window.location.hostname)) {
        setNotice({ type: "info", message: `bansos is moving to ${host}:${port}. Opening the new address...` });
        await new Promise((r) => setTimeout(r, 2500));
        window.location.href = `${window.location.protocol}//${host}:${port}/`;
        return;
      }
      const next = await waitForDaemon();
      if (!next) {
        setNotice({ type: "error", message: "bansos did not come back within 30 seconds. Check the Logs tab or the terminal." });
        return;
      }
      setConfig(next);
      setDraft(next.saved);
      setNotice({
        type: "success",
        message: next.running.port !== config.running.port
          ? `Restarted on port ${next.running.port}. Anything that proxies to bansos must use the new port.`
          : "Restarted with the saved settings.",
      });
      onApplied();
    } catch (err) {
      setNotice({ type: "error", message: err instanceof Error ? err.message : "Failed to restart" });
    } finally {
      setRestarting(false);
    }
  }

  const pending = config.restartRequired.map((f) => FIELD_LABELS[f] ?? f).join(", ");

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0">
                <Settings className="h-4 w-4" />
              </div>
              <h2 className="text-sm sm:text-base font-bold text-white tracking-tight">Settings</h2>
            </div>
            <p className="text-xs text-[#9393a0] break-all">
              Saved to <code className="font-mono text-[#d4d4d8]">{config.path}</code>
            </p>
          </div>

          {config.canRestart && (
            <div className="flex items-center gap-2 shrink-0 self-stretch sm:self-auto">
              {confirmRestart ? (
                <>
                  <span className="text-[11px] text-[#9393a0] hidden sm:inline">Requests in progress will be cut off.</span>
                  <button
                    type="button"
                    onClick={() => setConfirmRestart(false)}
                    className="px-3 py-2 rounded-md bg-[#202026] border border-[#2e2e38] text-xs text-[#d4d4d8] hover:text-white cursor-pointer min-h-9"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRestart()}
                    className="px-3 py-2 rounded-md bg-amber-600 hover:bg-amber-500 text-xs font-semibold text-white cursor-pointer min-h-9"
                  >
                    Restart now
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmRestart(true)}
                  disabled={restarting}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-[#202026] hover:bg-[#282832] border border-[#2e2e38] text-xs font-medium text-[#d4d4d8] hover:text-white cursor-pointer disabled:opacity-50 min-h-9"
                >
                  {restarting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
                  <span>{restarting ? "Restarting..." : "Restart bansos"}</span>
                </button>
              )}
            </div>
          )}
        </div>

        {config.warnings.map((w) => (
          <div key={w} className="p-3 rounded-lg border border-rose-800/40 bg-rose-950/40 text-xs text-rose-300 flex gap-2">
            <TriangleAlert className="h-4 w-4 shrink-0" />
            <span className="break-all">{w}</span>
          </div>
        ))}

        {pending && !dirty && (
          <div className="p-3 rounded-lg border border-amber-800/40 bg-amber-950/30 text-xs text-amber-200 flex gap-2">
            <Info className="h-4 w-4 shrink-0" />
            <span>
              Saved changes to {pending} take effect after a restart.
              {!config.canRestart && " Restart the daemon from the terminal to apply them."}
            </span>
          </div>
        )}

        {notice && (
          <div className={`p-3 rounded-lg border flex items-center justify-between gap-2 text-xs ${getNotificationClasses(notice.type)}`}>
            <div className="flex items-center gap-2 min-w-0">
              {notice.type === "success" && <Check className="h-4 w-4 shrink-0" />}
              {notice.type === "error" && <TriangleAlert className="h-4 w-4 shrink-0" />}
              {notice.type === "info" && <Info className="h-4 w-4 shrink-0" />}
              <span>{notice.message}</span>
            </div>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="p-1 rounded-md cursor-pointer shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-4 sm:p-5 shadow-xs space-y-4">
        <div className="border-b border-[#23232a] pb-3">
          <span className="text-xs font-bold text-white tracking-tight uppercase">Security</span>
          <p className="text-[11px] text-[#71717a]">Applies as soon as you save. No restart needed.</p>
        </div>

        <Field label="Mode">
          <Segmented
            label="Security mode"
            value={security.mode}
            onChange={(mode) => setSecurity({ mode })}
            options={[
              { value: "normal", title: "Normal", detail: "Requests go out as they are. Failover can switch providers when a model fails." },
              { value: "strict", title: "Strict", detail: "Only providers you allow get requests. Secrets are redacted or blocked. No failover." },
            ]}
          />
        </Field>

        {security.mode === "normal" ? (
          <div className="flex items-center justify-between gap-4 rounded-lg border border-[#262630] bg-[#121215] px-3 py-2.5">
            <span id="failover-label">
              <span className="block text-xs font-semibold text-white">Cross-provider failover</span>
              <span className="block text-[11px] text-[#9393a0] mt-0.5">
                When a model answers 429 or 5xx, retry on a similar model from another provider. Your prompt then reaches that provider too.
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={security.allowCrossProviderFailover}
              aria-labelledby="failover-label"
              onClick={() => setSecurity({ allowCrossProviderFailover: !security.allowCrossProviderFailover })}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                security.allowCrossProviderFailover ? "bg-emerald-500" : "bg-[#282832]"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition duration-200 ${
                  security.allowCrossProviderFailover ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        ) : (
          <>
            <Field label="Secrets in requests">
              <Segmented
                label="Secret handling"
                value={security.dlp}
                onChange={(dlp) => setSecurity({ dlp })}
                options={[
                  { value: "redact", title: "Redact", detail: "Replace keys and passwords with [REDACTED] and send the rest. The session keeps working." },
                  { value: "block", title: "Block", detail: "Reject the whole request with HTTP 422. The secret stays in the chat history, so later turns fail too." },
                ]}
              />
            </Field>

            <Field
              label="Allowed providers"
              hint={security.allowedUpstreams.length === 0
                ? <span className="text-rose-300">No provider is allowed, so every request will be refused.</span>
                : "Models from other providers are hidden from your coding agents and refused."}
            >
              <div className="flex flex-wrap gap-2">
                {config.upstreams.map((id) => {
                  const on = security.allowedUpstreams.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() =>
                        setSecurity({
                          allowedUpstreams: on
                            ? security.allowedUpstreams.filter((u) => u !== id)
                            : config.upstreams.filter((u) => u === id || security.allowedUpstreams.includes(u)),
                        })
                      }
                      className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-mono cursor-pointer min-h-10 ${
                        on ? "border-[#2b64e0] bg-[#2b64e0]/10 text-white" : "border-[#262630] bg-[#121215] text-[#9393a0] hover:border-[#383846]"
                      }`}
                    >
                      <span
                        className={`inline-flex h-4 w-4 items-center justify-center rounded border ${
                          on ? "bg-[#2b64e0] border-[#2b64e0]" : "border-[#71717a]"
                        }`}
                      >
                        {on && <Check className="h-3 w-3 text-white" />}
                      </span>
                      {id}
                    </button>
                  );
                })}
              </div>
            </Field>
          </>
        )}
      </div>

      <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-4 sm:p-5 shadow-xs space-y-4">
        <div className="border-b border-[#23232a] pb-3">
          <span className="text-xs font-bold text-white tracking-tight uppercase">Daemon</span>
          <p className="text-[11px] text-[#71717a]">These apply after a restart.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Catalog refresh" hint="How often bansos asks each provider which free models exist.">
            <select
              value={draft.refreshIntervalMs}
              onChange={(e) => setDraft({ ...draft, refreshIntervalMs: Number((e.target as HTMLSelectElement).value) })}
              className="w-full min-h-10.5 bg-[#121215] border border-[#262630] rounded-lg px-3 text-xs text-white cursor-pointer"
            >
              {refreshChoices.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </Field>

          <Field
            label="Port"
            hint={config.flags.port ? "Set by the --port flag; the saved value is ignored." : !portValid ? <span className="text-rose-300">Use a number from 1 to 65535.</span> : undefined}
          >
            <input
              type="number"
              min={1}
              max={65535}
              value={Number.isNaN(draft.port) ? "" : draft.port}
              disabled={config.flags.port}
              onInput={(e) => setDraft({ ...draft, port: Number((e.target as HTMLInputElement).value) })}
              className="w-full min-h-10.5 bg-[#121215] border border-[#262630] rounded-lg px-3 text-xs font-mono text-white disabled:opacity-50"
            />
          </Field>

          <Field
            label="Bind address"
            hint={config.flags.bind
              ? "Set by the --bind flag; the saved value is ignored."
              : !isLoopback(draft.bind.trim())
                ? <span className="text-amber-300">Other devices on your network will be able to reach bansos.</span>
                : "127.0.0.1 keeps bansos reachable from this machine only."}
          >
            <input
              type="text"
              value={draft.bind}
              disabled={config.flags.bind}
              spellcheck={false}
              onInput={(e) => setDraft({ ...draft, bind: (e.target as HTMLInputElement).value })}
              className="w-full min-h-10.5 bg-[#121215] border border-[#262630] rounded-lg px-3 text-xs font-mono text-white disabled:opacity-50"
            />
          </Field>
        </div>
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-2">
        {dirty && <span className="text-[11px] text-[#9393a0] sm:mr-auto">You have unsaved changes.</span>}
        <button
          type="button"
          onClick={() => setDraft(config.saved)}
          disabled={!dirty || saving}
          className="px-4 py-2 rounded-md bg-[#202026] border border-[#2e2e38] text-xs font-medium text-[#d4d4d8] hover:text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed min-h-10"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!dirty || saving || !portValid}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-[#2b64e0] hover:bg-[#3a72ec] text-xs font-semibold text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed min-h-10"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          <span>{saving ? "Saving..." : "Save changes"}</span>
        </button>
      </div>

      <AutostartCard active={active} />

      <HealthCard active={active} />
    </div>
  );
}
