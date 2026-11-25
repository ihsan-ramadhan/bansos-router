export interface RateLimiterOptions {
  // max requests per window per IP. 0 disables.
  limit: number;
  windowMs: number;
}

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly opts: RateLimiterOptions) {}

  // returns true when the request is allowed.
  check(key: string, now = Date.now()): boolean {
    if (this.opts.limit <= 0) return true;
    const windowStart = now - this.opts.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > windowStart);

    if (recent.length >= this.opts.limit) {
      this.hits.set(key, recent);
      return false;
    }

    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  // ms until the key has room again, for Retry-After
  retryAfterMs(key: string, now = Date.now()): number {
    if (this.opts.limit <= 0) return 0;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > now - this.opts.windowMs);
    if (recent.length < this.opts.limit) return 0;
    const oldest = recent[recent.length - this.opts.limit];
    return oldest === undefined ? 0 : Math.max(0, oldest + this.opts.windowMs - now);
  }

  reset(): void {
    this.hits.clear();
  }
}
