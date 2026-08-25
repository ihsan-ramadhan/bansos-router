import { FileCode, Check, Copy } from "lucide-preact";
import type { AdapterRenderResponse, AdapterSummary } from "../../types";
import { getWireBadge, getHarnessStrategy } from "../../utils/agent";

interface AgentConfigViewerProps {
  renderData: AdapterRenderResponse | null;
  rendering: boolean;
  activeAdapter?: AdapterSummary;
  selectedModel: string;
  modelCount: number;
  copiedConfigIndex: number | null;
  onCopyConfig: (content: string, index: number) => void;
  selectedAdapterId: string;
}

export function AgentConfigViewer({
  renderData,
  rendering,
  activeAdapter,
  selectedModel,
  modelCount,
  copiedConfigIndex,
  onCopyConfig,
  selectedAdapterId,
}: AgentConfigViewerProps) {
  return (
    <div className="rounded-xl border border-[#23232a] bg-[#16161a] overflow-hidden shadow-xs">
      <div className="bg-[#121215] border-b border-[#23232a] px-3 sm:px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <FileCode className="h-4 w-4 text-[#8b8b96] shrink-0" />
          <span className="text-xs font-bold text-white tracking-tight">
            Generated Config Output
          </span>
          {activeAdapter && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${getWireBadge(activeAdapter.wire).color}`}>
              {getWireBadge(activeAdapter.wire).label}
            </span>
          )}
          {activeAdapter && !selectedModel && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${getHarnessStrategy(activeAdapter.id, modelCount).color}`}>
              {getHarnessStrategy(activeAdapter.id, modelCount).label}
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
        {!rendering && (!renderData || renderData.config.length === 0) && (
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
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#202028] text-[#71717a] border border-[#2c2c36] shrink-0">
                    {cfg.mode || "merge"}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => onCopyConfig(cfg.content, idx)}
                  className="shrink-0 flex items-center gap-1 text-[11px] text-[#71717a] hover:text-white px-2.5 py-1 rounded bg-[#16161a] hover:bg-[#202028] border border-[#262630] transition cursor-pointer"
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

              <pre className="p-3 sm:p-3.5 rounded-lg bg-[#111113] border border-[#23232a] text-xs font-mono text-[#e4e4e7] overflow-x-auto max-h-96 select-all leading-relaxed w-full min-w-0">
                {cfg.content}
              </pre>
            </div>
          ))
        )}
      </div>

      {/* Tips */}
      <div className="bg-[#121215] border-t border-[#23232a] px-3 sm:px-4 py-2.5 text-[10px] sm:text-[11px] text-[#71717a] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1">
        <span>💡 You can revert changes anytime with <code>bansos setup {selectedAdapterId} --undo</code></span>
      </div>
    </div>
  );
}
