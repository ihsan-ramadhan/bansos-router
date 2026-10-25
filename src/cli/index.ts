#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";

// Zen uses Cloudflare JA4 fingerprinting: Node.js (OpenSSL) is flagged as a 3rd-party scraper, while Bun (BoringSSL) matches the official OpenCode runtime, so re-exec under Bun when available.
if (!("Bun" in globalThis) && !process.env.BANSOS_NO_BUN && !process.env._BANSOS_BUN_REEXEC) {
  try {
    const bunCheck = spawnSync("bun", ["--version"], { stdio: "ignore", timeout: 1000 });
    if (bunCheck.status === 0) {
      const res = spawnSync("bun", process.argv.slice(1), {
        stdio: "inherit",
        env: { ...process.env, _BANSOS_BUN_REEXEC: "1" },
      });
      process.exit(res.status ?? 0);
    }
  } catch {}
}
import { runAutostart } from "./autostart";
import { runDoctor } from "./doctor";
import { runPing } from "./ping";
import { runRelay } from "./relay";
import { runSetup } from "./setup";
import { runDaemon, DEFAULT_PORT, MAX_PORT } from "../daemon";
import { BANSOS_DIR, STATE_FILE, effectiveBind, effectivePort, readJson, runningDaemonUrl } from "../daemon/state";
import { VERSION, checkUpdate } from "../update";

function help(): void {
  console.log(`bansos - free, keyless coding models for every agent harness

Usage:
  bansos <command> [flags]

Commands:
  start       start the daemon (--bg = detached)
  stop        stop the daemon started here (--all for every daemon)
  setup       write harness config files
  status      daemon status (aliases: none)
  models      list live catalog
  ping        probe health and latency of model(s)
  refresh     re-run health checks
  logs        tail the daemon log live
  usage       show request usage + token totals (--json)
  relay       manage relay egress
  autostart   start the daemon when you log in (on/off/status)
  doctor      diagnose setup

Global flags:
  --json      structured output on status / models / ping (agent-friendly)
  --version   print version
  --help      this help; "bansos <command> --help" for per-command help

Defaults:
  port 17070 (auto-bumps to 17090 when busy), bind 127.0.0.1,
  state at ~/.bansos/, config at ~/.bansos/config.json,
  log at ~/.bansos/logs/bansosd.log

Exit codes: 0 success, 1 error (daemon unreachable, unknown command/flag/model).

"start" without --bg runs foreground and blocks (Ctrl+C stops it).

Harnesses: claude-code, aider, opencode, codex, hermes, goose,
           openclaw, antigravity, jcode, 9router, continue, cline, roo, omp
           (pi via the separate extension)

Examples:
  bansos start --bg              # daemon in background, then:
  bansos setup codex             # wire Codex CLI to the router
  bansos ping big-pickle         # probe one model
  bansos status --json           # machine-readable status

"bansosd" still works as an alias for the daemon (e.g. "bansosd --bg").
`);
}

// per-command help shown by "bansos <cmd> --help" and "bansos help <cmd>"
const CMD_HELP: Record<string, string> = {
  start: `bansos start - start the daemon

Usage:
  bansos start [--bg] [--port N] [--bind H] [--unsafe-allow-non-loopback]

Flags:
  --bg          run detached; logs append to ~/.bansos/logs/bansosd.log
  --port, -p N  port to bind (default 17070, bumps +1 up to 17090 while busy)
  --bind H      address to bind (default 127.0.0.1; use 0.0.0.0 in containers)
  --unsafe-allow-non-loopback
                override strict-mode loopback protection (unsafe)

Notes:
  Without --bg the daemon runs foreground and blocks until Ctrl+C/SIGTERM.

Examples:
  bansos start --bg
  bansos start --bg --port 18000
`,
  autostart: `bansos autostart - start the daemon when you log in

Usage:
  bansos autostart [on|off|status] [--json]

How:
  Linux    systemd user service ~/.config/systemd/user/bansos-router.service
           (restarts the daemon if it crashes)
  macOS    LaunchAgent ~/Library/LaunchAgents/io.github.ihsan-ramadhan.bansos-router.plist
  Windows  bansos-router.cmd in the Startup folder (runs "bansos start --bg")

Notes:
  "on" starts the daemon right away unless one is already running; a running
  daemon is left alone and the service takes over at the next login.
  "off" only stops future logins from starting it; "bansos stop" stops the
  daemon. After moving node or reinstalling bansos elsewhere, run "on" again.

Exit codes: 0 success, 1 unsupported system or the service manager failed.
`,
  stop: `bansos stop - stop the daemon recorded in state.json (SIGTERM, then SIGKILL after 400ms)

Usage:
  bansos stop [--all]

Flags:
  --all     stop every bansos daemon on this machine, not just the recorded one

Notes:
  Without --all only the daemon in ~/.bansos/state.json is stopped, so a daemon
  started by someone else (or in another project) is left alone. If state.json
  names no live daemon, the command reports what else is running and exits 0.

Exit codes: 0 always (0 even when nothing was running).
`,
  setup: `bansos setup - write harness config files pointing at the router

Usage:
  bansos setup <harness...> [--model <id> | --models <id,...> --upstream <id,...>] [--dry-run] [--undo]

Flags:
  --model <id>        pin one model: the only model a harness gets
  --models <id,...>   write only these models (opencode, goose, openclaw,
                      continue; claude-code picks its tiers from them)
  --upstream <id,...> add every model of these upstreams (zen, kilo, llm7, ovh)
  --dry-run           print what would be written, change nothing
  --undo              remove bansos blocks/keys previously written by setup

Notes:
  Model ids come from "bansos models". With no model flag every live model is
  written, and single-model harnesses get the catalog default. --models and
  --upstream combine; --model cannot be mixed with them.
  Config locations are listed under each harness in docs/harnesses.md.

Examples:
  bansos setup codex
  bansos setup claude-code aider --model big-pickle
  bansos setup opencode --upstream zen --models kilo-auto/free
  bansos setup codex --undo
`,
  status: `bansos status - show daemon reachability and model count

Usage:
  bansos status [--json]

Flags:
  --json    emit { "daemons": [...] } instead of text

Probes ports 17070-17090 so a bumped-port daemon is still found.
Exit codes: 0 daemon reachable, 1 not reachable.
`,
  models: `bansos models - list the live model catalog

Usage:
  bansos models [--json]

Flags:
  --json    emit the raw /v1/models document instead of one id per line

Requires a running daemon (bansos start).
`,
  ping: `bansos ping - probe model health and latency with a tiny completion

Usage:
  bansos ping [model] [--json]

Arguments:
  model     id from "bansos models"; omit to probe every model in parallel

Flags:
  --json    emit { "results": [...], "summary": {...} } instead of a table

Notes:
  Probes set x-bansos-no-failover so the reported status is the model's own.
Exit codes: 0 at least one model answered, 1 all failed/unreachable.

Example:
  bansos ping mimo-v2.5-free
`,
  refresh: `bansos refresh - ask the daemon to re-run upstream health checks now

Usage:
  bansos refresh

Exit codes: 0 refreshed, 1 daemon unreachable.
`,
  logs: `bansos logs - tail ~/.bansos/logs/bansosd.log live

Usage:
  bansos logs [--activity]

Shows the last 50 lines of the daemon log, then follows appends (500ms poll).
Ctrl+C stops. Works for both "bansos start" (foreground) and "bansos start --bg":
the daemon now records every run to ~/.bansos/logs/bansosd.log.

  --activity   instead of the raw log file, print the structured request feed
              shown in the web UI "Activity" tab (model, tokens, latency,
              failover, status) - the same source the UI polls.
Exit codes: 1 when no log file exists yet (or the daemon is unreachable with --activity).
`,
  relay: `bansos relay - manage relay egress for keyless upstreams

Usage:
  bansos relay <on|off|status|url <URL>|use <URL>|list|remove <URL>|deploy>

Run "bansos relay" without arguments for the full subcommand list.
`,
  doctor: `bansos doctor - diagnose the local setup

Usage:
  bansos doctor

Checks daemon reachability and every harness config file, prints an update
notice when one exists.
Exit codes: 0 healthy, 1 any check failed.
`,
  usage: `bansos usage - show request usage and token totals

Usage:
  bansos usage [--json]

Flags:
  --json    emit the raw /bansos/usage document instead of a summary table

Requires a running daemon (bansos start). Aggregates cover the last 60 days,
kept in ~/.bansos/activity.json across restarts. Use the "Activity" tab in the web UI for a live, per-request feed.
Exit codes: 0 daemon reachable, 1 daemon unreachable.
`,
};

function isDaemonFlag(a: string | undefined): boolean {
  return a === "--port" || a === "-p" || a === "--bind" || a === "--bg" ||
    a === "--unsafe-allow-non-loopback";
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const invokedAs = path.basename(process.argv[1] ?? "");

  if (invokedAs === "bansosd" || argv[0] === "daemon" || isDaemonFlag(argv[0])) {
    await runDaemon(argv);
    return daemonExitCode();
  }

  const json = argv.includes("--json");
  const args = argv.filter((a) => a !== "--json");

  const wantsHelp = args.includes("--help") || args.includes("-h");
  const helpTarget = wantsHelp ? args[0] : args[0] === "help" ? args[1] : undefined;
  if (helpTarget && CMD_HELP[helpTarget]) {
    console.log(CMD_HELP[helpTarget]);
    return 0;
  }
  if (wantsHelp || args[0] === "help") {
    // unknown help target: fall through to dispatch so "bansos bogus --help" still errors
    if (args.length <= 1) {
      help();
      return 0;
    }
  }

  switch (args[0]) {
    case "setup":
      return runSetup(args.slice(1));
    case "start":
      return runStart(args.slice(1));
    case "stop":
      return runStop(args.slice(1));
    case "logs":
      return runLogs(args.slice(1));
    case "status":
      return runStatus(json);
    case "ping":
      return runPing(json ? [...args.slice(1), "--json"] : args.slice(1));
    case "models":
    case "refresh":
      return runStatusOrModels(args[0], json);
    case "usage":
      return runUsage(json);
    case "relay":
      return runRelay(args.slice(1));
    case "autostart":
      return runAutostart(args.slice(1), json);
    case "doctor":
      return runDoctor(args.slice(1));
    case "--version":
    case "-v":
      console.log(VERSION);
      return 0;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      help();
      return 0;
    default:
      console.error(`bansos: unknown command "${args[0]}"`);
      help();
      return 1;
  }
}

// preserve the daemon's startup-refusal exitCode instead of returning a literal 0
function daemonExitCode(): number {
  return typeof process.exitCode === "number" ? process.exitCode : 0;
}

async function runStart(args: string[]): Promise<number> {
  let bg = false;
  let port: number | undefined;
  let bind: string | undefined;
  let unsafeAllowNonLoopback = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--bg") bg = true;
    else if (a === "--port" || a === "-p") port = Number(args[++i]);
    else if (a === "--bind") bind = args[++i];
    else if (a === "--unsafe-allow-non-loopback") unsafeAllowNonLoopback = true;
    else {
      console.error(`bansos start: unknown flag "${a}"`);
      return 1;
    }
  }

  if (!bg) {
    // runs in-process and never returns; Ctrl+C or SIGTERM shuts it down
    await runDaemon(args);
    return daemonExitCode();
  }

  const running = await runningDaemonUrl(port);
  if (running) {
    console.log(`bansosd already running at ${running}`);
    return 0;
  }

  const logFile = path.join(BANSOS_DIR, "logs", "bansosd.log");
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const child = spawn(
    process.execPath,
    [
      ...process.execArgv,
      process.argv[1]!,
      "daemon",
      ...(port !== undefined ? ["--port", String(port)] : []),
      ...(bind !== undefined ? ["--bind", bind] : []),
      ...(unsafeAllowNonLoopback ? ["--unsafe-allow-non-loopback"] : []),
      "--bg-child",
    ],
    {
      stdio: ["ignore", "ignore", "ignore"] as unknown as import("node:child_process").StdioOptions,
      detached: true,
    },
  );
  child.unref();
  // handle spawn "error" in the "child is gone" check below so it never crashes the parent
  let spawnFailed = false;
  child.on("error", () => {
    spawnFailed = true;
  });
  // read the actual bound port from state.json (the child may auto-bump a taken port)
  const config = await import("../daemon/state").then((m) => m.loadConfig());
  let effectivePort = port ?? config.port ?? DEFAULT_PORT;
  let effectiveBind = bind ?? config.bind ?? "127.0.0.1";
  for (let i = 0; i < 100; i++) {
    const st = readJson<{ pid?: number; port?: number; bind?: string }>(STATE_FILE);
    if (st && st.pid === child.pid && typeof st.port === "number") {
      effectivePort = st.port;
      if (typeof st.bind === "string") effectiveBind = st.bind;
      break;
    }
    // child exited without writing state (e.g. bind refused); trust exitCode, not kill(pid,0)
    if (spawnFailed || child.exitCode !== null || child.signalCode !== null) {
      console.error(`bansos start --bg: daemon exited before binding (port ${effectivePort} busy or bind refused)`);
      console.error(`  check the log: ${logFile}`);
      return 1;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  const baseUrl = `http://${effectiveBind}:${effectivePort}`;

  console.log(`\n● bansosd started in background (pid ${child.pid})`);
  console.log(`  ├── Web UI   : ${baseUrl}`);
  console.log(`  ├── API Base : ${baseUrl}/v1`);
  console.log(`  └── Log file : ${logFile}`);
  console.log(`\nwatch logs live with: bansos logs\n`);
  return 0;
}

// tail the daemon log in real time for a --bg daemon (polls file size every 500ms)
async function runLogs(args: string[]): Promise<number> {
  const activity = args.includes("--activity");
  const base = `http://${effectiveBind()}:${effectivePort()}`;

  if (activity) {
    let res: Response;
    try {
      res = await fetch(`${base}/bansos/events?limit=100`);
    } catch {
      console.error(`bansos logs: daemon not reachable at ${base}. Start it with "bansos start"`);
      return 1;
    }
    if (!res.ok) {
      console.error(`bansos logs: daemon returned HTTP ${res.status}`);
      return 1;
    }
    const body = (await res.json()) as { events: Array<{
      id: number;
      timestamp: number;
      kind: string;
      model: string;
      upstream: string;
      inputTokens: number;
      outputTokens: number;
      durationMs: number;
      status: string;
      statusCode?: number;
      failoverFrom?: string;
    }> };
    if (body.events.length === 0) {
      console.log("(no activity yet)");
      return 0;
    }
    const time = (ts: number) => new Date(ts).toLocaleTimeString();
    const fmt = (n: number) =>
      n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);
    for (const e of body.events) {
      const status = e.status === "ok" ? "✓" : e.statusCode ? `✗ ${e.statusCode}` : "✗";
      const fo = e.failoverFrom ? ` (failover ${e.failoverFrom}->${e.model})` : "";
      console.log(
        `${time(e.timestamp)} ${status} ${e.kind} ${e.model} [${e.upstream}] ` +
          `${fmt(e.inputTokens)}/${fmt(e.outputTokens)} tok ${e.durationMs}ms${fo}`,
      );
    }
    return 0;
  }

  const logFile = path.join(BANSOS_DIR, "logs", "bansosd.log");
  if (!fs.existsSync(logFile)) {
    console.error(`bansos logs: no log file at ${logFile}`);
    console.error(`  the daemon writes one when started with: bansos start (or --bg)`);
    return 1;
  }

  // tail the last 50 lines from EOF before following, so a multi-MB log stays cheap (C1)
  const TAIL_WINDOW = 64 * 1024;
  const fd = fs.openSync(logFile, "r");
  let tail = "";
  let tailStart = 0;
  try {
    const size = fs.statSync(logFile).size;
    tailStart = Math.max(0, size - TAIL_WINDOW);
    const buf = Buffer.alloc(size - tailStart);
    fs.readSync(fd, buf, 0, buf.length, tailStart);
    tail = buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
  const lines = tail.split("\n");
  let context = lines.slice(Math.max(0, lines.length - 50));
  if (tailStart > 0 && context.length > 0) context = context.slice(1); // drop the partial first line
  if (context.some((l) => l !== "")) {
    process.stdout.write(`${context.join("\n").trimStart()}\n`);
  }
  process.stdout.write("(watching the daemon log, Ctrl+C to stop)\n");

  let size = fs.statSync(logFile).size;
  const timer = setInterval(() => {
    let st;
    try {
      st = fs.statSync(logFile);
    } catch {
      process.stdout.write("\nbansos logs: log file removed, stopping\n");
      process.exit(0);
    }
    if (st.size === size) return;
    if (st.size < size) size = 0; // truncated or rotated: read from the start again
    const fd = fs.openSync(logFile, "r");
    const buf = Buffer.alloc(st.size - size);
    fs.readSync(fd, buf, 0, buf.length, size);
    fs.closeSync(fd);
    size = st.size;
    process.stdout.write(buf.toString("utf8"));
  }, 500);

  return await new Promise<number>((resolve) => {
    process.once("SIGINT", () => {
      clearInterval(timer);
      resolve(0);
    });
    process.once("SIGTERM", () => {
      clearInterval(timer);
      resolve(0);
    });
  });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function findDaemonPids(statePid: number | null): number[] {
  const pids = new Set<number>();
  if (statePid && isAlive(statePid)) pids.add(statePid);

  // /proc is Linux-only; macOS/Windows fall back to a process-list scan
  if (process.platform === "linux" && fs.existsSync("/proc")) {
    for (const entry of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = Number(entry);
      if (pids.has(pid)) continue;
      try {
        const args = fs.readFileSync(`/proc/${entry}/cmdline`, "utf8").split("\0").filter(Boolean);
        if (isDaemonCmdline(args)) pids.add(pid);
      } catch {
        // process vanished mid-scan
      }
    }
  } else {
    for (const { pid, cmdline } of scanProcessList()) {
      if (!pids.has(pid) && isDaemonCmdline(cmdline.split(/\s+/))) pids.add(pid);
    }
  }
  return [...pids];
}

// Get-CimInstance replaces wmic, which Windows 11 24H2 no longer installs; base64 sidesteps command-line quoting
const WIN_PROCESS_LIST = Buffer.from(
  "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { \"$($_.ProcessId) $($_.CommandLine)\" }",
  "utf16le",
).toString("base64");

// cross-platform process list as "pid cmdline" lines (ps on POSIX, PowerShell on Windows); never throws
function scanProcessList(): Array<{ pid: number; cmdline: string }> {
  try {
    const out = process.platform === "win32"
      ? execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-EncodedCommand", WIN_PROCESS_LIST],
        { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
      )
      : execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const rows: Array<{ pid: number; cmdline: string }> = [];
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^\s*(\d+)\s+(.*)$/);
      if (m) rows.push({ pid: Number(m[1]), cmdline: m[2] ?? "" });
    }
    return rows;
  } catch {
    return [];
  }
}

// one of our daemons = the bansos binary (npm bin or dist/cli/index.js) in daemon mode
function isDaemonCmdline(args: string[]): boolean {
  const script = path.basename(args[1] ?? "");
  const cmd = args[2];
  if (script === "bansos" || script === "bansosd") {
    return (
      cmd === undefined ||
      cmd === "daemon" ||
      cmd === "start" ||
      cmd?.startsWith("--")
    );
  }
  return args.includes("daemon") || args.join(" ").includes("dist/daemon/index.js");
}

async function runStop(args: string[] = []): Promise<number> {
  const all = args.includes("--all");
  const state = readJson<{ pid?: number }>(STATE_FILE);

  // scoped by default so an unscoped stop does not kill daemons this shell never started
  let pids: number[];
  if (all) {
    pids = findDaemonPids(state?.pid ?? null);
  } else if (state?.pid && isAlive(state.pid)) {
    pids = [state.pid];
  } else {
    pids = [];
    const others = findDaemonPids(null);
    if (others.length > 0) {
      console.log(`no daemon recorded in state.json, but ${others.length} other daemon(s) are running`);
      console.log("  stop them with: bansos stop --all");
      return 0;
    }
  }

  if (pids.length === 0) {
    console.log("no daemon running");
    return 0;
  }
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  await new Promise((r) => setTimeout(r, 400));
  let stopped = 0;
  for (const pid of pids) {
    if (isAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // gone between checks
      }
    }
    stopped++;
  }
  fs.rmSync(STATE_FILE, { force: true });
  console.log(`stopped ${stopped} daemon(s)`);
  return 0;
}

interface DaemonStatus {
  status: string;
  port: number;
  modelCount: number;
  models: string[];
  relay?: { enabled: boolean; url: string };
}

// find daemons across the configured port, state.json's port, and the auto-bump range
async function probeDaemonPorts(): Promise<DaemonStatus[]> {
  const config = await import("../daemon/state").then((m) => m.loadConfig());
  const state = readJson<{ port?: number }>(STATE_FILE);
  const ports = new Set<number>([config.port]);
  if (state?.port) ports.add(state.port);
  for (let p = DEFAULT_PORT; p <= MAX_PORT; p++) ports.add(p);

  const results = await Promise.all(
    [...ports].map(async (port) => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/bansos/status`, {
          signal: AbortSignal.timeout(400),
        });
        if (!res.ok) return null;
        const body = (await res.json()) as DaemonStatus;
        return body.status === "ok" ? body : null;
      } catch {
        return null;
      }
    }),
  );
  return results
    .filter((r): r is DaemonStatus => r !== null)
    .sort((a, b) => a.port - b.port);
}

async function runStatus(json: boolean): Promise<number> {
  const daemons = await probeDaemonPorts();
  if (daemons.length === 0) {
    if (json) {
      console.log(JSON.stringify({ ok: false, daemons: [] }));
      return 1;
    }
    console.error(
      `bansos: no daemon reachable (probed ports ${DEFAULT_PORT}-${MAX_PORT}), start one with "bansos start"`,
    );
    const update = await checkUpdate();
    if (update.hasUpdate) {
      console.log(`\nUpdate available: ${update.current} -> ${update.latest} (run: npm i -g bansos-router)`);
    }
    return 1;
  }
  const update = await checkUpdate();
  if (json) {
    console.log(JSON.stringify({
      ok: true,
      daemons,
      ...(update.hasUpdate ? { updateAvailable: update.latest } : {}),
    }));
    return 0;
  }
  for (const [i, d] of daemons.entries()) {
    console.log(`daemon:   ok (port ${d.port})`);
    console.log(`models:   ${d.modelCount}`);
    if (d.relay?.enabled && d.relay.url) {
      console.log(`relay:    on (${d.relay.url})`);
    } else {
      console.log(`relay:    off (direct)`);
    }
    console.log(`alive:    ${d.models.join(", ") || "(none)"}`);
    if (i < daemons.length - 1) console.log("");
  }
  if (update.hasUpdate) {
    console.log(`\nUpdate available: ${update.current} -> ${update.latest} (run: npm i -g bansos-router)`);
  }
  return 0;
}

interface UsageCliShape {
  totalRequests: number;
  okRequests: number;
  errorRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  failoverCount: number;
  avgDurationMs: number;
  perModel: Record<string, { requests: number; ok: number; inputTokens: number; outputTokens: number }>;
  perUpstream: Record<string, { requests: number; ok: number }>;
}

async function runUsage(json: boolean): Promise<number> {
  const base = `http://${effectiveBind()}:${effectivePort()}`;

  let body: UsageCliShape;
  try {
    const res = await fetch(`${base}/bansos/usage`);
    if (!res.ok) {
      console.error(`bansos usage: daemon returned HTTP ${res.status}`);
      return 1;
    }
    body = (await res.json()) as {
      totalRequests: number;
      okRequests: number;
      errorRequests: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      failoverCount: number;
      avgDurationMs: number;
      perModel: Record<string, { requests: number; ok: number; inputTokens: number; outputTokens: number }>;
      perUpstream: Record<string, { requests: number; ok: number }>;
    };
  } catch {
    console.error(`bansos usage: daemon not reachable at ${base}. Start it with "bansos start"`);
    return 1;
  }

  if (json) {
    console.log(JSON.stringify(body));
    return 0;
  }

  const fmt = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);
  const dur = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

  console.log(`\n● usage summary (last 60 days)\n`);
  console.log(`  requests    : ${body.totalRequests} (${body.okRequests} ok, ${body.errorRequests} err)`);
  console.log(`  tokens in   : ${fmt(body.totalInputTokens)}`);
  console.log(`  tokens out  : ${fmt(body.totalOutputTokens)}`);
  console.log(`  avg latency : ${dur(body.avgDurationMs)}`);
  console.log(`  failovers   : ${body.failoverCount}`);

  const models = Object.entries(body.perModel).sort((a, b) => b[1].requests - a[1].requests);
  if (models.length > 0) {
    console.log(`\n  by model:`);
    for (const [m, s] of models) {
      console.log(`    ${m}  ${s.requests} reqs · ${fmt(s.inputTokens)}/${fmt(s.outputTokens)} tok`);
    }
  }

  const upstreams = Object.entries(body.perUpstream).sort((a, b) => b[1].requests - a[1].requests);
  if (upstreams.length > 0) {
    console.log(`\n  by upstream:`);
    for (const [u, s] of upstreams) {
      console.log(`    ${u}  ${s.requests} reqs`);
    }
  }
  console.log("");
  return 0;
}

async function runStatusOrModels(cmd: "status" | "models" | "refresh", json: boolean): Promise<number> {
  const base = `http://${effectiveBind()}:${effectivePort()}`;

  try {
    if (cmd === "models") {
      const res = await fetch(`${base}/v1/models`);
      const body = (await res.json()) as { data: Array<{ id: string }> };
      if (json) {
        console.log(JSON.stringify(body));
        return 0;
      }
      for (const m of body.data) console.log(m.id);
      return 0;
    }
    const res = await fetch(`${base}/bansos/refresh`, { method: "POST" });
    const body = (await res.json()) as { modelCount: number; alive: number };
    if (json) {
      console.log(JSON.stringify(body));
      return 0;
    }
    console.log(`refreshed: ${body.modelCount} model(s), ${body.alive} alive`);
    return 0;
  } catch {
    if (json) console.log(JSON.stringify({ ok: false, error: `daemon not reachable at ${base}` }));
    else console.error(`bansos: daemon not reachable at ${base}. Start it with "bansos start"`);
    return 1;
  }
}

process.exitCode = await main().catch((err) => {
  console.error(`bansos: ${String(err)}`);
  return 1;
});
