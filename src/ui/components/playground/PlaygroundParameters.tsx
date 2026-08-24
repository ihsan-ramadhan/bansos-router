import { useState } from "preact/hooks";
import { ChevronDown } from "lucide-preact";

interface PlaygroundParametersProps {
  temperature: number;
  onTemperatureChange: (val: number) => void;
  maxTokens: number;
  onMaxTokensChange: (val: number) => void;
  reasoningEffort: "auto" | "low" | "medium" | "high";
  onReasoningEffortChange: (val: "auto" | "low" | "medium" | "high") => void;
  stream: boolean;
  onStreamChange: (val: boolean) => void;
  noFailover: boolean;
  onNoFailoverChange: (val: boolean) => void;
}

export function PlaygroundParameters({
  temperature,
  onTemperatureChange,
  maxTokens,
  onMaxTokensChange,
  reasoningEffort,
  onReasoningEffortChange,
  stream,
  onStreamChange,
  noFailover,
  onNoFailoverChange,
}: PlaygroundParametersProps) {
  const [effortDropdownOpen, setEffortDropdownOpen] = useState(false);

  return (
    <div className="mt-4 pt-4 border-t border-[#23232a] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 text-xs animate-in fade-in duration-150">
      <div>
        <div className="flex justify-between text-[#a1a1aa] mb-1.5">
          <span>Temperature</span>
          <span className="font-mono text-white font-medium">{temperature.toFixed(2)}</span>
        </div>
        <div className="relative flex items-center h-6">
          <input
            type="range"
            min="0"
            max="2"
            step="0.05"
            value={temperature}
            onInput={(e) => onTemperatureChange(Number.parseFloat((e.target as HTMLInputElement).value))}
            onChange={(e) => onTemperatureChange(Number.parseFloat((e.target as HTMLInputElement).value))}
            style={{
              background: `linear-gradient(to right, #2b64e0 0%, #2b64e0 ${(temperature / 2) * 100}%, #202028 ${(temperature / 2) * 100}%, #202028 100%)`,
            }}
            className="w-full h-1.5 rounded-lg cursor-pointer"
          />
        </div>
      </div>

      <div>
        <div className="flex justify-between text-[#a1a1aa] mb-1.5">
          <span>Max Output Tokens</span>
          <span className="font-mono text-white font-medium">{maxTokens.toLocaleString()}</span>
        </div>
        <div className="relative flex items-center h-6">
          <input
            type="range"
            min="256"
            max="16384"
            step="256"
            value={maxTokens}
            onInput={(e) => onMaxTokensChange(Number.parseInt((e.target as HTMLInputElement).value, 10))}
            onChange={(e) => onMaxTokensChange(Number.parseInt((e.target as HTMLInputElement).value, 10))}
            style={{
              background: `linear-gradient(to right, #2b64e0 0%, #2b64e0 ${((maxTokens - 256) / (16384 - 256)) * 100}%, #202028 ${((maxTokens - 256) / (16384 - 256)) * 100}%, #202028 100%)`,
            }}
            className="w-full h-1.5 rounded-lg cursor-pointer"
          />
        </div>
      </div>

      <div className="relative">
        <div className="flex justify-between text-[#a1a1aa] mb-1.5">
          <span>Reasoning Effort</span>
          <span className="font-mono text-white font-medium capitalize">{reasoningEffort}</span>
        </div>
        <button
          type="button"
          onClick={() => setEffortDropdownOpen(!effortDropdownOpen)}
          className="w-full flex items-center justify-between px-2.5 py-1.5 bg-[#121215] hover:bg-[#18181d] border border-[#262630] hover:border-[#383846] rounded-lg text-xs font-mono text-white focus:outline-none focus:border-[#2b64e0] transition cursor-pointer"
        >
          <span>
            {reasoningEffort === "auto" && "Auto (Default)"}
            {reasoningEffort === "low" && "Low Effort"}
            {reasoningEffort === "medium" && "Medium Effort"}
            {reasoningEffort === "high" && "High Effort"}
          </span>
          <ChevronDown className={`h-3 w-3 text-[#71717a] transition-transform duration-150 ${effortDropdownOpen ? "rotate-180" : ""}`} />
        </button>

        {effortDropdownOpen && (
          <>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Close reasoning effort dropdown"
              className="fixed inset-0 z-20 cursor-default bg-transparent border-0"
              onClick={() => setEffortDropdownOpen(false)}
            />
            <div className="absolute left-0 right-0 mt-1.5 rounded-xl bg-[#16161a] border border-[#282832] shadow-xl py-1 z-30 flex flex-col divide-y divide-[#202026]">
              {[
                { id: "auto", label: "Auto (Default)" },
                { id: "low", label: "Low Effort" },
                { id: "medium", label: "Medium Effort" },
                { id: "high", label: "High Effort" },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    onReasoningEffortChange(opt.id as any);
                    setEffortDropdownOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs font-mono transition flex items-center justify-between cursor-pointer ${
                    reasoningEffort === opt.id
                      ? "bg-[#2b64e0]/15 text-[#60a5fa] font-medium"
                      : "text-[#d4d4d8] hover:bg-[#202026] hover:text-white"
                  }`}
                >
                  <span>{opt.label}</span>
                  {reasoningEffort === opt.id && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#2b64e0]" />
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-between sm:justify-start gap-3 pt-3 sm:pt-4">
        <span className="text-[#a1a1aa]" title="Stream tokens in real time as they are generated">Stream Response</span>
        <button
          type="button"
          onClick={() => onStreamChange(!stream)}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
            stream ? "bg-emerald-500" : "bg-[#282832]"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              stream ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      <div className="flex items-center justify-between sm:justify-start gap-3 pt-3 sm:pt-4">
        <span className="text-[#a1a1aa]" title="Bypass automatic failover and send requests strictly to the selected model">Direct Mode (No Failover)</span>
        <button
          type="button"
          onClick={() => onNoFailoverChange(!noFailover)}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
            noFailover ? "bg-amber-500" : "bg-[#282832]"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              noFailover ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
      </div>
    </div>
  );
}
