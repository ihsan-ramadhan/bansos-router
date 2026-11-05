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

export const ACTIVITY_FILE = path.join(BANSOS_DIR, "activity.json");
const MAX_RETENTION_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

export class ActivityStore {
  private events: ActivityEvent[] = [];
  private inFlight = new Map<number, InFlightRequest>();
  private nextId = 1;
  private nextInFlightId = 1;
  private readonly cap: number;
  private saveTimeout: NodeJS.Timeout | null = null;
  constructor(cap = 5000) {
    this.cap = cap;
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(ACTIVITY_FILE)) {
        const raw = fs.readFileSync(ACTIVITY_FILE, "utf8");
        const data = JSON.parse(raw);
        if (Array.isArray(data.events)) {
          const now = Date.now();
          // drop anything older than 60 days
          this.events = data.events.filter(
            (e: ActivityEvent) => now - e.timestamp <= MAX_RETENTION_MS
          );
          if (this.events.length > 0) {
            this.nextId = Math.max(...this.events.map((e) => e.id || 0)) + 1;
          }
        }
      }
    } catch {
      this.events = [];
    }
  }

  private scheduleSave(): void {
    if (this.saveTimeout) return;
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      this.flushToDisk();
    }, 2000);
  }

  public flushToDisk(): void {
    try {
      ensureBansosDir();
      writeJsonAtomic(ACTIVITY_FILE, {
        updatedAt: Date.now(),
        events: this.events,
      });
    } catch {
      // ignore persistence error
    }
  }

  record(input: ActivityInput): void {
    const now = Date.now();
    const event: ActivityEvent = {
      id: this.nextId++,
      timestamp: now,
      ...input,
    };
    this.events.push(event);

    // enforce the 60-day window and the max cap
    this.events = this.events.filter((e) => now - e.timestamp <= MAX_RETENTION_MS);
    if (this.events.length > this.cap) {
      this.events = this.events.slice(-this.cap);
    }

    this.scheduleSave();
  }

  getEvents(limit = 100, window: TimeWindow = "all"): ActivityEvent[] {
    const filtered = this.filterByWindow(this.events, window);
    return filtered.slice(-limit).reverse();
  }

  getAllEvents(): ActivityEvent[] {
    return [...this.events];
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
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this.events = [];
    this.nextId = 1;
    this.flushToDisk();
  }

  importEvents(incoming: ActivityEvent[], replace = false): number {
    if (!Array.isArray(incoming)) return 0;
    const now = Date.now();
    const valid = incoming.filter(
      (e) =>
        e &&
        typeof e === "object" &&
        typeof e.timestamp === "number" &&
        now - e.timestamp <= MAX_RETENTION_MS &&
        typeof e.model === "string" &&
        typeof e.upstream === "string" &&
        (e.status === "ok" || e.status === "error"),
    );
    if (replace) {
      this.events = valid;
    } else {
      const seen = new Set(this.events.map((e) => `${e.timestamp}_${e.model}_${e.upstream}`));
      for (const e of valid) {
        const key = `${e.timestamp}_${e.model}_${e.upstream}`;
        if (!seen.has(key)) {
          seen.add(key);
          this.events.push(e);
        }
      }
    }
    this.events.sort((a, b) => a.timestamp - b.timestamp);
    if (this.events.length > this.cap) {
      this.events = this.events.slice(-this.cap);
    }
    if (this.events.length > 0) {
      this.nextId = Math.max(...this.events.map((e) => e.id || 0)) + 1;
    }
    this.flushToDisk();
    return valid.length;
  }

  getUsage(window: TimeWindow = "all"): UsageStats {
    const filtered = this.filterByWindow(this.events, window);
    let totalRequests = 0;
    let okRequests = 0;
    let errorRequests = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCachedTokens = 0;
    let failoverCount = 0;
    let totalDurationMs = 0;
    const perModel: Record<string, ModelActivity> = {};
    const perUpstream: Record<string, { requests: number; ok: number }> = {};

    for (const e of filtered) {
      totalRequests++;
      if (e.status === "ok") okRequests++;
      else errorRequests++;
      totalInputTokens += e.inputTokens;
      totalOutputTokens += e.outputTokens;
      totalCachedTokens += e.cachedTokens ?? 0;
      totalDurationMs += e.durationMs;
      if (e.failoverFrom) failoverCount++;

      const m =
        perModel[e.model] ??
        (perModel[e.model] = { requests: 0, ok: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0 });
      m.requests++;
      if (e.status === "ok") m.ok++;
      m.inputTokens += e.inputTokens;
      m.outputTokens += e.outputTokens;
      m.cachedTokens += e.cachedTokens ?? 0;

      const u =
        perUpstream[e.upstream] ?? (perUpstream[e.upstream] = { requests: 0, ok: 0 });
      u.requests++;
      if (e.status === "ok") u.ok++;
    }

    return {
      totalRequests,
      okRequests,
      errorRequests,
      totalInputTokens,
      totalOutputTokens,
      totalCachedTokens,
      failoverCount,
      avgDurationMs: totalRequests ? Math.round(totalDurationMs / totalRequests) : 0,
      perModel,
      perUpstream,
    };
  }

  private filterByWindow(events: ActivityEvent[], window: TimeWindow): ActivityEvent[] {
    if (window === "all") return events;
    const now = Date.now();
    let threshold = 0;
    if (window === "today") {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      threshold = startOfDay.getTime();
    } else if (window === "7d") {
      threshold = now - 7 * 24 * 60 * 60 * 1000;
    } else if (window === "30d") {
      threshold = now - 30 * 24 * 60 * 60 * 1000;
    } else if (window === "60d") {
      threshold = now - 60 * 24 * 60 * 60 * 1000;
    }
    return events.filter((e) => e.timestamp >= threshold);
  }
}
