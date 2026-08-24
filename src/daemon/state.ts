import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_SECURITY_CONFIG,
  normalizeSecurityConfig,
  type SecurityConfig,
} from "../security/policy";

export const BANSOS_DIR = path.join(os.homedir(), ".bansos");

export const CONFIG_FILE = path.join(BANSOS_DIR, "config.json");
export const STATE_FILE = path.join(BANSOS_DIR, "state.json");
export const RELAY_STATE_FILE = path.join(BANSOS_DIR, "relay-state.json");

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

export function loadConfig(): BansosConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as Partial<BansosConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...raw,
      security: normalizeSecurityConfig(raw.security),
      localUpstreams: raw.localUpstreams ?? [],
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
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
