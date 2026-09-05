#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import stream from "node:stream";
import { spawn } from "node:child_process";
import {
  loadConfig,
  writeJsonAtomic,
  STATE_FILE,
  BANSOS_DIR,
  type BansosConfig,
} from "./state";
import { createLogger } from "../logger";
import { assertBindAllowed } from "../security/policy";
import { buildUpstreams, SEEDED_MODELS } from "../upstreams";
import { VERSION } from "../update";
import { RuntimeCatalog } from "./catalog";
import { RateLimiter } from "./rate-limit";
import { ActivityStore } from "./activity";
import { createServer } from "./server";

export const DEFAULT_PORT = 17070;
export const MAX_PORT = 17090;

const LOG_DIR = path.join(BANSOS_DIR, "logs");
const LOG_FILE = path.join(LOG_DIR, "bansosd.log");

// C1: rotate the log when it outgrows MAX_LOG_BYTES, keeping MAX_LOG_BACKUPS
// old files. Best-effort: a failed rename never blocks the daemon.
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

// the file destination is held in a mutable ref so rotation can swap the
// underlying write stream without the tee or the logger noticing.
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

function startServer(
  port: number,
  bind: string,
  config: BansosConfig,
  log: ReturnType<typeof createLogger>,
): Promise<{ server: http.Server; port: number; catalog: RuntimeCatalog }> {
  const upstreams = buildUpstreams(config.localUpstreams);
  const catalog = new RuntimeCatalog(upstreams, log, config.security);

  // seed the pinned registry: usable offline, refined by health checks
  catalog.seed(SEEDED_MODELS);

  const startedAt = Date.now();
  const rateLimiter = new RateLimiter({
    limit: Number(process.env.BANSOS_RATE_LIMIT) || 300,
    windowMs: 60_000,
  });
  const activity = new ActivityStore();

  const server = createServer({
    catalog,
    rateLimiter,
    port,
    log,
    startedAt,
    security: config.security,
    activity,
  });

  // refresh on the configured interval (the first refresh runs in main()
  // after the server is listening, so the startup banner reflects live state)
  if (config.refreshIntervalMs > 0) {
    setInterval(() => void catalog.refresh(), config.refreshIntervalMs);
  }

  return new Promise((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && port < MAX_PORT) {
        log.warn(`port ${port} busy - trying ${port + 1}`);
        resolve(startServer(port + 1, bind, config, log));
        return;
      }
      reject(err);
    });
    server.listen(port, bind, () => resolve({ server, port, catalog }));
  });
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv[0] === "daemon" ? argv.slice(1) : argv);

  const config = loadConfig();
  const port = args.port ?? config.port ?? DEFAULT_PORT;
  const bind = args.bind ?? config.bind;
  assertBindAllowed(bind, config.security, args.unsafeAllowNonLoopback);

  if (args.bg) {
    const log = createLogger({ prefix: "bansosd" });
    fs.mkdirSync(LOG_DIR, { recursive: true });
    // stdout/stderr go to /dev/null: the child writes the log file itself
    // through its own rotating stream, so rotation keeps working in --bg mode
    // (C1). The child is the only writer to the file.
    const child = spawn(
      process.execPath,
      [
        ...process.execArgv,
        process.argv[1]!,
        "--port",
        String(port),
        "--bind",
        bind,
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

  // foreground (and the --bg child): always log to a file so `bansos logs`
  // works in every mode, while still echoing to stdout for an interactive run.
  // In --bg mode the child's stdout is /dev/null, so the rotating stream is
  // the only file writer; the tee keeps the two destinations in sync.
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const fileRef: { current: NodeJS.WritableStream } = {
    current: fs.createWriteStream(LOG_FILE, { flags: "a" }),
  };
  // rotate an oversized log before writing more, and periodically so a
  // long-lived daemon never grows one file forever (C1).
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

  // run an initial health-check pass, then refresh periodically
  const { server, port: actualPort, catalog } = await startServer(port, bind, config, log);
  log.info(`bansosd listening on http://${bind}:${actualPort}`);

  if (process.env.BANSOS_LOG !== "json") {
    process.stdout.write(
      `\n● bansosd online (port ${actualPort})\n` +
      `  ├── Web UI   : http://${bind}:${actualPort}\n` +
      `  └── API Base : http://${bind}:${actualPort}/v1\n\n`
    );
  }

  await catalog.refresh();

  if (process.env.BANSOS_LOG !== "json") {
    process.stdout.write(
      `  └── Models   : ${catalog.models.length} alive (${[...new Set(catalog.models.map((m) => m.source))].join(", ")})\n\n`
    );
  }

  writeJsonAtomic(STATE_FILE, {
    pid: process.pid,
    port: actualPort,
    bind,
    startedAt: Date.now(),
  });

  const shutdown = () => {
    log.info("shutting down");
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export async function runDaemon(argv: string[]): Promise<void> {
  await main(argv);
}
