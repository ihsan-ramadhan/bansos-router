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

interface ModelActivity {
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
  private totalRequests = 0;
  private okRequests = 0;
  private errorRequests = 0;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private failoverCount = 0;
  private totalDurationMs = 0;
  private perModel: Record<string, ModelActivity> = {};
  private perUpstream: Record<string, { requests: number; ok: number }> = {};

  constructor(cap = 500) {
    this.cap = cap;
  }

  record(input: ActivityInput): void {
    const event: ActivityEvent = {
      id: this.nextId++,
      timestamp: Date.now(),
      ...input,
    };
    this.events.push(event);
    if (this.events.length > this.cap) this.events.shift();

    this.totalRequests++;
    if (input.status === "ok") this.okRequests++;
    else this.errorRequests++;
    this.totalInputTokens += input.inputTokens;
    this.totalOutputTokens += input.outputTokens;
    this.totalDurationMs += input.durationMs;
    if (input.failoverFrom) this.failoverCount++;

    const m =
      this.perModel[input.model] ??
      (this.perModel[input.model] = { requests: 0, ok: 0, inputTokens: 0, outputTokens: 0 });
    m.requests++;
    if (input.status === "ok") m.ok++;
    m.inputTokens += input.inputTokens;
    m.outputTokens += input.outputTokens;

    const u =
      this.perUpstream[input.upstream] ?? (this.perUpstream[input.upstream] = { requests: 0, ok: 0 });
    u.requests++;
    if (input.status === "ok") u.ok++;
  }

  getEvents(limit = 100): ActivityEvent[] {
    return this.events.slice(-limit).reverse();
  }

  getUsage(): UsageStats {
    return {
      totalRequests: this.totalRequests,
      okRequests: this.okRequests,
      errorRequests: this.errorRequests,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      failoverCount: this.failoverCount,
      avgDurationMs: this.totalRequests
        ? Math.round(this.totalDurationMs / this.totalRequests)
        : 0,
      perModel: this.perModel,
      perUpstream: this.perUpstream,
    };
  }
}
