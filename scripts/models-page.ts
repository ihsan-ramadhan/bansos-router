// builds the published model list (index.html, models.json, badge.json): npx tsx scripts/models-page.ts <outDir>
import fs from "node:fs";
import path from "node:path";
import { RuntimeCatalog } from "../src/daemon/catalog";
import { createLogger } from "../src/logger";
import { DEFAULT_UPSTREAMS, SEEDED_MODELS } from "../src/upstreams";
import type { ModelDef } from "../src/upstreams/types";

const UPSTREAM_NAMES: Record<string, string> = {
  zen: "OpenCode Zen",
  kilo: "KiloCode gateway",
  llm7: "LLM7",
  ovh: "OVHcloud AI Endpoints",
};

const REPO = "https://github.com/ihsan-ramadhan/bansos-router";
const ROOT = path.resolve(import.meta.dirname, "..");

interface Upstream {
  id: string;
  name: string;
  reachable: boolean;
  models: ModelDef[];
}

function tokens(n: number): string {
  return n >= 1_000_000 ? `${Math.round(n / 1_000_000)}M` : `${Math.round(n / 1000)}k`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function flag(on: boolean): string {
  return on
    ? `<span aria-hidden="true">✓</span><span class="sr">yes</span>`
    : `<span class="off" aria-hidden="true">✗</span><span class="sr">no</span>`;
}

function section(u: Upstream): string {
  const note = u.reachable
    ? ""
    : `<p class="note">${esc(u.name)} did not answer on this run, so these are the models bansos ships with, not a live check.</p>`;
  const rows = u.models
    .map((m) => `<tr><td class="id"><code>${esc(m.id)}</code></td><td>${flag(m.reasoning)}</td><td>${flag(m.input.includes("image"))}</td><td class="num">${tokens(m.contextWindow)}</td><td class="num">${tokens(m.maxTokens)}</td></tr>`)
    .join("\n");
  return `<section aria-labelledby="up-${u.id}">
<h2 id="up-${u.id}">${esc(u.name)} <span class="count">${u.models.length}</span></h2>
${note}
<div class="scroll" tabindex="0" role="region" aria-label="${esc(u.name)} models">
<table>
<thead><tr><th scope="col">model id</th><th scope="col">reasoning</th><th scope="col">vision</th><th scope="col" class="num">context</th><th scope="col" class="num">max output</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>
</section>`;
}

function page(upstreams: Upstream[], total: number, checkedAt: Date): string {
  const iso = checkedAt.toISOString();
  const shown = `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>bansos-router models</title>
<meta name="description" content="Free coding models bansos-router can route to, re-checked every six hours.">
<link rel="icon" href="favicon.ico">
<style>
:root { color-scheme: dark; --bg: #111113; --panel: #16161a; --line: #26262e; --text: #f4f4f6; --muted: #a1a1aa; --link: #7cb4fb; --off: #8b8b96; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
main { max-width: 860px; margin: 0 auto; padding: 48px 16px 64px; }
h1 { font-size: 28px; line-height: 1.2; margin: 0 0 12px; display: flex; align-items: center; gap: 12px; }
h2 { font-size: 17px; margin: 40px 0 10px; display: flex; align-items: baseline; gap: 10px; }
p { margin: 0 0 10px; }
.lede { font-size: 17px; }
.meta { color: var(--muted); }
.count { color: var(--muted); font-weight: 400; font-size: 14px; font-variant-numeric: tabular-nums; }
.note { color: var(--muted); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; background: var(--panel); }
a { color: var(--link); text-underline-offset: 3px; }
a:focus-visible, .scroll:focus-visible { outline: 2px solid var(--link); outline-offset: 2px; border-radius: 4px; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13.5px; }
p code { background: var(--panel); border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; }
.scroll { position: relative; overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 9px 14px; border-bottom: 1px solid var(--line); white-space: nowrap; }
th { color: var(--muted); font-weight: 500; font-size: 13px; }
tbody tr:last-child td { border-bottom: 0; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.id { width: 100%; }
.off { color: var(--off); }
.sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
footer { margin-top: 48px; color: var(--muted); }
@media (max-width: 480px) { main { padding-top: 32px; } th, td { padding: 8px 10px; } }
</style>
</head>
<body>
<main>
<h1><img src="favicon.png" width="40" height="40" alt="">bansos-router models</h1>
<p class="lede">${total} free coding models across ${upstreams.length} upstreams, as the daemon's own catalog check saw them.</p>
<p class="meta">Checked <time datetime="${iso}">${shown}</time> from GitHub Actions, every six hours. Some upstreams answer differently by region and IP, so run <code>bansos models</code> for what your machine can reach.</p>
${upstreams.map(section).join("\n")}
<footer>
<p>Context and max output are token counts. The same list is at <a href="models.json">models.json</a>. Setup and source: <a href="${REPO}">${REPO.replace("https://", "")}</a>.</p>
</footer>
</main>
</body>
</html>
`;
}

async function main(): Promise<void> {
  const outDir = path.resolve(process.argv[2] ?? "site");
  const catalog = new RuntimeCatalog(DEFAULT_UPSTREAMS, createLogger({ prefix: "models-page" }));
  catalog.seed(SEEDED_MODELS);
  const report = await catalog.refresh();
  if (report.degraded.length === DEFAULT_UPSTREAMS.length) throw new Error("no upstream answered; keeping the last published list");

  const checkedAt = new Date();
  const upstreams: Upstream[] = DEFAULT_UPSTREAMS.map((u) => ({
    id: u.id,
    name: UPSTREAM_NAMES[u.id] ?? u.id,
    reachable: !report.degraded.includes(u.id),
    models: catalog.models.filter((m) => m.source === u.id),
  })).filter((u) => u.models.length > 0);
  const total = upstreams.reduce((n, u) => n + u.models.length, 0);

  const json = {
    checkedAt: checkedAt.toISOString(),
    total,
    upstreams: upstreams.map(({ id, name, reachable, models }) => ({ id, name, reachable, count: models.length })),
    models: upstreams.flatMap((u) => u.models.map((m) => ({
      id: m.id,
      upstream: u.id,
      reasoning: m.reasoning,
      vision: m.input.includes("image"),
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
    }))),
  };
  const badge = { schemaVersion: 1, label: "free models", message: `${total} live`, color: "2b64e0" };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "index.html"), page(upstreams, total, checkedAt));
  fs.writeFileSync(path.join(outDir, "models.json"), `${JSON.stringify(json, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, "badge.json"), `${JSON.stringify(badge)}\n`);
  fs.copyFileSync(path.join(ROOT, "src/ui/public/favicon.ico"), path.join(outDir, "favicon.ico"));
  fs.copyFileSync(path.join(ROOT, "src/ui/public/favicon.png"), path.join(outDir, "favicon.png"));
  console.log(`wrote ${total} models to ${outDir}`);
}

main().then(() => process.exit(0), (err) => {
  console.error(String(err?.message ?? err));
  process.exit(1);
});
