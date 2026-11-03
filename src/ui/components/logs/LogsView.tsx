import { useEffect, useRef, useState } from "preact/hooks";
import { ScrollText, Pause, Play, Copy, Check, Loader2 } from "lucide-preact";
import { fetchLogs } from "../../services/api";

const LINE_CHOICES = [100, 200, 500, 1000];
const POLL_MS = 2000;

function lineClass(line: string): string {
  if (line.startsWith("✗")) return "text-rose-300";
  if (line.startsWith("⚠")) return "text-amber-200";
  if (line.startsWith("·")) return "text-[#71717a]";
  return "text-[#d4d4d8]";
}

export function LogsView({ active }: { active: boolean }) {
  const [lines, setLines] = useState<string[]>([]);
  const [path, setPath] = useState("");
  const [count, setCount] = useState(200);
  const [filter, setFilter] = useState("");
  const [following, setFollowing] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLPreElement>(null);
  const stickToBottom = useRef(true);

  async function load() {
    try {
      const res = await fetchLogs(count);
      setLines(res.lines);
      setPath(res.path);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load logs");
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    if (!active) return;
    void load();
    if (!following) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [active, following, count]);

  useEffect(() => {
    const el = box.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [lines, filter]);

  const needle = filter.trim().toLowerCase();
  const shown = needle ? lines.filter((l) => l.toLowerCase().includes(needle)) : lines;

  async function copy() {
    try {
      await navigator.clipboard.writeText(shown.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex-1 min-h-0 rounded-xl border border-[#1c1f2b] bg-[#10121a] p-3.5 sm:p-4 shadow-xs flex flex-col space-y-3">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 shrink-0">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">Daemon log</h2>
          </div>
          <p className="text-xs text-[#9393a0] break-all">
            Same output as <code className="font-mono">bansos logs</code>
            {path && <> · <code className="font-mono text-[#a1a1aa]">{path}</code></>}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={filter}
            placeholder="Filter, e.g. rejected"
            aria-label="Filter log lines"
            onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
            className="min-h-9 w-full sm:w-48 bg-[#0c0e14] border border-[#1c1f2b] rounded-md px-3 text-xs text-white placeholder:text-[#5f5f6b]"
          />
          <select
            value={count}
            aria-label="Number of lines"
            onChange={(e) => setCount(Number((e.target as HTMLSelectElement).value))}
            className="min-h-9 bg-[#0c0e14] border border-[#1c1f2b] rounded-md px-2 text-xs text-white cursor-pointer"
          >
            {LINE_CHOICES.map((n) => (
              <option key={n} value={n}>Last {n} lines</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setFollowing(!following)}
            aria-pressed={following}
            className="inline-flex items-center gap-1.5 px-3 min-h-9 rounded-md bg-[#131620] hover:bg-[#1a1e2b] border border-[#1c1f2b] text-xs font-medium text-[#d4d4d8] hover:text-white cursor-pointer"
          >
            {following ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            <span>{following ? "Pause" : "Follow"}</span>
          </button>
          <button
            type="button"
            onClick={() => void copy()}
            disabled={shown.length === 0}
            className="inline-flex items-center gap-1.5 px-3 min-h-9 rounded-md bg-[#131620] hover:bg-[#1a1e2b] border border-[#1c1f2b] text-xs font-medium text-[#d4d4d8] hover:text-white cursor-pointer disabled:opacity-40"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-rose-300">{error}</p>}

      <pre
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget as HTMLPreElement;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="flex-1 min-h-0 overflow-auto rounded-lg bg-[#0c0e14] border border-[#1c1f2b] p-3 text-[11.5px] leading-relaxed font-mono whitespace-pre-wrap break-all"
      >
        {!loaded ? (
          <span className="inline-flex items-center gap-2 text-[#a1a1aa]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading</span>
        ) : shown.length === 0 ? (
          <span className="text-[#a1a1aa]">{needle ? "No lines match the filter." : "The daemon log is empty. Streaming logs will appear as requests arrive."}</span>
        ) : (
          shown.map((line, i) => (
            <div key={i} className={lineClass(line)}>{line || " "}</div>
          ))
        )}
      </pre>
    </div>
  );
}
