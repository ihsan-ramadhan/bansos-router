/**
 * OFB-style gate handling for the Zen upstream.
 *
 * This module is a TypeScript re-implementation of the *behaviour* documented
 * by opencode-free-bridge (MIT), not a copy of its JavaScript source:
 *
 *  - one ambiguous 403 ("free tier can only be used from within OpenCode")
 *    can mean a refused egress IP, a missing `read` tool, a wrong
 *    User-Agent, or a missing session header, so the gate is audited
 *    instead of blaming the network;
 *  - a second, unambiguous message ("detected abusive traffic") is an
 *    IP-level block and is terminal: no refresh, no session re-mint,
 *    no retry, because no client-side change can clear a flag keyed
 *    to the egress network;
 *  - on a shape rejection the daemon refreshes its identity, evicts
 *    the stale session, escalates to the full tool profile, and
 *    retries exactly once;
 *  - after a full-shape retry still fails, further forced refreshes
 *    and retries are suppressed for a cooldown window so the daemon
 *    does not amplify an IP penalty.
 *
 * Slice 2 (live identity derivation) lives here too, but deliberately
 * stops short of OFB's full Effect-Schema AST parser: version, commit
 * SHA and tool *names* are derived live from OpenCode's update API and
 * the GitHub plugin directory listing, while tool *schemas* fall back
 * to the exact read/shell definitions already in zen.ts and to generic
 * object schemas for the remaining tools. The gate's own evidence
 * (OFB's replay experiment) shows the tool *name* is the anchor; a
 * fabricated tool named `read` answers 200 while the real `read`
 * renamed answers 403.
 */

export type GateKind =
  | "ip-abuse"
  | "free-tier"
  | "upgrade-required"
  | "endpoint-moved"
  | "other";

export interface ZenGateRecipe {
  /** e.g. "latest/2.1.3/cli" (the part after "opencode/"). */
  version: string;
  /** Full User-Agent value, e.g. "opencode/latest/2.1.3/cli". */
  userAgent: string;
  /** Commit SHA from the update API, when available. */
  sourceRef: string | null;
  /** Tool names for the full profile, derived live when possible. */
  toolNames: string[];
  /** Where this recipe came from: live derivation or the pinned fallback. */
  source: "live" | "fallback" | "stale";
  fetchedAt: number;
}

/** Pinned fallback: the recipe bansos already shipped (kept, not invented). */
export const DEFAULT_GATE_VERSION = "latest/2.1.3/cli";
export const DEFAULT_GATE_USER_AGENT = `opencode/${DEFAULT_GATE_VERSION}`;

/**
 * Full tool profile, in OFB's order. read/shell get their exact schemas
 * from zen.ts; the rest are name anchors with a generic object schema.
 * The response-side tool filter in the daemon already drops any tool
 * call the caller did not declare, so these never leak to a harness.
 */
export const FULL_GATE_TOOL_NAMES = [
  "read",
  "shell",
  "edit",
  "write",
  "glob",
  "grep",
  "patch",
  "question",
  "skill",
  "subagent",
  "webfetch",
  "websearch",
  "execute",
] as const;

/** Gate anchors, pinned independently of whatever the recipe contains. */
export const GATE_ANCHOR_TOOL_NAMES = ["read"] as const;
export const GATE_ANCHOR_HEADER_NAMES = [
  "user-agent",
  "x-opencode-session",
  "x-session-affinity",
] as const;

/** Cooldown after a full-shape retry fails (OFB: GATE_RETRY_COOLDOWN_MS). */
export const GATE_RETRY_COOLDOWN_MS = 30_000;
/** Identity freshness (OFB: IDENTITY_TTL_MS). */
export const GATE_IDENTITY_TTL_MS = 15 * 60_000;

const UPDATE_API_BASE =
  process.env.OPENCODE_UPDATE_API_BASE ?? "https://opencode.ai/update/api";
const GITHUB_API = process.env.OPENCODE_GITHUB_API ?? "https://api.github.com";
const GITHUB_REPO = process.env.OPENCODE_REPO ?? "anomalyco/opencode";
const PLUGIN_DIR = "packages/core/src/tool/plugin";

const SEMVER_RE = /\d+\.\d+\.\d+/;

export function classifyGateError(status: number, message: string): GateKind {
  const msg = message ?? "";
  if (/detected abusive traffic|Detect Abuse Traffic/i.test(msg)) return "ip-abuse";
  if (status === 426 || /UpgradeRequired/i.test(msg)) return "upgrade-required";
  if (status === 404) return "endpoint-moved";
  // Message-first: bansos also surfaces gate failures as a 502 envelope
  // or a first-SSE-frame error, where the original 403 status is lost.
  if (/FreeTierError|free tier can only be used/i.test(msg)) return "free-tier";
  return "other";
}

/** Extract a minimum version from a 426 message, e.g. "minimum 2.1.0". */
export function parseVersionFloor(message: string): string | null {
  return SEMVER_RE.exec(message ?? "")?.[0] ?? null;
}

export interface GateAudit {
  shapeOk: boolean;
  missingTools: string[];
  missingHeaders: string[];
}

/** Audit an outbound request against the pinned gate anchors. */
export function auditGateShape(
  headers: Record<string, string>,
  toolNames: Iterable<string>,
): GateAudit {
  const lowered = new Map<string, string>();
  for (const [k, v] of Object.entries(headers)) lowered.set(k.toLowerCase(), v);
  const tools = new Set(toolNames);
  const missingTools = GATE_ANCHOR_TOOL_NAMES.filter((t) => !tools.has(t));
  const missingHeaders = GATE_ANCHOR_HEADER_NAMES.filter((h) => {
    const v = lowered.get(h);
    if (!v) return true;
    if (h === "user-agent") return !v.startsWith("opencode/");
    return false;
  });
  return {
    shapeOk: missingTools.length === 0 && missingHeaders.length === 0,
    missingTools,
    missingHeaders,
  };
}

export function toolNamesOf(body: Record<string, unknown>): string[] {
  if (!Array.isArray(body.tools)) return [];
  const names: string[] = [];
  for (const tool of body.tools as unknown[]) {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) continue;
    const t = tool as Record<string, unknown>;
    const fn =
      t.function && typeof t.function === "object" && !Array.isArray(t.function)
        ? (t.function as Record<string, unknown>)
        : null;
    const raw =
      typeof t.name === "string"
        ? t.name
        : typeof fn?.name === "string"
          ? fn.name
          : "";
    if (raw.trim()) names.push(raw.trim());
  }
  return names;
}

/**
 * Generic (name-anchor) tool definition for full-profile escalation.
 * Chat wire tools are nested under `function`; Responses wire tools
 * are flat. The exact read/shell schemas live in zen.ts and are added
 * there first, so this generic shape is only used for the other names.
 */
export function fullGateTool(
  name: string,
  shape: "chat" | "responses" = "chat",
): Record<string, unknown> {
  const inner = {
    name,
    description: `OpenCode ${name} tool (gate profile)`,
    parameters: { type: "object", properties: {} },
  };
  return shape === "chat" ? { type: "function", function: inner } : { type: "function", ...inner };
}

/**
 * Add every missing full-profile tool name to a body, without touching
 * tools the caller already declared. Returns true when anything was added.
 * The caller-side filter must still hide these on the way back; see
 * streamToChatResponse / the tool-bridge in the daemon.
 */
export function ensureFullGateTools(
  body: Record<string, unknown>,
  shape: "chat" | "responses" = "chat",
): boolean {
  if (!Array.isArray(body.tools)) body.tools = [];
  const present = new Set(toolNamesOf(body));
  let added = false;
  for (const name of FULL_GATE_TOOL_NAMES) {
    if (present.has(name)) continue;
    (body.tools as unknown[]).push(fullGateTool(name, shape));
    added = true;
  }
  return added;
}

/** Suppresses forced refreshes/retries after a failed full-shape retry. */
export class GateCooldown {
  private lastFailedFullShapeAt = 0;
  private lastFailedIdentity: string | null = null;

  recordFailedFullShape(identity: string): void {
    this.lastFailedFullShapeAt = Date.now();
    this.lastFailedIdentity = identity;
  }

  /** True when a retry on this identity would only amplify an IP penalty. */
  isCoolingDown(identity: string, now = Date.now()): boolean {
    return (
      this.lastFailedIdentity === identity &&
      now - this.lastFailedFullShapeAt < GATE_RETRY_COOLDOWN_MS
    );
  }

  resetForTests(): void {
    this.lastFailedFullShapeAt = 0;
    this.lastFailedIdentity = null;
  }
}

/** Process-wide gate cooldown (OFB keeps this per bridge, bansos per daemon). */
export const gateCooldown = new GateCooldown();

// ---------------------------------------------------------------------------
// Live identity derivation (slice 2)
// ---------------------------------------------------------------------------

type FetchFn = typeof fetch;

async function fetchJson(
  fetchFn: FetchFn,
  url: string,
  timeoutMs: number,
): Promise<unknown | null> {
  try {
    const res = await fetchFn(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

function defaultRecipe(): ZenGateRecipe {
  return {
    version: DEFAULT_GATE_VERSION,
    userAgent: DEFAULT_GATE_USER_AGENT,
    sourceRef: null,
    toolNames: [...FULL_GATE_TOOL_NAMES],
    source: "fallback",
    fetchedAt: Date.now(),
  };
}

let cachedRecipe: ZenGateRecipe | null = null;
let recipeInFlight: Promise<ZenGateRecipe> | null = null;

/** Synchronous read of the last known recipe (null before the first fetch). */
export function getCachedGateRecipe(): ZenGateRecipe | null {
  return cachedRecipe;
}

export function resetGateRecipeForTests(): void {
  cachedRecipe = null;
  recipeInFlight = null;
}

async function deriveToolNames(
  fetchFn: FetchFn,
  sha: string | null,
): Promise<string[] | null> {
  // GitHub contents listing for the plugin directory. The ref is the
  // update-API commit SHA when available; without it the listing would
  // track main and could disagree with the pinned CLI version, so skip.
  if (!sha) return null;
  const url =
    `${GITHUB_API}/repos/${GITHUB_REPO}/contents/${PLUGIN_DIR}` +
    `?ref=${encodeURIComponent(sha)}`;
  const data = await fetchJson(fetchFn, url, 8_000);
  if (!Array.isArray(data)) return null;
  const names: string[] = [];
  for (const entry of data as { name?: unknown; type?: unknown }[]) {
    if (entry?.type !== "file" || typeof entry.name !== "string") continue;
    if (!entry.name.endsWith(".ts")) continue;
    const name = entry.name.slice(0, -3);
    // Plugin files are named after their tool, except the codemode
    // dispatcher, which is a transport, not a wire tool.
    if (name === "codemode" || name === "index") continue;
    if (!/^[a-z][a-z0-9_-]*$/i.test(name)) continue;
    if (!names.includes(name)) names.push(name);
  }
  // The anchor must survive even a partial listing.
  if (!names.includes("read")) return null;
  return names;
}

/**
 * Resolve the live recipe. Never throws: on any failure the last good
 * recipe is returned marked "stale", and before the first success the
 * pinned fallback is returned. Concurrent callers share one fetch.
 */
export function refreshGateRecipe(fetchFn: FetchFn = fetch): Promise<ZenGateRecipe> {
  const now = Date.now();
  if (cachedRecipe && now - cachedRecipe.fetchedAt < GATE_IDENTITY_TTL_MS) {
    return Promise.resolve(cachedRecipe);
  }
  if (recipeInFlight) return recipeInFlight;
  recipeInFlight = (async () => {
    try {
      const channel = process.env.OPENCODE_CHANNEL ?? "latest";
      const updateUrl =
        `${UPDATE_API_BASE}/${encodeURIComponent(channel)}/cli/npm` +
        `?current=${encodeURIComponent("0.0.0")}`;
      const data = await fetchJson(fetchFn, updateUrl, 6_000);
      const version =
        data && typeof data === "object" && typeof (data as { version?: unknown }).version === "string"
          ? ((data as { version: string }).version as string)
          : null;
      if (!version || !SEMVER_RE.test(version)) throw new Error("update API returned no version");
      const github =
        data && typeof data === "object"
          ? ((data as { metadata?: { github?: { sha?: unknown } } }).metadata?.github ?? {})
          : {};
      const sha =
        typeof github.sha === "string" && /^[0-9a-f]{7,40}$/i.test(github.sha) ? github.sha : null;
      const toolNames = (await deriveToolNames(fetchFn, sha)) ?? [...FULL_GATE_TOOL_NAMES];
      const recipe: ZenGateRecipe = {
        // OFB's UA template is opencode/<channel>/<semver>/cli.
        version: `latest/${version}/cli`,
        userAgent: `opencode/latest/${version}/cli`,
        sourceRef: sha,
        toolNames,
        source: "live",
        fetchedAt: Date.now(),
      };
      cachedRecipe = recipe;
      return recipe;
    } catch {
      if (cachedRecipe) {
        cachedRecipe = { ...cachedRecipe, source: "stale", fetchedAt: Date.now() };
        return cachedRecipe;
      }
      cachedRecipe = defaultRecipe();
      return cachedRecipe;
    } finally {
      recipeInFlight = null;
    }
  })();
  return recipeInFlight;
}
