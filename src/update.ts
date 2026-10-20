import fs from "node:fs";
import path from "node:path";
import pkgJson from "../package.json";
import { BANSOS_DIR } from "./daemon/state";

// single source of truth: package.json "version"
export const VERSION: string = pkgJson.version;

const CACHE_FILE = path.join(BANSOS_DIR, "update-check.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  latest: string;
  checkedAt: number;
}

export interface UpdateInfo {
  hasUpdate: boolean;
  current: string;
  latest: string;
}

export function isNewerVersion(current: string, latest: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const [cMaj = 0, cMin = 0, cPat = 0] = parse(current);
  const [lMaj = 0, lMin = 0, lPat = 0] = parse(latest);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

function readCache(): Record<string, CacheEntry> {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as Record<string, CacheEntry>;
    }
  } catch {
    // ignore corrupt cache
  }
  return {};
}

function writeCache(cache: Record<string, CacheEntry>): void {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
  } catch {
    // ignore cache write errors (e.g. read-only fs)
  }
}

export async function checkUpdate(
  pkgName = "bansos-router",
  currentVersion = VERSION,
): Promise<UpdateInfo> {
  const cache = readCache();
  const entry = cache[pkgName];
  const now = Date.now();

  let latestVersion = entry?.latest;

  if (!latestVersion || !entry || now - entry.checkedAt > CACHE_TTL_MS) {
    try {
      const res = await fetch(`https://registry.npmjs.org/${pkgName}/latest`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) {
        const data = (await res.json()) as { version?: string };
        if (data.version) {
          latestVersion = data.version;
          cache[pkgName] = { latest: latestVersion, checkedAt: now };
          writeCache(cache);
        }
      }
    } catch {
      // offline or registry unreachable; fall back to stale cache if present
    }
  }

  const latest = latestVersion ?? currentVersion;
  return {
    hasUpdate: isNewerVersion(currentVersion, latest),
    current: currentVersion,
    latest,
  };
}
