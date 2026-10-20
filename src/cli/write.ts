import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function expandHome(p: string): string {
  if (p === "~") {
    return os.homedir();
  }
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

// robust zero-dependency JSONC / JSON parser (strips line/block comments & trailing commas)
export function parseJsonc(text: string): Record<string, unknown> {
  const clean = text.replace(/^\uFEFF/, "");
  const out: string[] = [];
  let inString = false;
  let quoteChar = "";
  let isEscaped = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    const next = clean[i + 1];

    if (inString) {
      out.push(ch);
      if (isEscaped) {
        isEscaped = false;
      } else if (ch === "\\") {
        isEscaped = true;
      } else if (ch === quoteChar) {
        inString = false;
      }
    } else {
      if (ch === '"' || ch === "'") {
        inString = true;
        quoteChar = ch;
        out.push(ch);
      } else if (ch === "/" && next === "/") {
        // line comment: skip until newline
        while (i < clean.length && clean[i] !== "\n") i++;
        if (i < clean.length) out.push(clean[i]!); // preserve newline
      } else if (ch === "/" && next === "*") {
        // block comment: skip until */
        i += 2;
        while (i < clean.length && !(clean[i] === "*" && clean[i + 1] === "/")) i++;
        i++; // skip /
      } else if (ch === "}" || ch === "]") {
        let j = out.length - 1;
        while (j >= 0 && /\s/.test(out[j]!)) j--;
        if (out[j] === ",") out.splice(j, 1);
        out.push(ch);
      } else {
        out.push(ch);
      }
    }
  }

  return JSON.parse(out.join("")) as Record<string, unknown>;
}

function markerBlock(content: string, markers: [string, string]): string {
  if (content.includes(markers[0])) return `${content.replace(/\s+$/, "")}\n`;
  return `${markers[0]}\n${content.replace(/\s+$/, "")}\n${markers[1]}\n`;
}

function findBlock(
  lines: string[],
  start: string,
  end: string,
): [number, number] | null {
  const si = lines.findIndex((l) => l.includes(start));
  const ei = lines.findIndex((l) => l.includes(end));
  if (si === -1 || ei === -1 || ei < si) return null;
  return [si, ei];
}

// replace the marked block if present, otherwise append it
export function applyBlockWrite(
  existing: string,
  content: string,
  markers: [string, string],
): string {
  const block = markerBlock(content, markers);
  const lines = existing.split("\n");
  const span = findBlock(lines, markers[0], markers[1]);
  if (span) {
    const [si, ei] = span;
    const head = lines.slice(0, si).join("\n").replace(/\s+$/, "");
    const tail = lines.slice(ei + 1).join("\n").replace(/^\s+/, "");
    const parts = [head, block.replace(/\s+$/, ""), tail].filter((s) => s !== "");
    return `${parts.join("\n\n")}\n`;
  }
  const base = existing.replace(/\s+$/, "");
  return base ? `${base}\n\n${block}` : block;
}

const TOML_ROOT_TAG = "# bansos-router";
const TOML_PREV_TAG = "# bansos-router-prev: ";
const TOML_TAGGED_RE = /#\s*bansos-router\s*$/;

function tomlKeyRe(key: string): RegExp {
  return new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`);
}

function upsertTomlRootKeys(lines: string[], rootKeys: string[]): void {
  for (const raw of rootKeys) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const key = line.split("=", 1)[0]!.trim();
    const keyRe = tomlKeyRe(key);
    let rootEnd = lines.findIndex((l) => /^\s*\[/.test(l));
    if (rootEnd === -1) rootEnd = lines.length;
    const tagged = `${line}  ${TOML_ROOT_TAG}`;
    const idx = lines.slice(0, rootEnd).findIndex((l) => keyRe.test(l));
    if (idx === -1) {
      let at = rootEnd;
      while (at > 0 && lines[at - 1]!.trim() === "") at--;
      lines.splice(at, 0, tagged);
      if (lines[at + 1] !== undefined && /^\s*\[/.test(lines[at + 1]!)) lines.splice(at + 1, 0, "");
    } else if (TOML_TAGGED_RE.test(lines[idx]!) || lines[idx]!.trim() === line) {
      lines[idx] = tagged;
    } else {
      lines.splice(idx, 1, `${TOML_PREV_TAG}${lines[idx]!.trim()}`, tagged);
    }
  }
}

// root keys go in root scope (tagged); the table is patched in place when present, else appended in markers
export function applyTomlBlockWrite(
  existing: string,
  content: string,
  markers: [string, string],
  tableName: string,
): string {
  const stripped = removeBlock(existing, markers).replace(/\s+$/, "");
  const lines = stripped === "" ? [] : stripped.split("\n");

  const contentLines = content.replace(/\s+$/, "").split("\n");
  const tblIdx = contentLines.findIndex((l) => /^\[/.test(l.trim()));
  const rootKeys = tblIdx === -1 ? contentLines : contentLines.slice(0, tblIdx);
  const tableBody = tblIdx === -1 ? [] : contentLines.slice(tblIdx + 1);
  const tableSection = tblIdx === -1 ? [] : contentLines.slice(tblIdx);

  upsertTomlRootKeys(lines, rootKeys);

  const headerRe = new RegExp(`^\\[${tableName.replace(/\./g, "\\.")}\\]\\s*$`);
  const headerIdx = lines.findIndex((l) => headerRe.test(l.trim()));
  if (headerIdx === -1) {
    const base = lines.join("\n").replace(/\s+$/, "");
    if (tableSection.length === 0) return `${base}\n`;
    const block = markerBlock(tableSection.join("\n"), markers);
    return base ? `${base}\n\n${block}` : block;
  }

  let sectionEnd = lines.length;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i]!)) {
      sectionEnd = i;
      break;
    }
  }
  for (const line of tableBody) {
    if (!line.trim() || /^#/.test(line.trim())) continue;
    const keyRe = tomlKeyRe(line.split("=", 1)[0]!.trim());
    let replaced = false;
    for (let i = headerIdx + 1; i < sectionEnd; i++) {
      if (keyRe.test(lines[i]!)) {
        lines[i] = line;
        replaced = true;
        break;
      }
    }
    if (!replaced) {
      lines.splice(sectionEnd, 0, line);
      sectionEnd++;
    }
  }
  return `${lines.join("\n").replace(/\s+$/, "")}\n`;
}

export function removeTomlBlock(existing: string, markers: [string, string]): string {
  const lines = removeBlock(existing, markers).split("\n");
  const out: string[] = [];
  for (const l of lines) {
    if (TOML_TAGGED_RE.test(l)) continue;
    out.push(l.startsWith(TOML_PREV_TAG) ? l.slice(TOML_PREV_TAG.length) : l);
  }
  return `${out.join("\n").replace(/\s+$/, "")}\n`.replace(/^\n+/, "");
}

// nest a child mapping (content at column 0) under a top-level YAML key, keyed by a marker block
export function applyYamlBlockWrite(
  existing: string,
  content: string,
  markers: [string, string],
  parentKey: string,
): string {
  const key = parentKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripped = removeBlock(existing, markers).replace(/\s+$/, "");
  const lines = stripped === "" ? [] : stripped.split("\n");

  const parentRe = new RegExp(`^${key}:\\s*(#.*)?$`);
  const inlineRe = new RegExp(`^${key}:\\s*\\S`);
  if (lines.some((l) => inlineRe.test(l) && !parentRe.test(l))) {
    throw new Error(`cannot merge under inline "${parentKey}:"; edit the file by hand`);
  }

  const body = content.replace(/\s+$/, "").split("\n");
  const parentIdx = lines.findIndex((l) => parentRe.test(l));

  if (parentIdx === -1) {
    // no parent: create it with the child, markers wrapping both so undo is clean
    const inner = body.map((l) => (l ? `  ${l}` : l));
    const block = [markers[0], `${parentKey}:`, ...inner, markers[1]].join("\n");
    return stripped ? `${stripped}\n\n${block}\n` : `${block}\n`;
  }

  // parent exists: match the indent of its existing children (default 2)
  let childIndent = 2;
  for (let i = parentIdx + 1; i < lines.length; i++) {
    if (lines[i]!.trim() === "") continue;
    const indent = lines[i]!.length - lines[i]!.trimStart().length;
    if (indent > 0) childIndent = indent;
    break;
  }
  const pad = " ".repeat(childIndent);
  const block = [`${pad}${markers[0]}`, ...body.map((l) => (l ? `${pad}${l}` : l)), `${pad}${markers[1]}`];

  // insert after the parent's existing children, before the next top-level key
  let insertAt = lines.length;
  for (let i = parentIdx + 1; i < lines.length; i++) {
    if (lines[i]!.trim() === "") continue;
    const indent = lines[i]!.length - lines[i]!.trimStart().length;
    if (indent === 0) {
      insertAt = i;
      break;
    }
  }
  lines.splice(insertAt, 0, ...block);
  return `${lines.join("\n").replace(/\s+$/, "")}\n`;
}

// remove the marked block (markers inclusive)
export function removeBlock(
  existing: string,
  markers: [string, string],
): string {
  const lines = existing.split("\n");
  const span = findBlock(lines, markers[0], markers[1]);
  if (!span) return existing;
  const [si, ei] = span;
  const head = lines.slice(0, si).join("\n").replace(/\s+$/, "");
  const tail = lines.slice(ei + 1).join("\n").replace(/^\s+/, "");
  return `${[head, tail].filter((s) => s !== "").join("\n\n")}\n`;
}

function getItemKey(item: unknown): string | undefined {
  if (item && typeof item === "object") {
    const rec = item as Record<string, unknown>;
    if (typeof rec.id === "string") return rec.id;
    if (typeof rec.title === "string") return rec.title;
    if (typeof rec.model === "string") return rec.model;
  }
  return undefined;
}

function deepMerge(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(patch)) {
    if (
      v !== null && typeof v === "object" && !Array.isArray(v) &&
      target[k] !== null && typeof target[k] === "object" && !Array.isArray(target[k])
    ) {
      deepMerge(target[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else if (Array.isArray(v) && Array.isArray(target[k])) {
      const targetArr = target[k] as unknown[];
      for (const item of v) {
        const itemKey = getItemKey(item);
        if (itemKey !== undefined) {
          const idx = targetArr.findIndex((t) => getItemKey(t) === itemKey);
          if (idx >= 0) {
            targetArr[idx] = item;
          } else {
            targetArr.push(item);
          }
        } else {
          targetArr.push(item);
        }
      }
    } else {
      target[k] = v;
    }
  }
}

// merge a rendered json/jsonc fragment into the existing file (valid formatted json out)
export function applyMergeWrite(existing: string | null, content: string, replace: string[] = []): string {
  const patch = parseJsonc(content);
  const base = existing && existing.trim().length > 0 ? parseJsonc(existing) : {};
  removeKeys(base, replace);
  deepMerge(base, patch);
  return `${JSON.stringify(base, null, 2)}\n`;
}

// delete dotted keys (e.g. "env.ANTHROPIC_BASE_URL" or "providerNodes.bansos") from a parsed json object
export function removeKeys(obj: Record<string, unknown>, keys: string[]): void {
  for (const kp of keys) {
    const parts = kp.split(".");
    let cur: unknown = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i]!;
      cur = (cur as Record<string, unknown> | undefined)?.[p];
      if (!cur || typeof cur !== "object") break;
    }
    if (cur && typeof cur === "object") {
      const last = parts[parts.length - 1]!;
      const matches = last.endsWith("*")
        ? (k: string | undefined) => k !== undefined && k.startsWith(last.slice(0, -1))
        : (k: string | undefined) => k === last;
      if (Array.isArray(cur)) {
        for (let idx = cur.length - 1; idx >= 0; idx--) {
          if (matches(getItemKey(cur[idx]))) cur.splice(idx, 1);
        }
      } else {
        for (const k of Object.keys(cur)) if (matches(k)) delete (cur as Record<string, unknown>)[k];
      }
    }
  }
}

export function writeConfig(p: string, content: string): void {
  const full = expandHome(p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}
