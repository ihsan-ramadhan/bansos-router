#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import stream from "node:stream";
import { spawn, spawnSync } from "node:child_process";
import {
  loadConfig,
  loadConfigWarnings,
  runningDaemonUrl,
  writeJsonAtomic,
  STATE_FILE,
  LOG_DIR,
  LOG_FILE,
  type BansosConfig,
} from "./state";
import { createLogger, type Logger } from "../logger";
import { assertBindAllowed } from "../security/policy";
import { buildUpstreams, SEEDED_MODELS } from "../upstreams";
import { VERSION } from "../update";
import { RuntimeCatalog } from "./catalog";
import { RateLimiter } from "./rate-limit";
import { ActivityStore } from "./activity";
import { createServer } from "./server";

export const DEFAULT_PORT = 17070;
export const MAX_PORT = 17090;

// C1: rotate the log past MAX_LOG_BYTES, keeping MAX_LOG_BACKUPS; best-effort
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_LOG_BACKUPS = 2;

function rotateLogFile(): void {
  try {
    for (let i = MAX_LOG_BACKUPS - 1; i >= 1; i--) {
      const from = `${LOG_FILE}.${i}`;
      const to = `${LOG_FILE}.${i + 1}`;
      if (fs.existsSync(to)) fs.unlinkSync(to);
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
    if (fs.existsSync(LOG_FILE)) fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch {
    // rotation is best-effort; keep appending if it fails
  }
}

// mutable ref so rotation can swap the write stream without the tee or logger noticing
function createTeeStream(
  a: NodeJS.WritableStream,
  bRef: { current: NodeJS.WritableStream },
): NodeJS.WritableStream {
  const tee = new stream.PassThrough();
  tee.on("data", (chunk) => {
    try {
      a.write(chunk);
    } catch {
      // ignore write errors on one destination
    }
    try {
      bRef.current.write(chunk);
    } catch {
      // ignore write errors on the other destination
    }
  });
  return tee;
}

interface CliArgs {
  port?: number;
  bind?: string;
  bg: boolean;
  unsafeAllowNonLoopback: boolean;
  bgChild: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { bg: false, unsafeAllowNonLoopback: false, bgChild: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port" || arg === "-p") args.port = Number(argv[++i]);
    else if (arg === "--bind") args.bind = argv[++i];
    else if (arg === "--bg") args.bg = true;
    else if (arg === "--bg-child") args.bgChild = true;
    else if (arg === "--unsafe-allow-non-loopback") args.unsafeAllowNonLoopback = true;
    else if (arg === "--version" || arg === "-v") {
      console.log(VERSION);
      process.exit(0);
    }
    else if (arg === "--help" || arg === "-h") {
      console.log(`bansosd - local free-model router daemon

Usage:
  bansos start [--port N] [--bind H] [--bg]   (or: bansosd [--port N] [--bind H] [--bg])

Options:
  --port N    listen port (default: ${DEFAULT_PORT}, auto-bumps up to ${MAX_PORT})
  --bind H    bind address (default: 127.0.0.1)
  --bg        spawn detached, log to ~/.bansos/logs/bansosd.log
  --unsafe-allow-non-loopback
              override strict-mode loopback protection (unsafe)
  -h, --help  show this help
`);
      process.exit(0);
    }
  }
  return args;
}

interface Running {
  server: http.Server;
  port: number;
  catalog: RuntimeCatalog;
  refreshTimer?: NodeJS.Timeout;
}

interface DaemonFlags {
  port: boolean;
  bind: boolean;
  unsafeAllowNonLoopback: boolean;
}

function startServer(
  port: number,
  requestedPort: number,
  bind: string,
  config: BansosConfig,
  log: ReturnType<typeof createLogger>,
  activity: ActivityStore,
  flags: DaemonFlags,
  restart: () => void,
): Promise<Running> {
  const upstreams = buildUpstreams(config.localUpstreams);
  const catalog = new RuntimeCatalog(upstreams, log, config.security);

  // seed the pinned registry: usable offline, refined by health checks
  catalog.seed(SEEDED_MODELS);

  const startedAt = Date.now();
  const rateLimiter = new RateLimiter({
    limit: Number(process.env.BANSOS_RATE_LIMIT) || 300,
    windowMs: 60_000,
  });

  const server = createServer({
    catalog,
    rateLimiter,
    port,
    log,
    startedAt,
    security: config.security,
    activity,
    admin: { requestedPort, bind, refreshIntervalMs: config.refreshIntervalMs, flags, restart },
  });

  return new Promise((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && port < MAX_PORT) {
        log.warn(`port ${port} busy - trying ${port + 1}`);
        resolve(startServer(port + 1, requestedPort, bind, config, log, activity, flags, restart));
        return;
      }
      reject(err);
    });
    server.listen(port, bind, () => {
      // the first refresh runs in boot() after the server listens
      const refreshTimer = config.refreshIntervalMs > 0
        ? setInterval(() => void catalog.refresh(), config.refreshIntervalMs)
        : undefined;
      resolve({ server, port, catalog, refreshTimer });
    });
  });
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv[0] === "daemon" ? argv.slice(1) : argv);

  const config = loadConfig();
  const port = args.port ?? config.port ?? DEFAULT_PORT;
  const bind = args.bind ?? config.bind;

  // a second daemon would only bump to the next port and split state.json and the activity log
  const running = args.bgChild ? null : await runningDaemonUrl(args.port);
  if (running) {
    console.log(`bansosd already running at ${running}`);
    return;
  }

  // always log to file (for `bansos logs`) and tee to stdout; built before the bind check
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const fileRef: { current: NodeJS.WritableStream } = {
    current: fs.createWriteStream(LOG_FILE, { flags: "a" }),
  };
  // rotate an oversized log before writing, and periodically (C1)
  try {
    if (fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) rotateLogFile();
  } catch {
    // no log file yet
  }
  const rotateTimer = setInterval(() => {
    try {
      if (fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) {
        fileRef.current.end();
        rotateLogFile();
        fileRef.current = fs.createWriteStream(LOG_FILE, { flags: "a" });
      }
    } catch {
      // stat or swap failed; try again on the next tick
    }
  }, 60_000);
  rotateTimer.unref();
  const out = createTeeStream(process.stdout, fileRef);
  const log = createLogger({ prefix: "bansosd", out });

  try {
    assertBindAllowed(bind, config.security, args.unsafeAllowNonLoopback);
  } catch (err) {
    // a bg child's output only reaches the log file; exit non-zero so start sees the failure
    log.error(String((err as Error)?.message ?? err));
    process.exitCode = 1;
    return;
  }

  if (args.bg) {
    // in --bg the child writes the log file itself through its rotating stream (C1)
    const child = spawn(
      process.execPath,
      [
        ...process.execArgv,
        process.argv[1]!,
        "daemon",
        ...(args.port !== undefined ? ["--port", String(args.port)] : []),
        ...(args.bind !== undefined ? ["--bind", args.bind] : []),
        ...(args.unsafeAllowNonLoopback ? ["--unsafe-allow-non-loopback"] : []),
        // marker so the child knows it is the file-backed instance
        "--bg-child",
      ],
      {
        stdio: ["ignore", "ignore", "ignore"] as unknown as import("node:child_process").StdioOptions,
        detached: true,
      },
    );
    child.unref();
    log.info(`started in background (pid ${child.pid}), log: ${LOG_FILE}`);
    return;
  }

  const activity = new ActivityStore();
  const flags: DaemonFlags = {
    port: args.port !== undefined,
    bind: args.bind !== undefined,
    unsafeAllowNonLoopback: args.unsafeAllowNonLoopback,
  };
  let current: (Running & { config: BansosConfig }) | null = null;
  let restarting = false;

  const boot = async (cfg: BansosConfig): Promise<void> => {
    const wantPort = args.port ?? cfg.port ?? DEFAULT_PORT;
    const wantBind = args.bind ?? cfg.bind;
    assertBindAllowed(wantBind, cfg.security, args.unsafeAllowNonLoopback);
    const running = await startServer(wantPort, wantPort, wantBind, cfg, log, activity, flags, () => void restart());
    current = { ...running, config: cfg };
    const actualPort = running.port;
    log.info(`bansosd listening on http://${wantBind}:${actualPort}`);
    // auto-start local opencode service if installed so Zen session integration is immediate
    ensureOpenCodeService(log);

    // publish the bound port before the first refresh; the --bg parent polls state.json for only 5s
    writeJsonAtomic(STATE_FILE, {
      pid: process.pid,
      port: actualPort,
      bind: wantBind,
      startedAt: Date.now(),
    });

    // banner goes through the tee, not stdout, so a bg child's banner still reaches `bansos logs`
    if (process.env.BANSOS_LOG !== "json") {
      out.write(
        `\n● bansosd online (port ${actualPort})\n` +
        `  ├── Web UI   : http://${wantBind}:${actualPort}\n` +
        `  └── API Base : http://${wantBind}:${actualPort}/v1\n\n`
      );
    }

    // not awaited: a restart counts as done once the server listens, so the next one is not dropped
    void running.catalog.refresh().then(() => {
      if (process.env.BANSOS_LOG !== "json") {
        out.write(
          `  └── Models   : ${running.catalog.servableModels.length} alive (${[...new Set(running.catalog.servableModels.map((m) => m.source))].join(", ")})\n\n`
        );
      }
    }, (err) => log.warn(`catalog refresh failed: ${String((err as Error)?.message ?? err)}`));
  };

  const stop = (running: Running): Promise<void> => {
    clearInterval(running.refreshTimer);
    return new Promise((resolve) => {
      running.server.close(() => resolve());
      running.server.closeAllConnections();
    });
  };

  const restart = async (): Promise<void> => {
    if (restarting || !current) return;
    restarting = true;
    const previous = current;
    log.info("restarting with the saved config");
    try {
      await stop(previous);
      for (const warning of loadConfigWarnings()) log.warn(warning);
      await boot(loadConfig());
    } catch (err) {
      log.error(`restart failed: ${String((err as Error)?.message ?? err)}; starting again with the previous settings`);
      try {
        await boot(previous.config);
      } catch (fallbackErr) {
        log.error(`could not start again: ${String((fallbackErr as Error)?.message ?? fallbackErr)}`);
        process.exit(1);
      }
    } finally {
      restarting = false;
    }
  };

  for (const warning of loadConfigWarnings()) log.warn(warning);
  await boot(config);

  const shutdown = () => {
    log.info("shutting down");
    if (!current) process.exit(0);
    current.server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export async function runDaemon(argv: string[]): Promise<void> {
  await main(argv);
}

export function ensureOpenCodeService(log?: Logger): void {
  let opencodePath = "";
  const whichCmd = process.platform === "win32" ? "where" : "which";
  try {
    const check = spawnSync(whichCmd, ["opencode"], { encoding: "utf-8", timeout: 1000 });
    if (check.status === 0 && check.stdout.trim()) {
      opencodePath = check.stdout.trim().split(/\r?\n/)[0]?.trim() ?? "";
    }
  } catch {}

  if (!opencodePath) return;

  const home = os.homedir();
  const serviceCandidates = [
    path.join(home, ".local", "state", "opencode", "service.json"),
    path.join(home, "Library", "Application Support", "opencode", "service.json"),
  ];
  if (process.env.LOCALAPPDATA) {
    serviceCandidates.push(path.join(process.env.LOCALAPPDATA, "opencode", "service.json"));
  }

  for (const servicePath of serviceCandidates) {
    try {
      if (fs.existsSync(servicePath)) {
        const raw = JSON.parse(fs.readFileSync(servicePath, "utf-8")) as unknown;
        if (raw && typeof raw === "object" && "pid" in raw && typeof raw.pid === "number") {
          process.kill(raw.pid, 0);
          return;
        }
      }
    } catch {}
  }

  try {
    const child = spawn(opencodePath, ["serve", "--service"], {
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    log?.info(`auto-started local opencode service (pid ${child.pid})`);
  } catch {}
}
