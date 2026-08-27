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
  durationMs: number;
  status: ActivityStatus;
  failoverFrom?: string;
}

export interface ModelActivity {
  requests: number;
  ok: number;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageStats {
  totalRequests: number;
  okRequests: number;
  errorRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  failoverCount: number;
  avgDurationMs: number;
  perModel: Record<string, ModelActivity>;
  perUpstream: Record<string, { requests: number; ok: number }>;
}

export type TimeWindow = "today" | "7d" | "30d" | "60d" | "all";

export interface ActivityInput {
  kind: ActivityKind;
  model: string;
  requestedModel: string;
  upstream: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  status: ActivityStatus;
  failoverFrom?: string;
}

export const ACTIVITY_FILE = path.join(BANSOS_DIR, "activity.json");
const MAX_RETENTION_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

export function emptyUsage(): UsageStats {
  return {
    totalRequests: 0,
    okRequests: 0,
    errorRequests: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    failoverCount: 0,
    avgDurationMs: 0,
    perModel: {},
    perUpstream: {},
  };
}

export class ActivityStore {
  private events: ActivityEvent[] = [];
  private nextId = 1;
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
          // Filter out older than 60 days
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

    // Enforce 60-day window and max cap
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

  getUsage(window: TimeWindow = "all"): UsageStats {
    const filtered = this.filterByWindow(this.events, window);
    let totalRequests = 0;
    let okRequests = 0;
    let errorRequests = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
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
      totalDurationMs += e.durationMs;
      if (e.failoverFrom) failoverCount++;

      const m =
        perModel[e.model] ??
        (perModel[e.model] = { requests: 0, ok: 0, inputTokens: 0, outputTokens: 0 });
      m.requests++;
      if (e.status === "ok") m.ok++;
      m.inputTokens += e.inputTokens;
      m.outputTokens += e.outputTokens;

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
