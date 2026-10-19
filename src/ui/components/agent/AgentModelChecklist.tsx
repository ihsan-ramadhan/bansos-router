import { useEffect, useRef } from "preact/hooks";
import { Check, Minus, Search } from "lucide-preact";
import type { ModelItem, ModelPick } from "../../types";
import { getProviderDotColor, groupModelsByProvider, pickFromChecked, pickedModels } from "../../utils/agent";

interface AgentModelChecklistProps {
  models: ModelItem[];
  checked: ModelPick | null;
  onChange: (next: ModelPick | null) => void;
  onClose: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

// same box as the provider picker in Settings; the transparent native input underneath keeps keyboard and screen readers
function Checkbox({ state, onToggle, label }: { state: "all" | "some" | "none"; onToggle: () => void; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  const on = state !== "none";
  return (
    <span className="relative inline-flex h-4 w-4 shrink-0">
      <input
        ref={ref}
        type="checkbox"
        aria-label={label}
        checked={state === "all"}
        onChange={onToggle}
        className="peer absolute inset-0 m-0 h-4 w-4 cursor-pointer opacity-0"
      />
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-flex h-4 w-4 items-center justify-center rounded border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[#60a5fa] peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-[#16161a] ${
          on ? "bg-[#2b64e0] border-[#2b64e0]" : "bg-[#121215] border-[#71717a] group-hover:border-[#a1a1aa]"
        }`}
      >
        {state === "all" && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
        {state === "some" && <Minus className="h-3 w-3 text-white" strokeWidth={3} />}
      </span>
    </span>
  );
}

export function AgentModelChecklist({ models, checked, onChange, onClose, searchQuery, onSearchChange }: AgentModelChecklistProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => searchRef.current?.focus(), []);
  const query = searchQuery.trim().toLowerCase();
  const visible = query
    ? models.filter((m) => m.id.toLowerCase().includes(query) || m.name?.toLowerCase().includes(query))
    : models;
  const groups = groupModelsByProvider(visible);
  const set = new Set((checked ? pickedModels(models, checked) : models).map((m) => m.id));
  const total = models.length;
  const picked = models.filter((m) => set.has(m.id)).length;

  // stored as whole upstreams plus ids, so models a catalog refresh adds to a checked upstream stay checked
  function commit(next: Set<string>) {
    onChange(models.every((m) => next.has(m.id)) ? null : pickFromChecked(models, [...next]));
  }

  function toggleMany(ids: string[]) {
    const next = new Set(set);
    const allOn = ids.every((id) => next.has(id));
    for (const id of ids) {
      if (allOn) next.delete(id);
      else next.add(id);
    }
    commit(next);
  }

  const stateOf = (ids: string[]) => {
    const on = ids.filter((id) => set.has(id)).length;
    return on === 0 ? "none" : on === ids.length ? "all" : "some";
  };

  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close model list"
        className="fixed inset-0 z-20 cursor-default bg-transparent border-0"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="Models to add"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
        className="absolute left-0 right-0 top-full mt-1.5 rounded-xl bg-[#16161a] border border-[#282832] shadow-2xl p-2 z-30 space-y-2 max-h-[min(26rem,70vh)] flex flex-col"
      >
        <div className="relative shrink-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#9393a0]" aria-hidden="true" />
          <input
            type="text"
            ref={searchRef}
            value={searchQuery}
            aria-label="Search models"
            onInput={(e) => onSearchChange((e.target as HTMLInputElement).value)}
            placeholder="Search model..."
            className="w-full pl-8 pr-3 py-1.5 bg-[#121215] border border-[#262630] rounded-lg text-xs text-white placeholder-[#8b8b96] focus:outline-none focus:border-[#2b64e0]"
          />
        </div>

        <div className="overflow-y-auto overflow-x-hidden pr-1 flex-1 min-h-0 space-y-1.5">
          {total === 0 ? (
            <p className="px-2.5 py-6 text-center text-xs text-[#9393a0]">
              No models loaded yet. Start the daemon or refresh the catalog, then come back here.
            </p>
          ) : groups.length === 0 ? (
            <p className="px-2.5 py-6 text-center text-xs text-[#9393a0]">No models match "{searchQuery}".</p>
          ) : (
            <>
              {!query && (
                <label className="group flex items-center gap-2.5 px-2.5 min-h-11 sm:min-h-8 rounded-lg text-xs font-semibold text-white hover:bg-[#202028] cursor-pointer">
                  <Checkbox state={stateOf(models.map((m) => m.id))} onToggle={() => toggleMany(models.map((m) => m.id))} label="All models" />
                  <span className="flex-1">All models</span>
                  <span className="font-mono text-[10px] text-[#9393a0]">{total}</span>
                </label>
              )}
              {groups.map((group) => {
                const ids = group.models.map((m) => m.id);
                return (
                  <fieldset key={group.provider} className="min-w-0 space-y-0.5">
                    <legend className="sr-only">{group.label}</legend>
                    <label className="group flex items-center gap-2.5 px-2.5 min-h-11 sm:min-h-8 rounded-lg text-[10px] font-semibold tracking-wider uppercase text-[#8b8b96] hover:bg-[#202028] hover:text-[#d4d4d8] cursor-pointer select-none">
                      <Checkbox state={stateOf(ids)} onToggle={() => toggleMany(ids)} label={`Every ${group.label} model${query ? " shown" : ""}`} />
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${getProviderDotColor(group.provider)}`} aria-hidden="true" />
                      <span className="flex-1">{group.label}</span>
                      <span className="font-mono text-[10px] tracking-normal text-[#9393a0]">
                        {ids.filter((id) => set.has(id)).length}/{ids.length}
                      </span>
                    </label>
                    {group.models.map((m) => (
                      <label
                        key={m.id}
                        className="group flex items-center gap-2.5 pl-6 pr-2.5 min-h-11 sm:min-h-8 rounded-lg text-xs text-[#d4d4d8] hover:bg-[#202028] hover:text-white cursor-pointer"
                      >
                        <Checkbox state={set.has(m.id) ? "all" : "none"} onToggle={() => toggleMany([m.id])} />
                        <span className="font-mono truncate flex-1 min-w-0">{m.id}</span>
                        {m.reasoning && (
                          <span className="text-[10px] px-1.5 rounded bg-emerald-950/60 text-emerald-400 shrink-0">Think</span>
                        )}
                      </label>
                    ))}
                  </fieldset>
                );
              })}
            </>
          )}
        </div>

        <div className="shrink-0 flex items-center justify-between gap-2 border-t border-[#23232a] pt-2 pl-2.5">
          <span className="text-[11px] font-mono text-[#9393a0]" aria-live="polite">
            {picked === total ? `All ${total} models` : `${picked} of ${total} models`}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 min-h-11 sm:min-h-8 rounded-md bg-[#202026] hover:bg-[#282832] border border-[#2e2e38] text-xs font-medium text-[#d4d4d8] hover:text-white cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </>
  );
}
