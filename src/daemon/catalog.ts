import type { Logger } from "../logger";
import {
  DEFAULT_SECURITY_CONFIG,
  isUpstreamAllowed,
  type SecurityConfig,
} from "../security/policy";
import type { ModelDef, Upstream, UpstreamSource } from "../upstreams/types";

export interface RefreshReport {
  checked: number;
  alive: number;
  dead: number;
  degraded: string[];
}

export class RuntimeCatalog {
  private byId = new Map<string, ModelDef>();
  private readonly bySource = new Map<string, Upstream>();
  private readonly upstreams: Upstream[];

  constructor(
    upstreams: Upstream[],
    private readonly log: Logger,
    private readonly security: SecurityConfig = DEFAULT_SECURITY_CONFIG,
  ) {
    this.upstreams = upstreams;
    for (const u of upstreams) {
      this.bySource.set(u.id, u);
      if (u.kind === "local-openai") this.bySource.set("local", u);
    }
  }

  // upstream that serves a model source (zen/kilo/llm7/local)
  upstreamBySource(source: UpstreamSource): Upstream | undefined {
    return this.bySource.get(source);
  }

  // seed the pinned registry so the daemon works before any network call
  seed(models: ModelDef[]): void {
    for (const m of models) this.byId.set(m.id, m);
  }

  get models(): ModelDef[] {
    return [...this.byId.values()];
  }

  resolve(id: string): ModelDef | undefined {
    const direct = this.byId.get(id);
    if (direct) return direct;
    // alias fallback for Zen model renames (e.g. ox-alpha-free -> x-preview-f-free)
    if (id === "ox-alpha-free" || id === "0x-alpha-free" || id === "ox-alpha" || id === "0x-alpha") {
      const mapped = this.byId.get("x-preview-f-free");
      if (mapped) return mapped;
    }
    // tolerant fallback: e.g. "hy3:free" matches "tencent/hy3:free"
    for (const [k, m] of this.byId) {
      if (k.endsWith(`/${id}`)) return m;
    }
    return undefined;
  }

  // health-check: unreachable upstream keeps last-known models;
  // a reachable upstream's live list replaces its seeded entries
  async refresh(): Promise<RefreshReport> {
    const report: RefreshReport = { checked: 0, alive: 0, dead: 0, degraded: [] };

    for (const upstream of this.upstreams) {
      if (!isUpstreamAllowed(this.security, upstream.id)) {
        report.degraded.push(upstream.id);
        this.log.warn(`upstream ${upstream.id}: blocked by strict allowlist`);
        continue;
      }
      const live = await upstream.fetchCatalog();
      if (live === null) {
        report.degraded.push(upstream.id);
        this.log.warn(`upstream ${upstream.id}: no live catalog — keeping last-known models`);
        continue;
      }
      const source: UpstreamSource =
        upstream.kind === "local-openai" ? "local" : (upstream.id as UpstreamSource);
      this.replaceBySource(source, live);
      report.checked += live.length;
    }

    report.alive = this.byId.size;
    this.log.info(`catalog refresh: ${report.alive} model(s) alive`);
    return report;
  }

  private replaceBySource(source: UpstreamSource, models: ModelDef[]): void {
    for (const [id, m] of this.byId) {
      if (m.source === source) this.byId.delete(id);
    }
    for (const m of models) this.byId.set(m.id, m);
  }
}
