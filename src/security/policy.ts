import { BlockList, isIP } from "node:net";

export type SecurityMode = "normal" | "strict";

export interface SecurityConfig {
  mode: SecurityMode;
  allowedUpstreams: string[];
  allowCrossProviderFailover: boolean;
  unsafeAllowNonLoopbackBind: boolean;
}

export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  mode: "normal",
  allowedUpstreams: [],
  allowCrossProviderFailover: true,
  unsafeAllowNonLoopbackBind: false,
};

const IPV6_LOOPBACK = new BlockList();
IPV6_LOOPBACK.addAddress("::1", "ipv6");

export function normalizeSecurityConfig(
  raw: Partial<SecurityConfig> | null | undefined,
): SecurityConfig {
  const mode: SecurityMode = raw?.mode === "strict" ? "strict" : "normal";
  const allowedUpstreams = Array.isArray(raw?.allowedUpstreams)
    ? [...new Set(raw.allowedUpstreams
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean))]
    : [];

  return {
    mode,
    allowedUpstreams,
    // Strict mode is fail-closed even if a stale or conflicting config says true.
    allowCrossProviderFailover:
      mode === "strict" ? false : raw?.allowCrossProviderFailover !== false,
    unsafeAllowNonLoopbackBind: raw?.unsafeAllowNonLoopbackBind === true,
  };
}

export function isStrictSecurity(config: SecurityConfig): boolean {
  return config.mode === "strict";
}

export function isLoopbackBind(bind: string): boolean {
  const normalized = bind.trim().toLowerCase();
  if (normalized === "localhost") return true;
  const address = normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;

  if (isIP(address) === 4) {
    return address.split(".")[0] === "127";
  }

  const mappedIpv4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (mappedIpv4) return isLoopbackBind(mappedIpv4[1]!);
  return isIP(address) === 6 && IPV6_LOOPBACK.check(address, "ipv6");
}

export function assertBindAllowed(
  bind: string,
  security: SecurityConfig,
  cliUnsafeOverride = false,
): void {
  if (!isStrictSecurity(security) || isLoopbackBind(bind)) return;
  if (security.unsafeAllowNonLoopbackBind || cliUnsafeOverride) return;

  throw new Error(
    `strict security mode refuses non-loopback bind "${bind}"; ` +
    "use 127.0.0.1 or pass --unsafe-allow-non-loopback explicitly",
  );
}

export function isUpstreamAllowed(
  security: SecurityConfig,
  upstreamId: string,
): boolean {
  return !isStrictSecurity(security) || security.allowedUpstreams.includes(upstreamId);
}

export function isCrossProviderFailoverAllowed(security: SecurityConfig): boolean {
  return !isStrictSecurity(security) && security.allowCrossProviderFailover;
}

export function isRelayAllowed(security: SecurityConfig): boolean {
  return !isStrictSecurity(security);
}
