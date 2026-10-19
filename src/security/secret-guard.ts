export type SecretType =
  | "openai_api_key"
  | "anthropic_api_key"
  | "github_pat"
  | "aws_access_key"
  | "private_key"
  | "ssh_private_key"
  | "credential_assignment";

export interface SecretScanResult {
  blocked: boolean;
  secretTypes: SecretType[];
}

const KNOWN_SECRET_PATTERNS: ReadonlyArray<{
  type: SecretType;
  pattern: RegExp;
}> = [
  {
    type: "anthropic_api_key",
    pattern: /\bsk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{16,}\b/,
  },
  {
    type: "openai_api_key",
    pattern: /\bsk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/,
  },
  {
    type: "github_pat",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,})\b/,
  },
  {
    type: "aws_access_key",
    pattern: /\b(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[A-Z0-9]{16}\b/,
  },
  {
    type: "ssh_private_key",
    pattern: /-----BEGIN (?:OPENSSH PRIVATE KEY|SSH2 ENCRYPTED PRIVATE KEY)-----/,
  },
  {
    type: "private_key",
    pattern: /-----BEGIN (?:RSA |EC |DSA |PKCS8 |ENCRYPTED )?PRIVATE KEY-----/,
  },
];

const SENSITIVE_KEYS = new Set([
  "password",
  "passwd",
  "pwd",
  "token",
  "accesstoken",
  "authtoken",
  "refreshtoken",
  "apikey",
  "secret",
  "clientsecret",
  "signingsecret",
]);

// a bare value stops at an escaped newline so it cannot swallow the next line of a nested JSON string
const BARE_VALUE = /((?:(?!\\[nrt])[^\s,;'"}])+)/.source;

const INLINE_ASSIGNMENTS = [
  /\b([\w-]+)\s*[:=]\s*"([^"]+)"/gi,
  /\b([\w-]+)\s*[:=]\s*'([^']+)'/gi,
  new RegExp(`\\b([\\w-]+)\\s*[:=]\\s*${BARE_VALUE}`, "gi"),
];

const PLACEHOLDER_VALUES = new Set([
  "example", "sample", "test", "dummy", "placeholder", "redacted", "masked",
  "changeme", "password", "secret", "token", "api_key", "api-key", "none",
  "null", "undefined", "bansos",
]);

function isPlaceholderValue(value: string): boolean {
  const lower = value.toLowerCase();
  if (PLACEHOLDER_VALUES.has(lower)) return true;
  if (lower === "your" || lower.startsWith("your-") || lower.startsWith("your_") || lower.startsWith("your ")) return true;
  if (/^[x*]+$/i.test(value)) return true;
  if (/^\[REDACTED:[a-z_]+\]$/.test(value)) return true;
  if (value.startsWith("<") && value.endsWith(">")) return true;
  if (value.startsWith("${") && value.endsWith("}")) return true;
  return /^process\.env\.\w+$/i.test(value);
}

function isLikelyCredentialValue(value: string): boolean {
  const clean = value.trim().replace(/\\+$/, "").replace(/^["']|["']$/g, "");
  if (clean.length < 8 || isPlaceholderValue(clean)) return false;
  if (/\s/.test(clean) && clean.length < 16) return false;
  return true;
}

function inspectString(value: string, found: Set<SecretType>): void {
  for (const { type, pattern } of KNOWN_SECRET_PATTERNS) {
    if (pattern.test(value)) found.add(type);
  }

  for (const pattern of INLINE_ASSIGNMENTS) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
      const key = match[1] ?? "";
      const assigned = match[2] ?? "";
      if (SENSITIVE_KEYS.has(normalizeKey(key)) && isLikelyCredentialValue(assigned)) {
        found.add("credential_assignment");
      }
    }
  }
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function inspectValue(
  value: unknown,
  found: Set<SecretType>,
  seen: WeakSet<object>,
  key?: string,
): void {
  if (typeof value === "string") {
    inspectString(value, found);
    if (key && SENSITIVE_KEYS.has(normalizeKey(key)) && isLikelyCredentialValue(value)) {
      found.add("credential_assignment");
    }
    return;
  }

  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) inspectValue(item, found, seen);
    return;
  }

  for (const [childKey, childValue] of Object.entries(value)) {
    inspectValue(childValue, found, seen, childKey);
  }
}

export function scanRequestBody(body: unknown): SecretScanResult {
  let parsed = body;
  if (typeof body === "string") {
    try {
      parsed = JSON.parse(body) as unknown;
    } catch {
      parsed = body;
    }
  }

  const found = new Set<SecretType>();
  inspectValue(parsed, found, new WeakSet<object>());
  const secretTypes = [...found].sort((a, b) => a.localeCompare(b));
  return { blocked: secretTypes.length > 0, secretTypes };
}

export interface SecretRedactResult {
  body: string;
  secretTypes: SecretType[];
  count: number;
}

const PRIVATE_KEY_BLOCK = /-----BEGIN ((?:[A-Z0-9]+ )*)PRIVATE KEY-----(?:[\s\S]*?-----END \1PRIVATE KEY-----|(?:(?:\r?\n|\\+[nr])+(?:[A-Za-z0-9-]+: [^\r\n\\]*|[A-Za-z0-9+/=]+(?=\r?\n|\\+[nr]|$)))*)/g;

const TOKEN_PATTERNS = KNOWN_SECRET_PATTERNS
  .filter(({ type }) => type !== "private_key" && type !== "ssh_private_key")
  .map(({ type, pattern }) => ({ type, pattern: new RegExp(pattern.source, "g") }));

const marker = (type: SecretType) => `[REDACTED:${type}]`;

function redactString(value: string, found: Set<SecretType>, tally: { count: number }): string {
  let out = value.replace(PRIVATE_KEY_BLOCK, (_m, kind: string) => {
    const type: SecretType = /OPENSSH|SSH2/.test(kind) ? "ssh_private_key" : "private_key";
    found.add(type);
    tally.count++;
    return marker(type);
  });
  for (const { type, pattern } of TOKEN_PATTERNS) {
    out = out.replace(pattern, () => {
      found.add(type);
      tally.count++;
      return marker(type);
    });
  }
  for (const pattern of INLINE_ASSIGNMENTS) {
    out = out.replace(pattern, (match: string, key: string, assigned: string) => {
      const value = assigned.replace(/\\+$/, "");
      if (!SENSITIVE_KEYS.has(normalizeKey(key)) || !isLikelyCredentialValue(value)) return match;
      found.add("credential_assignment");
      tally.count++;
      const at = match.lastIndexOf(assigned);
      return match.slice(0, at) + marker("credential_assignment") + match.slice(at + value.length);
    });
  }
  return out;
}

// tool arguments arrive as JSON inside a string; redacting their text with regexes can break the escaping
function parseJsonContainer(value: string): unknown {
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function redactValue(value: unknown, found: Set<SecretType>, tally: { count: number }, key?: string): unknown {
  if (typeof value === "string") {
    if (key && SENSITIVE_KEYS.has(normalizeKey(key)) && isLikelyCredentialValue(value)) {
      found.add("credential_assignment");
      tally.count++;
      return marker("credential_assignment");
    }
    const nested = parseJsonContainer(value);
    if (nested !== undefined) {
      const before = tally.count;
      const redacted = redactValue(nested, found, tally);
      return tally.count === before ? value : JSON.stringify(redacted);
    }
    return redactString(value, found, tally);
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, found, tally));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactValue(v, found, tally, k)]));
  }
  return value;
}

// strict mode default: replace each finding in place so the session keeps working and nothing leaves
export function redactRequestBody(body: string): SecretRedactResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const found = new Set<SecretType>();
  const tally = { count: 0 };
  const redacted = JSON.stringify(redactValue(parsed, found, tally));
  if (scanRequestBody(redacted).blocked) return null;
  return { body: redacted, secretTypes: [...found].sort((a, b) => a.localeCompare(b)), count: tally.count };
}
