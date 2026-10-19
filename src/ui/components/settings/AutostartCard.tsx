import { useEffect, useState } from "preact/hooks";
import { Loader2, TriangleAlert } from "lucide-preact";
import type { AutostartState } from "../../types";
import { fetchAutostart, setAutostart } from "../../services/api";

const DETAIL: Record<NonNullable<AutostartState["manager"]>, string> = {
  systemd: "Runs bansos as a systemd user service when you log in, and restarts it if it crashes.",
  launchd: "Runs bansos as a LaunchAgent when you log in, and restarts it if it crashes.",
  "startup-folder": "Runs bansos start --bg from your Startup folder when you log in.",
};

export function AutostartCard({ active }: { active: boolean }) {
  const [state, setState] = useState<AutostartState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!active || state) return;
    fetchAutostart().then(setState, (err) => setError(err instanceof Error ? err.message : "Failed to read start-at-login"));
  }, [active]);

  async function toggle() {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      const next = await setAutostart(!state.enabled);
      setState(next);
      setNote(next.enabled
        ? "On. The bansos running now keeps going; from your next login it starts by itself."
        : "Off. bansos keeps running until you stop it, and will not start at your next login.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change start-at-login");
    } finally {
      setBusy(false);
    }
  }

  const supported = Boolean(state?.supported);
  const on = Boolean(state?.enabled);

  return (
    <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-4 sm:p-5 shadow-xs space-y-3">
      <div className="flex items-center justify-between gap-4">
        <span id="autostart-label" className="min-w-0">
          <span className="block text-xs font-bold text-white tracking-tight uppercase">Start at login</span>
          <span className="block text-[11px] text-[#9393a0] mt-0.5">
            {!state
              ? "Checking..."
              : !supported
                ? state.reason
                : state.manager
                  ? DETAIL[state.manager]
                  : null}
          </span>
        </span>
        {busy ? (
          <Loader2 className="h-5 w-5 animate-spin text-[#9393a0] shrink-0" />
        ) : (
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-labelledby="autostart-label"
            disabled={!supported}
            onClick={() => void toggle()}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40 ${
              on ? "bg-emerald-500" : "bg-[#282832]"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition duration-200 ${
                on ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        )}
      </div>

      {state?.broken && (
        <div className="p-3 rounded-lg border border-amber-800/40 bg-amber-950/30 text-xs text-amber-200 flex gap-2">
          <TriangleAlert className="h-4 w-4 shrink-0" />
          <span>The saved command points at a node or bansos path that no longer exists. Turn this off and on again.</span>
        </div>
      )}
      {error && <p className="text-xs text-rose-300 break-words">{error}</p>}
      {note && !error && <p className="text-xs text-[#9393a0]">{note}</p>}
      {state?.enabled && state.path && (
        <p className="text-[11px] text-[#71717a] break-all">
          <code className="font-mono">{state.path}</code>
        </p>
      )}
    </div>
  );
}
