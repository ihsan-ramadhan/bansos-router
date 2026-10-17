export interface TranslatedCall {
  name: string;
  arguments: string;
}

export type Translator = (args: string, callId?: string) => TranslatedCall | null;

export interface CallerTools {
  has(name: string): boolean;
  bridge?(name: string): Translator | null;
}

const BRIDGED_LIMIT = 2000;
const bridgedCalls = new Map<string, TranslatedCall>();

function remember(callId: string, original: TranslatedCall): void {
  bridgedCalls.set(callId, original);
  if (bridgedCalls.size > BRIDGED_LIMIT) bridgedCalls.delete(bridgedCalls.keys().next().value!);
}

// on the way back to the injecting upstream, a bridged call is shown to the model as the call it actually made
export function restoreBridgedCalls(messages: unknown): unknown {
  if (!Array.isArray(messages) || bridgedCalls.size === 0) return messages;
  return messages.map((m: any) => {
    if (m?.role !== "assistant" || !Array.isArray(m.tool_calls)) return m;
    if (!m.tool_calls.some((tc: any) => bridgedCalls.has(tc?.id))) return m;
    return {
      ...m,
      tool_calls: m.tool_calls.map((tc: any) => {
        const original = bridgedCalls.get(tc?.id);
        return original ? { ...tc, function: { ...tc.function, ...original } } : tc;
      }),
    };
  });
}

type Schema = { properties?: Record<string, { type?: unknown }>; required?: unknown };
type Spec = { name: string; parameters: Schema };

const SHELL_NAMES = ["bash", "shell", "exec_command", "run_command", "execute_command", "run_shell_command", "run_terminal_cmd", "terminal", "exec", "sh"];
const READ_NAMES = ["read", "read_file", "readfile", "view", "view_file", "open_file", "file_read", "read_text_file", "cat"];

const COMMAND_KEYS = ["command", "cmd", "script", "commandLine", "command_line"];
const WORKDIR_KEYS = ["workdir", "cwd", "working_directory", "workingDirectory", "directory", "dir"];
const TIMEOUT_KEYS = ["timeout", "timeout_ms", "timeoutMs"];
const BACKGROUND_KEYS = ["run_in_background", "background"];
const PATH_KEYS = ["path", "file_path", "filePath", "file", "filename", "target_file", "absolute_path"];
const OFFSET_KEYS = ["offset", "start_line", "line_start"];
const LIMIT_KEYS = ["limit", "max_lines", "line_count"];
const INTENT_KEYS = ["i", "intent", "description", "reason", "summary"];

function toolSpecs(body: unknown): Spec[] {
  const tools = (body as Record<string, unknown> | null)?.tools;
  if (!Array.isArray(tools)) return [];
  return tools
    .map((t: any) => ({
      name: t?.function?.name ?? t?.name,
      parameters: (t?.function?.parameters ?? t?.parameters ?? t?.input_schema ?? {}) as Schema,
    }))
    .filter((s): s is Spec => typeof s.name === "string");
}

function pick(schema: Schema, keys: string[]): string | undefined {
  const props = schema.properties ?? {};
  return keys.find((k) => k in props);
}

function fillIntent(schema: Schema, out: Record<string, unknown>, text: string): void {
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const k of INTENT_KEYS) {
    if (required.includes(k) && !(k in out) && schema.properties?.[k]?.type === "string") out[k] = text;
  }
}

function requiredMet(schema: Schema, out: Record<string, unknown>): boolean {
  const required = Array.isArray(schema.required) ? schema.required : [];
  return required.every((k) => typeof k === "string" && k in out);
}

function findTool(specs: Spec[], names: string[], keys: string[]): Spec | undefined {
  for (const n of names) {
    const hit = specs.find((s) => s.name.toLowerCase() === n && pick(s.parameters, keys));
    if (hit) return hit;
  }
  return undefined;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function shellCall(target: Spec, args: Record<string, unknown>): TranslatedCall | null {
  const command = args.command;
  const cmdKey = pick(target.parameters, COMMAND_KEYS);
  if (typeof command !== "string" || !command || !cmdKey) return null;
  const out: Record<string, unknown> = {};
  out[cmdKey] = target.parameters.properties?.[cmdKey]?.type === "array" ? ["bash", "-lc", command] : command;
  const wd = pick(target.parameters, WORKDIR_KEYS);
  if (wd && typeof args.workdir === "string") out[wd] = args.workdir;
  const tk = pick(target.parameters, TIMEOUT_KEYS);
  if (tk && typeof args.timeout === "number" && args.timeout > 0) out[tk] = args.timeout;
  const bg = pick(target.parameters, BACKGROUND_KEYS);
  if (bg && args.background === true) out[bg] = true;
  fillIntent(target.parameters, out, `Run ${command.length > 60 ? `${command.slice(0, 57)}...` : command}`);
  return requiredMet(target.parameters, out) ? { name: target.name, arguments: JSON.stringify(out) } : null;
}

function readCall(target: Spec, args: Record<string, unknown>): TranslatedCall | null {
  const pathKey = pick(target.parameters, PATH_KEYS);
  if (typeof args.path !== "string" || !args.path || !pathKey) return null;
  const out: Record<string, unknown> = { [pathKey]: args.path };
  const ok = pick(target.parameters, OFFSET_KEYS);
  if (ok && typeof args.offset === "number") out[ok] = args.offset;
  const lk = pick(target.parameters, LIMIT_KEYS);
  if (lk && typeof args.limit === "number") out[lk] = args.limit;
  fillIntent(target.parameters, out, `Read ${args.path}`);
  return requiredMet(target.parameters, out) ? { name: target.name, arguments: JSON.stringify(out) } : null;
}

function readAsShell(args: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof args.path !== "string" || !args.path) return null;
  const file = shellQuote(args.path);
  const offset = typeof args.offset === "number" && args.offset > 0 ? Math.floor(args.offset) : 1;
  const limit = typeof args.limit === "number" && args.limit > 0 ? Math.floor(args.limit) : 2000;
  return { command: `sed -n '${offset},${offset + limit - 1}p' -- ${file}` };
}

function parseArgs(raw: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// the Zen gate injects read/shell; a call to one the caller never declared is mapped onto the caller's own tool
export function callerToolsFromBody(body: unknown): CallerTools {
  const specs = toolSpecs(body);
  const names = new Set(specs.map((s) => s.name));
  const shellTarget = findTool(specs, SHELL_NAMES, COMMAND_KEYS);
  const readTarget = findTool(specs, READ_NAMES, PATH_KEYS);
  const recording = (name: string, inner: (raw: string) => TranslatedCall | null): Translator => (raw, callId) => {
    const call = inner(raw);
    if (call && callId) remember(callId, { name, arguments: raw || "{}" });
    return call;
  };
  return {
    has: (name) => names.has(name),
    bridge(name) {
      const inner = innerBridge(name);
      return inner ? recording(name, inner) : null;
    },
  };

  function innerBridge(name: string): ((raw: string) => TranslatedCall | null) | null {
    if (names.has(name)) return null;
    if (name === "shell" && shellTarget) {
      return (raw) => {
        const args = parseArgs(raw);
        return args ? shellCall(shellTarget, args) : null;
      };
    }
    if (name === "read" && (readTarget || shellTarget)) {
      return (raw) => {
        const args = parseArgs(raw);
        if (!args) return null;
        if (readTarget) return readCall(readTarget, args);
        const asShell = readAsShell(args);
        return asShell ? shellCall(shellTarget!, asShell) : null;
      };
    }
    return null;
  }
}
