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

function createTeeStream(
  a: NodeJS.WritableStream,
  b: NodeJS.WritableStream,
): NodeJS.WritableStream {
  const tee = new stream.PassThrough();
  tee.on("data", (chunk) => {
    try {
      a.write(chunk);
    } catch {
      // ignore write errors on one destination
    }
    try {
      b.write(chunk);
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
    const out = fs.openSync(LOG_FILE, "a");
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
        stdio: ["ignore", out, out] as unknown as import("node:child_process").StdioOptions,
        detached: true,
      },
    );
    child.unref();
    fs.closeSync(out);
    log.info(`started in background (pid ${child.pid}), log: ${LOG_FILE}`);
    return;
  }

  // foreground (and the --bg child): always log to a file so `bansos logs`
  // works in every mode, while still echoing to stdout for an interactive run.
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const isBgChild = args.bgChild === true;
  // In --bg mode the parent already redirected this child's stdout/stderr to
  // LOG_FILE, so log straight to stdout: a single writer to the file. Opening a
  // second handle to the same file would duplicate every line.
  const out = isBgChild
    ? process.stdout
    : (() => {
        const fileStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
        return createTeeStream(process.stdout, fileStream);
      })();
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
