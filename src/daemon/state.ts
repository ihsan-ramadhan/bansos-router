import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_SECURITY_CONFIG,
  normalizeSecurityConfig,
  securityConfigWarnings,
  type SecurityConfig,
} from "../security/policy";

export const BANSOS_DIR = path.join(os.homedir(), ".bansos");

export const CONFIG_FILE = path.join(BANSOS_DIR, "config.json");
export const STATE_FILE = path.join(BANSOS_DIR, "state.json");
export const RELAY_STATE_FILE = path.join(BANSOS_DIR, "relay-state.json");
export const LOG_DIR = path.join(BANSOS_DIR, "logs");
export const LOG_FILE = path.join(LOG_DIR, "bansosd.log");

export interface BansosConfig {
  port: number;
  bind: string;
  refreshIntervalMs: number;
  security: SecurityConfig;
  // opt-in local gateways (freebuff-proxy, litellm, ...)
  localUpstreams: Array<{ name: string; baseUrl: string; apiKey?: string }>;
}

export const DEFAULT_CONFIG: BansosConfig = {
  port: 17070,
  bind: "127.0.0.1",
  refreshIntervalMs: 30 * 60_000,
  security: { ...DEFAULT_SECURITY_CONFIG },
  localUpstreams: [],
};

export function ensureBansosDir(): void {
  fs.mkdirSync(BANSOS_DIR, { recursive: true });
}

// the port/bind a running daemon actually bound (from state.json), preferred over config
export function effectivePort(): number {
  const state = readJson<{ port?: number }>(STATE_FILE);
  return typeof state?.port === "number" ? state.port : loadConfig().port;
}

export function effectiveBind(): string {
  const state = readJson<{ bind?: string }>(STATE_FILE);
  return typeof state?.bind === "string" ? state.bind : loadConfig().bind;
}

export function readRawConfig(file = CONFIG_FILE): { raw: Partial<BansosConfig> | null; invalid: boolean } {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { raw: null, invalid: false };
  }
  try {
    const raw = JSON.parse(text) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { raw: null, invalid: true };
    return { raw: raw as Partial<BansosConfig>, invalid: false };
  } catch {
    return { raw: null, invalid: true };
  }
}

export function loadConfigWarnings(file = CONFIG_FILE): string[] {
  const { raw, invalid } = readRawConfig(file);
  if (invalid) {
    return [`${file} is not a valid JSON object; using defaults (normal mode, strict protections OFF).`];
  }
  return securityConfigWarnings(raw?.security);
}

export function loadConfig(file = CONFIG_FILE): BansosConfig {
  const { raw } = readRawConfig(file);
  if (!raw) return { ...DEFAULT_CONFIG };
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    security: normalizeSecurityConfig(raw.security),
    localUpstreams: raw.localUpstreams ?? [],
  };
}

  // atomic write: temp file in the same dir, then rename over target
export function writeJsonAtomic(file: string, data: unknown): void {
  ensureBansosDir();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}
