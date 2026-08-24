import { scanRequestBody, type SecretType } from "./security/secret-guard";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(prefix: string): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  json?: boolean;
  prefix?: string;
}

const SAFE_FIELD_NAMES = new Set([
  "model",
  "upstream",
  "status",
  "durationMs",
  "inputTokens",
  "outputTokens",
  "failoverBlocked",
  "dlpBlocked",
  "secretType",
  "secretTypes",
  "attempt",
  "attempts",
  "from",
  "to",
  "fromUpstream",
  "failoverFrom",
  "stream",
]);

const SECRET_TYPES = new Set<SecretType>([
  "openai_api_key",
  "anthropic_api_key",
  "github_pat",
  "aws_access_key",
  "private_key",
  "ssh_private_key",
  "credential_assignment",
]);

function validatedSecretTypes(value: unknown): SecretType[] {
  const values = Array.isArray(value) ? value : [value];
  return values.filter(
    (item): item is SecretType => typeof item === "string" && SECRET_TYPES.has(item as SecretType),
  );
}

function safeFields(
  fields?: Record<string, unknown>,
  initialSecretTypes: SecretType[] = [],
): Record<string, unknown> | undefined {
  const safe: Record<string, unknown> = {};
  const detectedTypes = new Set(initialSecretTypes);
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (!SAFE_FIELD_NAMES.has(key)) continue;
    if (key === "secretType" || key === "secretTypes") {
      for (const type of validatedSecretTypes(value)) detectedTypes.add(type);
      continue;
    }
    const scan = scanRequestBody(value);
    if (scan.blocked) {
      for (const type of scan.secretTypes) detectedTypes.add(type);
      continue;
    }
    safe[key] = value;
  }
  if (detectedTypes.size > 0) {
    safe.secretTypes = [...detectedTypes].sort((a, b) => a.localeCompare(b));
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const level = opts.level ?? "info";
  const json = opts.json ?? process.env.BANSOS_LOG === "json";
  const prefix = opts.prefix ?? "";

  const write = (lvl: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (LEVEL_ORDER[lvl] < LEVEL_ORDER[level]) return;
    const messageScan = scanRequestBody(msg);
    const safeMessage = messageScan.blocked ? "sensitive log message suppressed" : msg;
    const line = prefix ? `[${prefix}] ${safeMessage}` : safeMessage;
    const filteredFields = safeFields(fields, messageScan.secretTypes);
    if (json) {
      process.stdout.write(
        `${JSON.stringify({ timestamp: new Date().toISOString(), level: lvl, msg: safeMessage, ...filteredFields })}\n`,
      );
    } else {
      const tag = lvl === "error" ? "✗" : lvl === "warn" ? "⚠" : lvl === "debug" ? "·" : "✓";
      process.stdout.write(`${tag} ${line}${renderFields(filteredFields)}\n`);
    }
  };

  return {
    debug: (m, f) => write("debug", m, f),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    child: (p) => createLogger({ level, json, prefix: p }),
  };
}

// plain mode renders fields so the log tail stays informative (model, tokens, ...)
function renderFields(fields?: Record<string, unknown>): string {
  if (!fields || Object.keys(fields).length === 0) return "";
  return ` ${Object.entries(fields)
    .map(([k, v]) => `${k}=${fmtValue(v)}`)
    .join(" ")}`;
}

function fmtValue(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return v.map(fmtValue).join(",");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
