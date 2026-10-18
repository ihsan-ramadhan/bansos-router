import { useEffect, useState } from "preact/hooks";
import { Stethoscope, Loader2, RotateCw, CircleCheck, CircleX, TriangleAlert } from "lucide-preact";
import type { DoctorReport, HarnessState } from "../../types";
import { formatProviderShort } from "../../utils/models";
import { fetchDoctor } from "../../services/api";

const HARNESS_LABEL: Record<HarnessState, { text: string; className: string }> = {
  configured: { text: "set up", className: "text-emerald-400" },
  unconfigured: { text: "config found, bansos not added", className: "text-amber-300" },
  missing: { text: "not set up", className: "text-[#71717a]" },
};

export function HealthCard({ active }: { active: boolean }) {
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    try {
      setReport(await fetchDoctor());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Health check failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (active && !report) void run();
  }, [active]);

  const problems = (report?.configWarnings.length ?? 0) + (error ? 1 : 0);

  return (
    <div className="rounded-xl border border-[#23232a] bg-[#16161a] p-4 sm:p-5 shadow-xs space-y-4">
      <div className="flex items-center justify-between gap-3 border-b border-[#23232a] pb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Stethoscope className="h-4 w-4 text-[#3b82f6] shrink-0" />
          <div>
            <span className="text-xs font-bold text-white tracking-tight uppercase">Health check</span>
            <p className="text-[11px] text-[#71717a]">Same checks as <code className="font-mono">bansos doctor</code>.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-[#202026] hover:bg-[#282832] border border-[#2e2e38] text-xs font-medium text-[#d4d4d8] hover:text-white cursor-pointer disabled:opacity-50 min-h-9 shrink-0"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
          <span>Run again</span>
        </button>
      </div>

      {error && <p className="text-xs text-rose-300">{error}</p>}

      {report && (
        <ul className="space-y-2 text-xs">
          <li className="flex items-start gap-2">
            <CircleCheck className="h-4 w-4 text-emerald-400 shrink-0" />
            <span className="text-[#d4d4d8]">
              Daemon running, version <span className="font-mono">{report.version}</span>
              {report.update.hasUpdate && (
                <span className="text-amber-300">
                  {" "}· {report.update.latest} is available (<code className="font-mono">npm i -g bansos-router</code>)
                </span>
              )}
            </span>
          </li>
          <SecurityLine security={report.security} />
          {problems === 0 && (
            <li className="flex items-start gap-2">
              <CircleCheck className="h-4 w-4 text-emerald-400 shrink-0" />
              <span className="text-[#d4d4d8]">Config file is valid</span>
            </li>
          )}
          {report.configWarnings.map((w) => (
            <li key={w} className="flex items-start gap-2">
              <CircleX className="h-4 w-4 text-rose-400 shrink-0" />
              <span className="text-rose-300 break-all">{w}</span>
            </li>
          ))}
          <li className="pt-2">
            <span className="block text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-[#8b8b96] mb-1.5">Coding agents</span>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
              {report.harnesses.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 py-1 border-b border-[#1f1f26]" title={h.path}>
                  <span className="font-mono text-[#d4d4d8]">{h.id}</span>
                  <span className={`inline-flex items-center gap-1 ${HARNESS_LABEL[h.status].className}`}>
                    {h.status === "unconfigured" && <TriangleAlert className="h-3 w-3" />}
                    {HARNESS_LABEL[h.status].text}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        </ul>
      )}
    </div>
  );
}

function SecurityLine({ security }: { security: DoctorReport["security"] }) {
  if (security.mode === "normal") {
    return (
      <li className="flex items-start gap-2">
        <CircleCheck className="h-4 w-4 text-emerald-400 shrink-0" />
        <span className="text-[#d4d4d8]">
          Normal mode · failover {security.allowCrossProviderFailover ? "on" : "off"} · secrets are not scanned
        </span>
      </li>
    );
  }
  const allowed = security.allowedUpstreams;
  return (
    <li className="flex items-start gap-2">
      {allowed.length === 0 ? (
        <TriangleAlert className="h-4 w-4 text-amber-300 shrink-0" />
      ) : (
        <CircleCheck className="h-4 w-4 text-emerald-400 shrink-0" />
      )}
      <span className="text-[#d4d4d8]">
        Strict mode · {security.dlp === "block" ? "blocks" : "redacts"} secrets ·{" "}
        {allowed.length === 0 ? (
          <span className="text-amber-300">no providers allowed, every request is refused</span>
        ) : (
          <>allowed: {allowed.map(formatProviderShort).join(", ")}</>
        )}
      </span>
    </li>
  );
}
