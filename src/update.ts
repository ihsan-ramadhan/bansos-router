import fs from "node:fs";
import path from "node:path";
import pkgJson from "../package.json";
import { BANSOS_DIR } from "./daemon/state";

// single source of truth: package.json "version"
export const VERSION: string = pkgJson.version;

const CACHE_FILE = path.join(BANSOS_DIR, "update-check.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// NO_UPDATE_NOTIFIER is the npm-wide opt-out; it also keeps the test suite off the registry
const notifierOff = (): boolean => Boolean(process.env.NO_UPDATE_NOTIFIER);

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
  if (notifierOff()) return { hasUpdate: false, current: currentVersion, latest: currentVersion };
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

// a failed registry call never refreshes the cache, so peekUpdate waits this long before trying again
const RETRY_MS = 60 * 60 * 1000;

const known = new Map<string, CacheEntry | null>();
let refreshing: Promise<UpdateInfo> | null = null;
let lastAttempt = 0;

// the cached answer without waiting on the registry; status polls hit memory, not the disk
export function peekUpdate(pkgName = "bansos-router", currentVersion = VERSION): UpdateInfo | null {
  if (notifierOff()) return null;
  if (!known.has(pkgName)) known.set(pkgName, readCache()[pkgName] ?? null);
  const entry = known.get(pkgName) ?? null;
  const now = Date.now();
  const stale = !entry || now - entry.checkedAt > CACHE_TTL_MS;
  if (stale && !refreshing && now - lastAttempt > RETRY_MS) {
    lastAttempt = now;
    refreshing = checkUpdate(pkgName, currentVersion)
      .then((info) => {
        known.set(pkgName, readCache()[pkgName] ?? null);
        return info;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  if (!entry) return null;
  return { hasUpdate: isNewerVersion(currentVersion, entry.latest), current: currentVersion, latest: entry.latest };
}

// npm i -g swapped the code on disk, but the daemon at baseUrl still runs the version it started with
export async function staleDaemonNotice(baseUrl: string): Promise<string | null> {
  const versionAt = async (path: string): Promise<string | undefined> => {
    const res = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : undefined;
  };
  try {
    // older daemons report their version only on the doctor route
    const running = (await versionAt("/bansos/status")) ?? (await versionAt("/bansos/doctor"));
    return running && isNewerVersion(running, VERSION)
      ? `bansosd at ${baseUrl} still runs ${running}, but ${VERSION} is installed (run: bansos restart)`
      : null;
  } catch {
    return null;
  }
}

export function updateNotice(info: UpdateInfo): string | null {
  return info.hasUpdate ? `Update available: ${info.current} -> ${info.latest} (run: npm i -g bansos-router, then bansos restart)` : null;
}
