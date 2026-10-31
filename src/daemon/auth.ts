import crypto from "node:crypto";
import fs from "node:fs";
import type http from "node:http";
import path from "node:path";
import type { TLSSocket } from "node:tls";
import { isLoopbackBind } from "../security/policy";
import { API_KEY_FILE } from "./state";

export const MIN_API_KEY_LENGTH = 16;
export const MAX_API_KEY_LENGTH = 512;
// token68 plus "_": also keeps the key safe to drop into headers and TOML/YAML/env harness configs
export const API_KEY_PATTERN = /^[A-Za-z0-9._~+\/=-]+$/;
// shown in previews and dry runs so the real key is never displayed by accident
export const AUTH_KEY_PLACEHOLDER = "<BANSOS_API_KEY>";
// what harness configs get when the daemon runs with BANSOS_AUTH=off
export const AUTH_OFF_KEY = "bansos";
export const CREDENTIAL_HEADERS = ["authorization", "x-api-key", "proxy-authorization", "cookie", "x-goog-api-key"];
export const AUTH_ERROR_MESSAGE = "invalid or missing API key";
export const AUTH_BLOCKED_MESSAGE = "too many failed authentication attempts";

const DEFAULT_FAIL_LIMIT = 20;
const DEFAULT_FAIL_WINDOW_MS = 10 * 60_000;
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_TRACKED_IPS = 10_000;
const BEARER = /^bearer\s+(\S+)\s*$/i;

export type ApiKeySource = "env" | "file" | "generated";

export interface ResolvedApiKey {
  key: string;
  source: ApiKeySource;
  file: string;
}

export type DaemonAuth = { mode: "key"; key: string; source: ApiKeySource; file: string } | { mode: "off" };

export function generateApiKey(): string {
  return `bansos-${crypto.randomBytes(32).toString("base64url")}`;
}

// messages name the rule, never the value
export function validateApiKey(raw: string, label: string): string {
  const key = raw.trim();
  if (key === "") throw new Error(`${label} is set but empty; set a key of ${MIN_API_KEY_LENGTH} to ${MAX_API_KEY_LENGTH} characters or unset it`);
  if (key.length < MIN_API_KEY_LENGTH || key.length > MAX_API_KEY_LENGTH || !API_KEY_PATTERN.test(key)) {
    throw new Error(
      `${label} must be ${MIN_API_KEY_LENGTH} to ${MAX_API_KEY_LENGTH} characters from A-Z a-z 0-9 . _ ~ + / = - (no spaces or quotes)`,
    );
  }
  return key;
}

// null when the file does not exist; invalid content throws instead of silently regenerating
export function readStoredApiKey(file: string): string | null {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`cannot read the API key file ${file}: ${(err as Error).message}`);
  }
  const key = text.trim();
  if (key.length < MIN_API_KEY_LENGTH || key.length > MAX_API_KEY_LENGTH || !API_KEY_PATTERN.test(key)) {
    throw new Error(
      `the API key file ${file} does not hold a valid key (${MIN_API_KEY_LENGTH} to ${MAX_API_KEY_LENGTH} characters from A-Z a-z 0-9 . _ ~ + / = -); fix or delete it, or run "bansos key --rotate"`,
    );
  }
  return key;
}

function writeTempKey(file: string, key: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, `${key}\n`, { mode: 0o600 });
  return tmp;
}

// exclusive first create: a concurrent `bansos setup` and daemon start must agree on one key
export function ensureStoredApiKey(file: string): { key: string; created: boolean } {
  const existing = readStoredApiKey(file);
  if (existing) return { key: existing, created: false };
  const key = generateApiKey();
  const tmp = writeTempKey(file, key);
  try {
    try {
      fs.linkSync(tmp, file);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST") return { key: readStoredApiKey(file) ?? key, created: false };
      // filesystems without hard links: exclusive create is still race-free, just not atomic
      try {
        fs.writeFileSync(file, `${key}\n`, { mode: 0o600, flag: "wx" });
      } catch (fallbackErr) {
        if ((fallbackErr as NodeJS.ErrnoException).code === "EEXIST") {
          return { key: readStoredApiKey(file) ?? key, created: false };
        }
        throw fallbackErr;
      }
    }
    return { key, created: true };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export function rotateStoredApiKey(file: string): string {
  const key = generateApiKey();
  const tmp = writeTempKey(file, key);
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  return key;
}

// env > file > (optionally) generate; an env key is never written to the file
export function resolveApiKey(
  opts: { env?: NodeJS.ProcessEnv; file?: string; generate?: boolean } = {},
): ResolvedApiKey | null {
  const env = opts.env ?? process.env;
  const file = opts.file ?? API_KEY_FILE;
  if (env.BANSOS_API_KEY !== undefined) {
    return { key: validateApiKey(env.BANSOS_API_KEY, "BANSOS_API_KEY"), source: "env", file };
  }
  const stored = readStoredApiKey(file);
  if (stored) return { key: stored, source: "file", file };
  if (!opts.generate) return null;
  const ensured = ensureStoredApiKey(file);
  return { key: ensured.key, source: ensured.created ? "generated" : "file", file };
}

// fail closed: BANSOS_AUTH=off only on loopback, anything unrecognised refuses to start
export function resolveDaemonAuth(bind: string, env: NodeJS.ProcessEnv = process.env, file = API_KEY_FILE): DaemonAuth {
  const raw = env.BANSOS_AUTH;
  const mode = raw === undefined ? "on" : raw.trim().toLowerCase();
  if (mode !== "on" && mode !== "off") throw new Error('BANSOS_AUTH must be "on" or "off" (or unset)');
  if (mode === "off") {
    if (!isLoopbackBind(bind)) {
      throw new Error(`BANSOS_AUTH=off is only allowed with a loopback bind (got "${bind}"); unset BANSOS_AUTH or bind 127.0.0.1`);
    }
    return { mode: "off" };
  }
  const resolved = resolveApiKey({ env, file, generate: true })!;
  return { mode: "key", ...resolved };
}

// clients never generate a key: a missing one is the daemon's job to create
export function readClientApiKey(env: NodeJS.ProcessEnv = process.env, file = API_KEY_FILE): string | null {
  if (env.BANSOS_API_KEY !== undefined) return validateApiKey(env.BANSOS_API_KEY, "BANSOS_API_KEY");
  return readStoredApiKey(file);
}

export function stripCredentialHeaders(
  headers: http.IncomingHttpHeaders | Record<string, string | string[] | undefined>,
): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!CREDENTIAL_HEADERS.includes(name.toLowerCase())) out[name] = value;
  }
  return out;
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (name && !cookies.has(name)) cookies.set(name, part.slice(eq + 1).trim());
  }
  return cookies;
}

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest();

// derived so the cookie never carries the key and every token dies when the key rotates
function sessionKeyFor(apiKey: string): Buffer {
  return crypto.createHmac("sha256", apiKey).update("bansos-session-v1").digest();
}

function sessionMac(sessionKey: Buffer, payload: string): string {
  return crypto.createHmac("sha256", sessionKey).update(payload).digest("base64url");
}

export function createSessionToken(apiKey: string, nowMs: number, ttlMs: number): string {
  const exp = Math.floor((nowMs + ttlMs) / 1000);
  const nonce = crypto.randomBytes(16).toString("base64url");
  const payload = `v1.${exp}.${nonce}`;
  return `${payload}.${sessionMac(sessionKeyFor(apiKey), payload)}`;
}

export function verifySessionToken(
  apiKey: string,
  token: string,
  nowMs: number,
  revoked?: { has(nonce: string): boolean },
): { nonce: string; expMs: number } | null {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [version, exp, nonce, mac] = parts as [string, string, string, string];
  if (version !== "v1" || !/^\d{1,12}$/.test(exp) || !/^[A-Za-z0-9_-]{22}$/.test(nonce)) return null;
  const expected = Buffer.from(sessionMac(sessionKeyFor(apiKey), `v1.${exp}.${nonce}`));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  const expMs = Number(exp) * 1000;
  if (expMs <= nowMs) return null;
  if (revoked?.has(nonce)) return null;
  return { nonce, expMs };
}

// counts distinct wrong credentials per ip: brute force needs distinct guesses, a stale harness repeats one
export class AuthFailureLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxIps: number;
  private readonly failures = new Map<string, Map<string, number>>();

  constructor(opts: { limit?: number; windowMs?: number; maxIps?: number } = {}) {
    this.limit = opts.limit ?? DEFAULT_FAIL_LIMIT;
    this.windowMs = opts.windowMs ?? DEFAULT_FAIL_WINDOW_MS;
    this.maxIps = opts.maxIps ?? MAX_TRACKED_IPS;
  }

  static fingerprint(credential: string): string {
    return sha256(credential).toString("hex").slice(0, 16);
  }

  // seconds until the ip may try again; 0 when it is not blocked
  retryAfterSec(ip: string, now = Date.now()): number {
    const seen = this.live(ip, now);
    if (!seen || seen.size < this.limit) return 0;
    const times = [...seen.values()].sort((a, b) => a - b);
    const freedAt = times[seen.size - this.limit]! + this.windowMs;
    return Math.max(1, Math.ceil((freedAt - now) / 1000));
  }

  recordFailure(ip: string, credential: string, now = Date.now()): void {
    const seen = this.live(ip, now) ?? new Map<string, number>();
    seen.set(AuthFailureLimiter.fingerprint(credential), now);
    this.failures.set(ip, seen);
    if (this.failures.size > this.maxIps) this.prune(now);
  }

  private live(ip: string, now: number): Map<string, number> | undefined {
    const seen = this.failures.get(ip);
    if (!seen) return undefined;
    for (const [fp, at] of seen) if (at <= now - this.windowMs) seen.delete(fp);
    if (seen.size === 0) {
      this.failures.delete(ip);
      return undefined;
    }
    return seen;
  }

  private prune(now: number): void {
    for (const ip of [...this.failures.keys()]) this.live(ip, now);
  }
}

// x-forwarded-for is honored only from a loopback proxy, and only its right-most (proxy-appended) entry
export function clientIp(req: http.IncomingMessage, trustProxy: boolean): string {
  const peer = req.socket.remoteAddress ?? "unknown";
  if (!trustProxy || !isLoopbackBind(peer)) return peer;
  const raw = req.headers["x-forwarded-for"];
  const list = (Array.isArray(raw) ? raw.join(",") : raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list[list.length - 1] ?? peer;
}

export type AuthDecision =
  | { ok: true }
  | { ok: false; status: 401; clearCookie?: string }
  | { ok: false; status: 429; retryAfterSec: number };

export interface LoginResult {
  status: number;
  body: unknown;
  setCookie?: string;
  retryAfterSec?: number;
}

export interface AuthGateOptions {
  apiKey: string | null;
  port: number;
  failLimit?: number;
  failWindowMs?: number;
  trustProxy?: boolean;
  sessionTtlMs?: number;
}

export class AuthGate {
  readonly cookieName: string;
  private readonly apiKey: string | null;
  private readonly expected: Buffer | null;
  private readonly trustProxy: boolean;
  private readonly sessionTtlMs: number;
  private readonly limiter: AuthFailureLimiter;
  // logged-out nonces until they would have expired anyway; lost on restart
  private readonly revoked = new Map<string, number>();

  constructor(opts: AuthGateOptions) {
    this.apiKey = opts.apiKey;
    this.expected = opts.apiKey === null ? null : sha256(opts.apiKey);
    // port in the name: cookies ignore ports, so two daemons on one host would clobber each other
    this.cookieName = `bansos_session_${opts.port}`;
    this.trustProxy = opts.trustProxy ?? false;
    this.sessionTtlMs = opts.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.limiter = new AuthFailureLimiter({ limit: opts.failLimit, windowMs: opts.failWindowMs });
  }

  get required(): boolean {
    return this.apiKey !== null;
  }

  clientIp(req: http.IncomingMessage): string {
    return clientIp(req, this.trustProxy);
  }

  authenticate(req: http.IncomingMessage): AuthDecision {
    if (this.apiKey === null) return { ok: true };
    const ip = this.clientIp(req);
    const now = Date.now();
    // a blocked client learns nothing, not even whether its credential was right
    const retryAfterSec = this.limiter.retryAfterSec(ip, now);
    if (retryAfterSec > 0) return { ok: false, status: 429, retryAfterSec };

    const presented = this.presentedKeys(req);
    if (presented.some((key) => this.matches(key))) return { ok: true };

    let clearCookie: string | undefined;
    const token = parseCookies(headerText(req.headers.cookie)).get(this.cookieName);
    if (token !== undefined && isSameOrigin(req)) {
      if (verifySessionToken(this.apiKey, token, now, this.revoked)) return { ok: true };
      clearCookie = this.cookie("", 0, req);
      this.limiter.recordFailure(ip, token, now);
    }
    // no credential at all (dashboard polling before login) is not counted
    for (const key of presented) this.limiter.recordFailure(ip, key, now);
    return clearCookie ? { ok: false, status: 401, clearCookie } : { ok: false, status: 401 };
  }

  login(req: http.IncomingMessage, bodyText: string): LoginResult {
    if (this.apiKey === null) return { status: 200, body: { ok: true } };
    const ip = this.clientIp(req);
    const now = Date.now();
    const retryAfterSec = this.limiter.retryAfterSec(ip, now);
    if (retryAfterSec > 0) {
      return { status: 429, retryAfterSec, body: { error: { message: AUTH_BLOCKED_MESSAGE, type: "rate_limit_error" } } };
    }
    let key: unknown;
    try {
      key = (JSON.parse(bodyText) as { key?: unknown } | null)?.key;
    } catch {
      key = undefined;
    }
    if (typeof key !== "string" || key.trim() === "") {
      return { status: 400, body: { error: { message: 'body must be {"key": "<api key>"}', type: "invalid_request_error" } } };
    }
    if (!this.matches(key.trim())) {
      this.limiter.recordFailure(ip, key.trim(), now);
      return { status: 401, body: authErrorBody() };
    }
    const token = createSessionToken(this.apiKey, now, this.sessionTtlMs);
    return { status: 200, body: { ok: true }, setCookie: this.cookie(token, Math.floor(this.sessionTtlMs / 1000), req) };
  }

  logout(req: http.IncomingMessage): { setCookie: string } {
    const now = Date.now();
    for (const [nonce, expMs] of this.revoked) if (expMs <= now) this.revoked.delete(nonce);
    const token = parseCookies(headerText(req.headers.cookie)).get(this.cookieName);
    if (this.apiKey !== null && token !== undefined) {
      const session = verifySessionToken(this.apiKey, token, now, this.revoked);
      if (session) this.revoked.set(session.nonce, session.expMs);
    }
    return { setCookie: this.cookie("", 0, req) };
  }

  private presentedKeys(req: http.IncomingMessage): string[] {
    const keys: string[] = [];
    const bearer = BEARER.exec(headerText(req.headers.authorization));
    if (bearer?.[1]) keys.push(bearer[1]);
    const apiKey = headerText(req.headers["x-api-key"]).trim();
    if (apiKey) keys.push(apiKey);
    return keys;
  }

  private matches(presented: string): boolean {
    if (!this.expected) return false;
    return crypto.timingSafeEqual(sha256(presented), this.expected);
  }

  private cookie(value: string, maxAgeSec: number, req: http.IncomingMessage): string {
    const secure = isSecureRequest(req) ? "; Secure" : "";
    return `${this.cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}${secure}`;
  }
}

export function authErrorBody(): { error: { message: string; type: string; code: string } } {
  return { error: { message: AUTH_ERROR_MESSAGE, type: "authentication_error", code: "invalid_api_key" } };
}

function headerText(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(", ") : value ?? "";
}

// a session cookie only counts for the dashboard's own origin, never a cross-site request
function isSameOrigin(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin !== undefined) {
    try {
      if (new URL(origin).host !== req.headers.host) return false;
    } catch {
      return false;
    }
  }
  const site = headerText(req.headers["sec-fetch-site"]);
  return site === "" || site === "same-origin" || site === "none";
}

function isSecureRequest(req: http.IncomingMessage): boolean {
  if ((req.socket as TLSSocket).encrypted) return true;
  const proto = headerText(req.headers["x-forwarded-proto"]).split(",")[0]?.trim().toLowerCase();
  return proto === "https";
}
