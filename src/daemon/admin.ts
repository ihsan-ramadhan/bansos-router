import fs from "node:fs";
import type http from "node:http";
import net, { isIP } from "node:net";
import { findAdapter } from "../adapters";
import { harnessStatuses } from "../cli/doctor";
import { applyAdapter, undoAdapter, type SetupLine } from "../cli/setup";
import {
  assertBindAllowed,
  isLoopbackBind,
  normalizeSecurityConfig,
  type SecurityConfig,
} from "../security/policy";
import { checkUpdate, VERSION } from "../update";
import { pickSmartDefaultModel } from "../upstreams/types";
import type { RuntimeCatalog } from "./catalog";
import { CONFIG_FILE, LOG_FILE, loadConfig, loadConfigWarnings, readRawConfig, writeJsonAtomic } from "./state";

export interface AdminOptions {
  security: SecurityConfig;
  catalog: RuntimeCatalog;
  port: number;
  bind: string;
  refreshIntervalMs: number;
  flags?: { port?: boolean; bind?: boolean; unsafeAllowNonLoopback?: boolean };
  restart?: () => void;
  configFile?: string;
  logFile?: string;
}

export interface AdminResult {
  status: number;
  body: unknown;
  after?: () => void;
}

export const ADMIN_PATHS = new Set([
  "/bansos/config",
  "/bansos/restart",
  "/bansos/logs",
  "/bansos/doctor",
  "/bansos/adapters/apply",
]);

const MIN_REFRESH_MS = 60_000;
const MAX_REFRESH_MS = 24 * 60 * 60_000;
const MAX_LOG_LINES = 2000;
const LOG_TAIL_BYTES = 512 * 1024;

type SecurityView = Pick<SecurityConfig, "mode" | "dlp" | "allowedUpstreams" | "allowCrossProviderFailover">;

interface SettingsView {
  security: SecurityView;
  refreshIntervalMs: number;
  port: number;
  bind: string;
}

function securityView(s: SecurityConfig, rawFailover?: unknown): SecurityView {
  return {
    mode: s.mode,
    dlp: s.dlp,
    allowedUpstreams: [...s.allowedUpstreams],
    allowCrossProviderFailover: rawFailover === undefined ? s.allowCrossProviderFailover : rawFailover !== false,
  };
}

function configView(opts: AdminOptions) {
  const file = opts.configFile ?? CONFIG_FILE;
  const { raw, invalid } = readRawConfig(file);
  const saved = loadConfig(file);
  const rawSecurity = raw?.security as { allowCrossProviderFailover?: unknown } | undefined;
  const savedView: SettingsView = {
    security: securityView(saved.security, rawSecurity?.allowCrossProviderFailover),
    refreshIntervalMs: saved.refreshIntervalMs,
    port: saved.port,
    bind: saved.bind,
  };
  const running: SettingsView = {
    security: securityView(opts.security),
    refreshIntervalMs: opts.refreshIntervalMs,
    port: opts.port,
    bind: opts.bind,
  };
  const restartRequired: string[] = [];
  if (JSON.stringify(securityView(saved.security)) !== JSON.stringify(running.security)) restartRequired.push("security");
  if (savedView.refreshIntervalMs !== running.refreshIntervalMs) restartRequired.push("refreshIntervalMs");
  if (!opts.flags?.port && savedView.port !== running.port) restartRequired.push("port");
  if (!opts.flags?.bind && savedView.bind !== running.bind) restartRequired.push("bind");
  return {
    path: file,
    exists: fs.existsSync(file),
    invalid,
    warnings: loadConfigWarnings(file),
    saved: savedView,
    running,
    upstreams: opts.catalog.upstreamIds,
    flags: {
      port: Boolean(opts.flags?.port),
      bind: Boolean(opts.flags?.bind),
      unsafeAllowNonLoopback: Boolean(opts.flags?.unsafeAllowNonLoopback),
    },
    restartRequired,
    canRestart: Boolean(opts.restart),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validatePatch(body: unknown, upstreamIds: string[]): { error: string } | { patch: Record<string, unknown> } {
  if (!isRecord(body)) return { error: "body must be a JSON object" };
  const patch: Record<string, unknown> = {};

  if (body.security !== undefined) {
    if (!isRecord(body.security)) return { error: "security must be an object" };
    const s = body.security;
    const security: Record<string, unknown> = {};
    if (s.mode !== undefined) {
      if (s.mode !== "normal" && s.mode !== "strict") return { error: 'security.mode must be "normal" or "strict"' };
      security.mode = s.mode;
    }
    if (s.dlp !== undefined) {
      if (s.dlp !== "redact" && s.dlp !== "block") return { error: 'security.dlp must be "redact" or "block"' };
      security.dlp = s.dlp;
    }
    if (s.allowedUpstreams !== undefined) {
      if (!Array.isArray(s.allowedUpstreams) || !s.allowedUpstreams.every((u) => typeof u === "string")) {
        return { error: "security.allowedUpstreams must be a list of upstream ids" };
      }
      const unknown = s.allowedUpstreams.filter((u) => !upstreamIds.includes(u));
      if (unknown.length > 0) return { error: `unknown upstream: ${unknown.join(", ")}` };
      security.allowedUpstreams = [...new Set(s.allowedUpstreams)];
    }
    if (s.allowCrossProviderFailover !== undefined) {
      if (typeof s.allowCrossProviderFailover !== "boolean") return { error: "security.allowCrossProviderFailover must be true or false" };
      security.allowCrossProviderFailover = s.allowCrossProviderFailover;
    }
    patch.security = security;
  }

  if (body.refreshIntervalMs !== undefined) {
    const v = body.refreshIntervalMs;
    if (typeof v !== "number" || !Number.isInteger(v) || (v !== 0 && (v < MIN_REFRESH_MS || v > MAX_REFRESH_MS))) {
      return { error: "refreshIntervalMs must be 0 (off) or between 1 minute and 24 hours" };
    }
    patch.refreshIntervalMs = v;
  }

  if (body.port !== undefined) {
    const v = body.port;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 65535) return { error: "port must be a number from 1 to 65535" };
    patch.port = v;
  }

  if (body.bind !== undefined) {
    const v = typeof body.bind === "string" ? body.bind.trim() : "";
    if (v !== "localhost" && isIP(v) === 0) return { error: "bind must be an IP address such as 127.0.0.1, or localhost" };
    patch.bind = v;
  }

  return { patch };
}

function saveConfig(opts: AdminOptions, body: unknown): AdminResult {
  const file = opts.configFile ?? CONFIG_FILE;
  const { raw, invalid } = readRawConfig(file);
  if (invalid) {
    return { status: 409, body: { error: { message: `${file} is not valid JSON; fix or delete it by hand before saving from the UI` } } };
  }
  const result = validatePatch(body, opts.catalog.upstreamIds);
  if ("error" in result) return { status: 400, body: { error: { message: result.error } } };

  const current = (raw ?? {}) as Record<string, unknown>;
  const { security: securityPatch, ...rest } = result.patch;
  const merged: Record<string, unknown> = { ...current, ...rest };
  if (securityPatch) merged.security = { ...(isRecord(current.security) ? current.security : {}), ...(securityPatch as object) };

  const nextSecurity = normalizeSecurityConfig(merged.security as Partial<SecurityConfig> | undefined);
  const nextBind = typeof merged.bind === "string" ? merged.bind : opts.bind;
  try {
    assertBindAllowed(nextBind, nextSecurity, opts.flags?.unsafeAllowNonLoopback);
    assertBindAllowed(opts.bind, nextSecurity, opts.flags?.unsafeAllowNonLoopback);
  } catch (err) {
    return { status: 400, body: { error: { message: (err as Error).message } } };
  }

  writeJsonAtomic(file, merged);

  const before = JSON.stringify(opts.security);
  Object.assign(opts.security, nextSecurity);
  if (JSON.stringify(opts.security) !== before) void opts.catalog.refresh();

  return { status: 200, body: configView(opts) };
}

function tailLines(file: string, max: number): string[] {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return [];
  }
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - LOG_TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n");
    if (start > 0) lines.shift();
    if (lines[lines.length - 1] === "") lines.pop();
    return lines.slice(-max);
  } finally {
    fs.closeSync(fd);
  }
}

function setupBaseUrl(bind: string, port: number): string {
  const unspecified = bind === "0.0.0.0" || bind === "::" || bind === "localhost";
  const host = unspecified || isLoopbackBind(bind) ? "127.0.0.1" : bind;
  return `http://${isIP(host) === 6 ? `[${host}]` : host}:${port}/v1`;
}

function applySetup(opts: AdminOptions, body: unknown): AdminResult {
  if (!isRecord(body) || typeof body.id !== "string") return { status: 400, body: { error: { message: "missing harness id" } } };
  const adapter = findAdapter(body.id);
  if (!adapter) return { status: 404, body: { error: { message: `harness "${body.id}" not found` } } };
  let model: string | undefined;
  if (body.model !== undefined && body.model !== "") {
    if (typeof body.model !== "string" || !opts.catalog.resolve(body.model)) {
      return { status: 400, body: { error: { message: `unknown model: ${String(body.model)}` } } };
    }
    model = body.model;
  }
  const models = opts.catalog.models;
  const ctx = {
    baseUrl: setupBaseUrl(opts.bind, opts.port),
    defaultModel: model ?? pickSmartDefaultModel(models),
    models,
    specificModel: Boolean(model),
  };
  const lines: SetupLine[] = [];
  const report = (line: SetupLine) => lines.push(line);
  let failed = 0;
  try {
    if (body.undo === true) undoAdapter(adapter, ctx, report);
    else failed = applyAdapter(adapter, ctx, report);
  } catch (err) {
    lines.push({ kind: "error", text: (err as Error).message });
    failed++;
  }
  const status = harnessStatuses().find((h) => h.id === adapter.id);
  return { status: 200, body: { ok: failed === 0, lines, harness: status } };
}

function portFree(port: number, bind: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, bind, () => probe.close(() => resolve(true)));
  });
}

export async function handleAdmin(
  req: http.IncomingMessage,
  method: string,
  url: string,
  rawUrl: string,
  readBody: () => Promise<string>,
  opts: AdminOptions,
): Promise<AdminResult> {
  if (!isLoopbackBind(req.socket.remoteAddress ?? "")) {
    return { status: 403, body: { error: { message: "settings can only be changed from the machine running bansos" } } };
  }

  const readJson = async (): Promise<{ ok: true; value: unknown } | { ok: false }> => {
    const text = await readBody();
    if (!text) return { ok: true, value: {} };
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch {
      return { ok: false };
    }
  };
  const badJson: AdminResult = { status: 400, body: { error: { message: "invalid json body" } } };

  if (url === "/bansos/config" && method === "GET") return { status: 200, body: configView(opts) };
  if (url === "/bansos/config" && method === "POST") {
    const parsed = await readJson();
    return parsed.ok ? saveConfig(opts, parsed.value) : badJson;
  }

  if (url === "/bansos/restart" && method === "POST") {
    if (!opts.restart) return { status: 501, body: { error: { message: "this daemon cannot restart itself" } } };
    const saved = loadConfig(opts.configFile ?? CONFIG_FILE);
    const port = opts.flags?.port ? opts.port : saved.port;
    const bind = opts.flags?.bind ? opts.bind : saved.bind;
    const moving = port !== opts.port || bind !== opts.bind;
    if (moving && !(await portFree(port, bind))) {
      return { status: 409, body: { error: { message: `port ${port} on ${bind} is already in use; pick another port and save again` } } };
    }
    return { status: 202, body: { restarting: true, port, bind }, after: opts.restart };
  }

  if (url === "/bansos/logs" && method === "GET") {
    const requested = Number(new URL(rawUrl, "http://127.0.0.1").searchParams.get("lines"));
    const max = Number.isInteger(requested) && requested > 0 ? Math.min(requested, MAX_LOG_LINES) : 200;
    const file = opts.logFile ?? LOG_FILE;
    return { status: 200, body: { path: file, lines: tailLines(file, max) } };
  }

  if (url === "/bansos/doctor" && method === "GET") {
    return {
      status: 200,
      body: {
        version: VERSION,
        update: await checkUpdate(),
        configWarnings: loadConfigWarnings(opts.configFile ?? CONFIG_FILE),
        security: securityView(opts.security),
        harnesses: harnessStatuses(),
      },
    };
  }

  if (url === "/bansos/adapters/apply" && method === "POST") {
    const parsed = await readJson();
    return parsed.ok ? applySetup(opts, parsed.value) : badJson;
  }

  return { status: 405, body: { error: { message: "method not allowed" } } };
}
