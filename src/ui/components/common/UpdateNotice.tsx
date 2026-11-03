import { useEffect, useRef, useState } from "preact/hooks";
import { Check, Copy } from "lucide-preact";

interface UpdateNoticeProps {
  current: string;
  latest: string;
}

const INSTALL = "npm i -g bansos-router";
// the dashboard's Restart reloads config in the same process, so new code needs a fresh one
const RESTART = "bansos restart";

function CommandRow({ step, command }: { step: string; command: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setState("copied");
    } catch {
      setState("failed");
    }
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <div className="space-y-1">
      <p className="text-[11px] text-[#a1a1aa]">{step}</p>
      <div className="flex items-center gap-2 rounded-lg bg-[#121215] border border-[#262630] pl-3 pr-1">
        <code className="flex-1 min-w-0 font-mono text-xs text-[#e4e4e7] py-2 select-all">
          {/* wrap only between words, so a flag like --bg never splits at its hyphen */}
          {command.split(" ").map((word, i) => (
            <span key={i} className="whitespace-nowrap">
              {i > 0 ? " " : ""}
              {word}
            </span>
          ))}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${command}`}
          className="inline-flex items-center justify-center gap-1 rounded-md px-2 min-h-11 sm:min-h-8 text-[11px] font-medium text-[#d4d4d8] hover:text-white hover:bg-[#202028] cursor-pointer shrink-0"
        >
          {state === "copied" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Select it" : "Copy"}</span>
        </button>
      </div>
    </div>
  );
}

export function UpdateNotice({ current, latest }: UpdateNoticeProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls="update-panel"
        onClick={() => setOpen((v) => !v)}
        className="group inline-flex items-center min-h-11 sm:min-h-0 cursor-pointer"
      >
        <span className="text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30 group-hover:bg-amber-500/20 font-medium whitespace-nowrap">
          <span className="sm:hidden">Update</span>
          <span className="hidden sm:inline">{latest} available</span>
        </span>
      </button>

      {open && (
        <div
          ref={panelRef}
          id="update-panel"
          role="dialog"
          aria-label={`bansos-router ${latest} is available`}
          className="fixed left-3 right-3 top-15 sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-2 sm:w-96 z-50 rounded-xl bg-[#16161a] border border-[#282832] shadow-2xl p-4 space-y-3"
        >
          <div className="space-y-1">
            <p className="text-sm font-semibold text-white">bansos-router {latest} is out</p>
            <p className="text-xs text-[#a1a1aa]">
              This daemon runs {current}. Install the update, then restart the daemon so it loads the new version.
            </p>
          </div>
          <CommandRow step="1. Install" command={INSTALL} />
          <CommandRow step="2. Restart" command={RESTART} />
          <a
            href={`https://github.com/ihsan-ramadhan/bansos-router/releases/tag/v${latest}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-xs text-[#7cb4fb] underline underline-offset-2 hover:text-[#a5ccfc]"
          >
            What's new in {latest}
          </a>
        </div>
      )}
    </div>
  );
}
