import { FileCode, Check, Copy } from "lucide-preact";
import type { AdapterRenderResponse, AdapterSummary } from "../../types";
import { getWireBadge } from "../../utils/agent";

interface AgentConfigViewerProps {
  renderData: AdapterRenderResponse | null;
  rendering: boolean;
  error?: string | null;
  activeAdapter?: AdapterSummary;
  strategy: { label: string; color: string } | null;
  copiedConfigIndex: number | null;
  onCopyConfig: (content: string, index: number) => void;
  selectedAdapterId: string;
}

export function AgentConfigViewer({
  renderData,
  rendering,
  error,
  activeAdapter,
  strategy,
  copiedConfigIndex,
  onCopyConfig,
  selectedAdapterId,
}: AgentConfigViewerProps) {
  return (
    <div className="rounded-xl border border-[#1c1f2b] bg-[#10121a] overflow-hidden shadow-xs">
      <div className="bg-[#0c0e14] border-b border-[#1c1f2b] px-3 sm:px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-white tracking-tight">
            Generated Config Output
          </span>
          {activeAdapter && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${getWireBadge(activeAdapter.wire).color}`}>
              {getWireBadge(activeAdapter.wire).label}
            </span>
          )}
          {activeAdapter && strategy && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${strategy.color}`}>
              {strategy.label}
            </span>
          )}
        </div>

        {renderData && renderData.config.length > 0 && (
          <span className="text-[10px] sm:text-[11px] font-mono text-[#71717a]">
            {renderData.config.length} target file(s)
          </span>
        )}
      </div>

      <div className="p-3 sm:p-4 space-y-4">
        {rendering && (
          <div className="py-12 text-center text-xs text-[#71717a]">
            Rendering config...
          </div>
        )}
        {!rendering && error && (
          <div className="py-12 text-center text-xs text-[#9393a0]">{error}</div>
        )}
        {!rendering && !error && (!renderData || renderData.config.length === 0) && (
          <div className="py-12 text-center text-xs text-[#71717a]">
            No config template available for this harness.
          </div>
        )}
        {!rendering && renderData && renderData.config.length > 0 && (
          renderData.config.map((cfg, idx) => (
            <div key={`${cfg.path}-${idx}`} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-mono text-[#a1a1aa] min-w-0">
                  <span className="text-[#60a5fa] shrink-0">File:</span>
                  <span className="text-white truncate">{cfg.path}</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#131620] text-[#a1a1aa] border border-[#1c1f2b] shrink-0">
                    {cfg.mode || "merge"}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => onCopyConfig(cfg.content, idx)}
                  className="shrink-0 flex items-center gap-1 text-[11px] text-[#a1a1aa] hover:text-white px-2.5 py-1 rounded bg-[#131620] hover:bg-[#1a1e2b] border border-[#1c1f2b] transition cursor-pointer"
                  title="Copy configuration snippet"
                >
                  {copiedConfigIndex === idx ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400 shrink-0" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3 shrink-0" />
                      <span>Copy snippet</span>
                    </>
                  )}
                </button>
              </div>

              <pre className="p-3 sm:p-3.5 rounded-lg bg-[#0c0e14] border border-[#1c1f2b] text-xs font-mono text-[#e4e4e7] overflow-x-auto max-h-96 select-all leading-relaxed w-full min-w-0">
                {cfg.content}
              </pre>
            </div>
          ))
        )}
      </div>

      {/* Tips */}
      <div className="bg-[#0c0e14] border-t border-[#1c1f2b] px-3 sm:px-4 py-2.5 text-[10px] sm:text-[11px] text-[#9393a0] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1">
        <span>Undo it any time with <code>bansos setup {selectedAdapterId} --undo</code>.</span>
      </div>
    </div>
  );
}
