import { BlockList, isIP } from "node:net";

export type SecurityMode = "normal" | "strict";
export type DlpAction = "redact" | "block";

export interface SecurityConfig {
  mode: SecurityMode;
  allowedUpstreams: string[];
  allowCrossProviderFailover: boolean;
  unsafeAllowNonLoopbackBind: boolean;
  dlp: DlpAction;
}

export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  mode: "normal",
  allowedUpstreams: [],
  allowCrossProviderFailover: true,
  unsafeAllowNonLoopbackBind: false,
  dlp: "redact",
};

const IPV6_LOOPBACK = new BlockList();
IPV6_LOOPBACK.addAddress("::1", "ipv6");

export function normalizeSecurityConfig(
  raw: Partial<SecurityConfig> | null | undefined,
): SecurityConfig {
  const mode: SecurityMode = normalizedMode(raw?.mode) === "strict" ? "strict" : "normal";
  const allowedUpstreams = Array.isArray(raw?.allowedUpstreams)
    ? [...new Set(raw.allowedUpstreams
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean))]
    : [];

  return {
    mode,
    allowedUpstreams,
    // strict mode stays fail-closed even if a stale config says otherwise
    allowCrossProviderFailover:
      mode === "strict" ? false : raw?.allowCrossProviderFailover !== false,
    unsafeAllowNonLoopbackBind: raw?.unsafeAllowNonLoopbackBind === true,
    dlp: normalizedMode(raw?.dlp) === "block" ? "block" : "redact",
  };
}

function normalizedMode(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim().toLowerCase() : undefined;
}

// an unrecognised mode silently means "normal", which is the opposite of what someone typing it wanted
export function securityConfigWarnings(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return [`security must be an object such as {"mode": "strict"}, got ${JSON.stringify(raw)}; running in normal mode (secret guard and strict protections are OFF).`];
  }
  const { mode: rawMode, dlp: rawDlp } = raw as { mode?: unknown; dlp?: unknown };
  const warnings: string[] = [];
  const mode = normalizedMode(rawMode);
  if (rawMode !== undefined && mode !== "strict" && mode !== "normal") {
    warnings.push(
      `security.mode ${JSON.stringify(rawMode)} is not recognized; running in normal mode (secret guard and strict protections are OFF). Use "strict" or "normal".`,
    );
  }
  const dlp = normalizedMode(rawDlp);
  if (mode === "strict" && rawDlp !== undefined && dlp !== "redact" && dlp !== "block") {
    warnings.push(`security.dlp ${JSON.stringify(rawDlp)} is not recognized; using "redact". Use "redact" or "block".`);
  }
  return warnings;
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

// block these so the daemon is not an SSRF scanner; hostnames are not resolved (caller intent)
const SENSITIVE_IPV4 = new BlockList();
SENSITIVE_IPV4.addSubnet("0.0.0.0", 8, "ipv4");
SENSITIVE_IPV4.addSubnet("10.0.0.0", 8, "ipv4");
SENSITIVE_IPV4.addSubnet("100.64.0.0", 10, "ipv4");
SENSITIVE_IPV4.addSubnet("127.0.0.0", 8, "ipv4");
SENSITIVE_IPV4.addSubnet("169.254.0.0", 16, "ipv4");
SENSITIVE_IPV4.addSubnet("172.16.0.0", 12, "ipv4");
SENSITIVE_IPV4.addSubnet("192.0.0.0", 24, "ipv4");
SENSITIVE_IPV4.addSubnet("192.0.2.0", 24, "ipv4");
SENSITIVE_IPV4.addSubnet("192.168.0.0", 16, "ipv4");
SENSITIVE_IPV4.addSubnet("198.18.0.0", 15, "ipv4");
SENSITIVE_IPV4.addSubnet("198.51.100.0", 24, "ipv4");
SENSITIVE_IPV4.addSubnet("203.0.113.0", 24, "ipv4");
SENSITIVE_IPV4.addSubnet("224.0.0.0", 4, "ipv4");
SENSITIVE_IPV4.addSubnet("240.0.0.0", 4, "ipv4");

const SENSITIVE_IPV6 = new BlockList();
SENSITIVE_IPV6.addAddress("::", "ipv6");
SENSITIVE_IPV6.addAddress("::1", "ipv6");
SENSITIVE_IPV6.addSubnet("fc00::", 7, "ipv6");
SENSITIVE_IPV6.addSubnet("fe80::", 10, "ipv6");
SENSITIVE_IPV6.addSubnet("2001:db8::", 32, "ipv6");

export function isSensitiveNetworkHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  const address = normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;

  if (isIP(address) === 4) {
    return SENSITIVE_IPV4.check(address, "ipv4");
  }
  if (isIP(address) === 6) {
    // IPv4-mapped addresses (::ffff:a.b.c.d) should be judged as IPv4
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
    if (mapped) return SENSITIVE_IPV4.check(mapped[1]!, "ipv4");
    return SENSITIVE_IPV6.check(address, "ipv6");
  }
  // non-IP hostname: caller's own DNS choice, not a literal internal target
  return false;
}
