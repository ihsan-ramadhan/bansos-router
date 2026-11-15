import fs from "node:fs";
import path from "node:path";
import { BANSOS_DIR, ensureBansosDir, writeJsonAtomic } from "./state";

export type ActivityKind = "chat" | "responses" | "anthropic";
export type ActivityStatus = "ok" | "error";

export interface ActivityEvent {
  id: number;
  timestamp: number;
  kind: ActivityKind;
  model: string;
  requestedModel: string;
  upstream: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  durationMs: number;
  status: ActivityStatus;
  statusCode?: number;
  failoverFrom?: string;
  client?: string;
}

export interface ModelActivity {
  requests: number;
  ok: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export interface UsageStats {
  totalRequests: number;
  okRequests: number;
  errorRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  failoverCount: number;
  avgDurationMs: number;
  perModel: Record<string, ModelActivity>;
  perUpstream: Record<string, { requests: number; ok: number }>;
}

export interface InFlightRequest {
  id: number;
  timestamp: number;
  client: string;
  model: string;
  requestedModel: string;
  upstream: string;
}

export type TimeWindow = "today" | "7d" | "30d" | "60d" | "all";
export interface ActivityInput {
  kind: ActivityKind;
  model: string;
  requestedModel: string;
  upstream: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  durationMs: number;
  status: ActivityStatus;
  statusCode?: number;
  failoverFrom?: string;
  client?: string;
}

// events stay in append-only month files; usage is per-month day rollups
export const ACTIVITY_DIR = path.join(BANSOS_DIR, "activity");
const LEGACY_ACTIVITY_FILE = path.join(BANSOS_DIR, "activity.json");
const RECENT_CAP = 2000;
const READ_CHUNK = 64 * 1024;
const ROLLUP_SAVE_MS = 5000;

interface DayBucket {
  requests: number;
  ok: number;
  error: number;
  failover: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  durationMs: number;
  perModel: Record<string, ModelActivity>;
  perUpstream: Record<string, { requests: number; ok: number }>;
}

interface MonthRollup {
  version: 1;
  days: Record<string, DayBucket>;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function monthKeyOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function dayKeyOf(ts: number): string {
  const d = new Date(ts);
  return `${monthKeyOf(ts)}-${pad(d.getDate())}`;
}

function dayStartOf(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function eventsFileOf(month: string): string {
  return path.join(ACTIVITY_DIR, `events-${month}.jsonl`);
}

function rollupFileOf(month: string): string {
  return path.join(ACTIVITY_DIR, `usage-${month}.json`);
}

function emptyBucket(): DayBucket {
  return {
    requests: 0,
    ok: 0,
    error: 0,
    failover: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    durationMs: 0,
    perModel: {},
    perUpstream: {},
  };
}

function listFiles(prefix: string, suffix: string): string[] {
  try {
    return fs
      .readdirSync(ACTIVITY_DIR)
      .filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
      .sort()
      .map((name) => path.join(ACTIVITY_DIR, name));
  } catch {
    return [];
  }
}

function parseEventLine(line: string): ActivityEvent | null {
  if (!line) return null;
  try {
    const e = JSON.parse(line) as ActivityEvent;
    if (!e || typeof e !== "object" || typeof e.timestamp !== "number") return null;
    if (typeof e.model !== "string" || typeof e.upstream !== "string") return null;
    if (e.status !== "ok" && e.status !== "error") return null;
    return e;
  } catch {
    return null;
  }
}

// newest-first, so an old query never reads a whole month file
function* reverseLines(file: string, chunkSize = READ_CHUNK): Generator<string> {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return;
  }
  try {
    const size = fs.fstatSync(fd).size;
    let pos = size;
    let carry = "";
    const buf = Buffer.allocUnsafe(chunkSize);
    while (pos > 0) {
      const read = Math.min(chunkSize, pos);
      pos -= read;
      const bytes = fs.readSync(fd, buf, 0, read, pos);
      const text = carry + buf.toString("utf8", 0, bytes);
      const lines = text.split("\n");
      carry = lines.shift() ?? "";
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i]) yield lines[i]!;
      }
    }
    if (carry) yield carry;
  } finally {
    fs.closeSync(fd);
  }
}

function readMonthEvents(file: string): ActivityEvent[] {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: ActivityEvent[] = [];
  for (const line of text.split("\n")) {
    const event = parseEventLine(line);
    if (event) out.push(event);
  }
  return out;
}

function windowStart(window: TimeWindow, now = Date.now()): number {
  if (window === "all") return 0;
  if (window === "today") return dayStartOf(now);
  const days = window === "7d" ? 7 : window === "30d" ? 30 : 60;
  return dayStartOf(now - (days - 1) * 24 * 60 * 60 * 1000);
}

export class ActivityStore {
  private recent: ActivityEvent[] = [];
  private days = new Map<string, DayBucket>();
  private dirtyMonths = new Set<string>();
  private inFlight = new Map<number, InFlightRequest>();
  private nextId = 1;
  private nextInFlightId = 1;
  private rollupTimer: NodeJS.Timeout | null = null;
  private appendChain: Promise<void> = Promise.resolve();

  constructor() {
    ensureBansosDir();
    this.loadRollups();
    this.migrateLegacyFile();
    this.loadRecent();
  }

  private loadRollups(): void {
    for (const file of listFiles("usage-", ".json")) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as MonthRollup;
        if (!parsed || typeof parsed !== "object" || typeof parsed.days !== "object") continue;
        for (const [day, bucket] of Object.entries(parsed.days)) {
          if (bucket && typeof bucket === "object") this.days.set(day, this.normalizeBucket(bucket));
        }
      } catch {
        // a corrupt rollup only costs the fast path, never the events
      }
    }
  }

  private normalizeBucket(raw: Partial<DayBucket>): DayBucket {
    const bucket = emptyBucket();
    for (const key of ["requests", "ok", "error", "failover", "inputTokens", "outputTokens", "cachedTokens", "durationMs"] as const) {
      const value = raw[key];
      if (typeof value === "number" && Number.isFinite(value)) bucket[key] = value;
    }
    if (raw.perModel && typeof raw.perModel === "object") {
      for (const [model, stats] of Object.entries(raw.perModel)) {
        if (!stats || typeof stats !== "object") continue;
        bucket.perModel[model] = {
          requests: Number(stats.requests) || 0,
          ok: Number(stats.ok) || 0,
          inputTokens: Number(stats.inputTokens) || 0,
          outputTokens: Number(stats.outputTokens) || 0,
          cachedTokens: Number(stats.cachedTokens) || 0,
        };
      }
    }
    if (raw.perUpstream && typeof raw.perUpstream === "object") {
      for (const [upstream, stats] of Object.entries(raw.perUpstream)) {
        if (!stats || typeof stats !== "object") continue;
        bucket.perUpstream[upstream] = { requests: Number(stats.requests) || 0, ok: Number(stats.ok) || 0 };
      }
    }
    return bucket;
  }

  private migrateLegacyFile(): void {
    if (!fs.existsSync(LEGACY_ACTIVITY_FILE)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(LEGACY_ACTIVITY_FILE, "utf8")) as { events?: unknown };
      if (Array.isArray(raw?.events)) this.importEvents(raw.events as ActivityEvent[], false);
      fs.renameSync(LEGACY_ACTIVITY_FILE, `${LEGACY_ACTIVITY_FILE}.migrated`);
    } catch {
      // a corrupt old file is left in place for a manual look
    }
  }

  private loadRecent(): void {
    const tail = this.readFromDisk(RECENT_CAP, 0, Number.POSITIVE_INFINITY).reverse();
    this.recent = tail;
    if (tail.length > 0) this.nextId = Math.max(this.nextId, tail[tail.length - 1]!.id + 1);
  }

  private append(event: ActivityEvent): void {
    const line = `${JSON.stringify(event)}\n`;
    const file = eventsFileOf(monthKeyOf(event.timestamp));
    this.appendChain = this.appendChain
      .then(() => fs.promises.mkdir(ACTIVITY_DIR, { recursive: true }))
      .then(() => fs.promises.appendFile(file, line, { mode: 0o600 }))
      .catch(() => {
        // the rollup already has the event; a failed append only loses history detail
      });
  }

  private addToRollup(event: ActivityEvent): void {
    const day = dayKeyOf(event.timestamp);
    const bucket = this.days.get(day) ?? emptyBucket();
    bucket.requests++;
    if (event.status === "ok") bucket.ok++;
    else bucket.error++;
    if (event.failoverFrom) bucket.failover++;
    const input = event.inputTokens || 0;
    const output = event.outputTokens || 0;
    const cached = event.cachedTokens || 0;
    bucket.inputTokens += input;
    bucket.outputTokens += output;
    bucket.cachedTokens += cached;
    bucket.durationMs += event.durationMs || 0;

    const model = bucket.perModel[event.model] ?? {
      requests: 0,
      ok: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
    };
    model.requests++;
    if (event.status === "ok") model.ok++;
    model.inputTokens += input;
    model.outputTokens += output;
    model.cachedTokens += cached;
    bucket.perModel[event.model] = model;

    const upstream = bucket.perUpstream[event.upstream] ?? { requests: 0, ok: 0 };
    upstream.requests++;
    if (event.status === "ok") upstream.ok++;
    bucket.perUpstream[event.upstream] = upstream;

    this.days.set(day, bucket);
    this.dirtyMonths.add(monthKeyOf(event.timestamp));
  }

  private scheduleRollupSave(): void {
    if (this.rollupTimer) return;
    this.rollupTimer = setTimeout(() => {
      this.rollupTimer = null;
      this.saveRollups();
    }, ROLLUP_SAVE_MS);
    this.rollupTimer.unref?.();
  }

  private saveRollups(): void {
    if (this.dirtyMonths.size === 0) return;
    const months = [...this.dirtyMonths];
    this.dirtyMonths.clear();
    for (const month of months) {
      const days: Record<string, DayBucket> = {};
      for (const [day, bucket] of this.days) {
        if (day.startsWith(month)) days[day] = bucket;
      }
      try {
        writeJsonAtomic(rollupFileOf(month), { version: 1, days } satisfies MonthRollup);
      } catch {
        this.dirtyMonths.add(month);
      }
    }
  }

  /** write pending rollups now; called on shutdown so counters survive a signal */
  flush(): void {
    if (this.rollupTimer) {
      clearTimeout(this.rollupTimer);
      this.rollupTimer = null;
    }
    this.saveRollups();
  }

  /** resolves once every queued event append has hit the disk (tests and shutdown paths) */
  whenIdle(): Promise<void> {
    return this.appendChain;
  }

  record(input: ActivityInput): void {
    const now = Date.now();
    // the store owns the id: a caller-supplied one would collide with the sequence
    const event: ActivityEvent = { ...input, id: this.nextId++, timestamp: now };
    this.recent.push(event);
    if (this.recent.length > RECENT_CAP) this.recent.splice(0, this.recent.length - RECENT_CAP);
    this.addToRollup(event);
    this.append(event);
    this.scheduleRollupSave();
  }

  private readFromDisk(limit: number, start: number, belowId: number): ActivityEvent[] {
    const out: ActivityEvent[] = [];
    if (limit <= 0) return out;
    const months = listFiles("events-", ".jsonl").reverse();
    for (const file of months) {
      for (const line of reverseLines(file)) {
        const event = parseEventLine(line);
        if (!event) continue;
        if (event.id >= belowId) continue;
        if (event.timestamp < start) return out;
        out.push(event);
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  getEvents(limit = 100, window: TimeWindow = "all"): ActivityEvent[] {
    const start = windowStart(window);
    const capped = Math.max(0, limit);
    if (capped === 0) return [];
    const local = this.recent.filter((e) => e.timestamp >= start);
    if (local.length >= capped || this.recent.length < RECENT_CAP) {
      return local.slice(-capped).reverse();
    }
    // the window reaches past the ring: fill the rest from the month files
    const oldest = this.recent[0]!;
    const rest = this.readFromDisk(capped - local.length, start, oldest.id);
    return [...rest, ...local.slice(-capped).reverse()];
  }

  getAllEvents(): ActivityEvent[] {
    const months = listFiles("events-", ".jsonl");
    const all: ActivityEvent[] = [];
    for (const file of months) all.push(...readMonthEvents(file));
    all.sort((a, b) => a.id - b.id);
    return all;
  }

  startRequest(input: Omit<InFlightRequest, "id">): number {
    const id = this.nextInFlightId++;
    this.inFlight.set(id, { id, ...input });
    return id;
  }

  endRequest(id: number): void {
    this.inFlight.delete(id);
  }

  getInFlight(): InFlightRequest[] {
    const now = Date.now();
    for (const [id, req] of this.inFlight.entries()) {
      if (now - req.timestamp > 120_000) this.inFlight.delete(id);
    }
    return Array.from(this.inFlight.values());
  }

  clear(): void {
    if (this.rollupTimer) {
      clearTimeout(this.rollupTimer);
      this.rollupTimer = null;
    }
    this.recent = [];
    this.days.clear();
    this.dirtyMonths.clear();
    this.nextId = 1;
    try {
      fs.rmSync(ACTIVITY_DIR, { recursive: true, force: true });
    } catch {
      // nothing on disk yet
    }
    ensureBansosDir();
  }

  importEvents(incoming: ActivityEvent[], replace = false): number {
    if (!Array.isArray(incoming)) return 0;
    const valid = incoming.filter(
      (e) =>
        e &&
        typeof e === "object" &&
        typeof e.timestamp === "number" &&
        typeof e.model === "string" &&
        typeof e.upstream === "string" &&
        (e.status === "ok" || e.status === "error"),
    );
    if (replace) this.clear();
    // ids are the stable key: a merge twice from the same backup changes nothing
    const seen = new Set<number>(this.getAllEvents().map((e) => e.id));
    const byMonth = new Map<string, string[]>();
    const accepted: ActivityEvent[] = [];
    for (const event of valid) {
      const id = typeof event.id === "number" ? event.id : this.nextId++;
      if (seen.has(id)) continue;
      seen.add(id);
      const materialized: ActivityEvent = {
        ...event,
        id,
        inputTokens: Number(event.inputTokens) || 0,
        outputTokens: Number(event.outputTokens) || 0,
        durationMs: Number(event.durationMs) || 0,
        cachedTokens: Number(event.cachedTokens) || undefined,
      };
      accepted.push(materialized);
      const month = monthKeyOf(materialized.timestamp);
      byMonth.set(month, [...(byMonth.get(month) ?? []), `${JSON.stringify(materialized)}\n`]);
      this.addToRollup(materialized);
      if (materialized.id >= this.nextId) this.nextId = materialized.id + 1;
    }
    for (const [month, lines] of byMonth) {
      try {
        fs.mkdirSync(ACTIVITY_DIR, { recursive: true });
        fs.appendFileSync(eventsFileOf(month), lines.join(""), { mode: 0o600 });
      } catch {
        // keep the in-memory view working when the disk write fails
      }
    }
    if (accepted.length > 0) {
      this.recent = [...this.recent, ...accepted].sort((a, b) => a.id - b.id);
      if (this.recent.length > RECENT_CAP) this.recent = this.recent.slice(-RECENT_CAP);
      this.flush();
    }
    return accepted.length;
  }

  getUsage(window: TimeWindow = "all"): UsageStats {
    const start = windowStart(window);
    const stats: UsageStats = {
      totalRequests: 0,
      okRequests: 0,
      errorRequests: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedTokens: 0,
      failoverCount: 0,
      avgDurationMs: 0,
      perModel: {},
      perUpstream: {},
    };
    let durationMs = 0;
    for (const [day, bucket] of this.days) {
      const dayStart = new Date(`${day}T00:00:00`).getTime();
      if (Number.isFinite(dayStart) ? dayStart < start : start > 0) continue;
      stats.totalRequests += bucket.requests;
      stats.okRequests += bucket.ok;
      stats.errorRequests += bucket.error;
      stats.totalInputTokens += bucket.inputTokens;
      stats.totalOutputTokens += bucket.outputTokens;
      stats.totalCachedTokens += bucket.cachedTokens;
      stats.failoverCount += bucket.failover;
      durationMs += bucket.durationMs;
      for (const [model, m] of Object.entries(bucket.perModel)) {
        const target =
          stats.perModel[model] ??
          (stats.perModel[model] = {
            requests: 0,
            ok: 0,
            inputTokens: 0,
            outputTokens: 0,
            cachedTokens: 0,
          });
        target.requests += m.requests;
        target.ok += m.ok;
        target.inputTokens += m.inputTokens;
        target.outputTokens += m.outputTokens;
        target.cachedTokens += m.cachedTokens;
      }
      for (const [upstream, u] of Object.entries(bucket.perUpstream)) {
        const target = stats.perUpstream[upstream] ?? (stats.perUpstream[upstream] = { requests: 0, ok: 0 });
        target.requests += u.requests;
        target.ok += u.ok;
      }
    }
    stats.avgDurationMs = stats.totalRequests ? Math.round(durationMs / stats.totalRequests) : 0;
    return stats;
  }
}
