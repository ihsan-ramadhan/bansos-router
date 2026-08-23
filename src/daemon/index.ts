#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { loadConfig, writeJsonAtomic, STATE_FILE, BANSOS_DIR } from "./state";
import { createLogger } from "../logger";
import { buildUpstreams, SEEDED_MODELS } from "../upstreams";
import { VERSION } from "../update";
import { RuntimeCatalog } from "./catalog";
import { RateLimiter } from "./rate-limit";
import { createServer } from "./server";

export const DEFAULT_PORT = 17070;
export const MAX_PORT = 17090;

interface CliArgs {
  port?: number;
  bind?: string;
  bg: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { bg: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port" || arg === "-p") args.port = Number(argv[++i]);
    else if (arg === "--bind") args.bind = argv[++i];
    else if (arg === "--bg") args.bg = true;
    else if (arg === "--version" || arg === "-v") {
      console.log(VERSION);
      process.exit(0);
    }
    else if (arg === "--help" || arg === "-h") {
      console.log(`bansosd — local free-model router daemon

Usage:
  bansos start [--port N] [--bind H] [--bg]   (or: bansosd [--port N] [--bind H] [--bg])

Options:
  --port N    listen port (default: ${DEFAULT_PORT}, auto-bumps up to ${MAX_PORT})
  --bind H    bind address (default: 127.0.0.1)
  --bg        spawn detached, log to ~/.bansos/logs/bansosd.log
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
): Promise<{ server: http.Server; port: number; catalog: RuntimeCatalog }> {
  const log = createLogger({ prefix: "bansosd" });
  const config = loadConfig();
  const upstreams = buildUpstreams(config.localUpstreams);
  const catalog = new RuntimeCatalog(upstreams, log);

  // seed the pinned registry: usable offline, refined by health checks
  catalog.seed(SEEDED_MODELS);

  const startedAt = Date.now();
  const rateLimiter = new RateLimiter({
    limit: Number(process.env.BANSOS_RATE_LIMIT) || 300,
    windowMs: 60_000,
  });

  const server = createServer({ catalog, rateLimiter, port, log, startedAt });

  // initial health-check pass, then refresh on the configured interval
  void catalog.refresh();
  if (config.refreshIntervalMs > 0) {
    setInterval(() => void catalog.refresh(), config.refreshIntervalMs);
  }

  return new Promise((resolve, reject) => {
    const tryListen = (attempt: number) => {
      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && attempt < MAX_PORT) {
          log.warn(`port ${port} busy — trying ${port + 1}`);
          resolve(startServer(port + 1, bind));
          return;
        }
        reject(err);
      });
      server.listen(port, bind, () => resolve({ server, port, catalog }));
    };
    tryListen(0);
  });
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv[0] === "daemon" ? argv.slice(1) : argv);
  const log = createLogger({ prefix: "bansosd" });

  const config = loadConfig();
  const port = args.port ?? config.port ?? DEFAULT_PORT;
  const bind = args.bind ?? config.bind;

  if (args.bg) {
    const logDir = path.join(BANSOS_DIR, "logs");
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, "bansosd.log");
    const out = fs.openSync(logFile, "a");
    const child = spawn(
      process.execPath,
      [...process.execArgv, process.argv[1]!, "--port", String(port), "--bind", bind],
      {
        stdio: ["ignore", out, out] as unknown as import("node:child_process").StdioOptions,
        detached: true,
      },
    );
    child.unref();
    fs.closeSync(out);
    log.info(`started in background (pid ${child.pid}), log: ${logFile}`);
    return;
  }

  // run an initial health-check pass, then refresh periodically
  const { server, port: actualPort, catalog } = await startServer(port, bind);
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
