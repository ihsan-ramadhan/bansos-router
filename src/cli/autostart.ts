import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { runningDaemonUrl } from "../daemon/state";

export type AutostartManager = "systemd" | "launchd" | "startup-folder";

export interface AutostartEnv {
  platform: NodeJS.Platform;
  home: string;
  appData?: string;
  uid?: number;
  command: string[];
  run(cmd: string, args: string[]): { ok: boolean; stdout: string };
}

export interface AutostartStatus {
  manager: AutostartManager | null;
  supported: boolean;
  reason?: string;
  enabled: boolean;
  path?: string;
  command?: string[];
  broken: boolean;
}

const UNIT = "bansos-router.service";
const LABEL = "io.github.ihsan-ramadhan.bansos-router";

export function defaultAutostartEnv(): AutostartEnv {
  const script = process.argv[1] ? path.resolve(process.argv[1]) : "";
  const home = os.homedir();
  const bunPath = (() => {
    try {
      const which = spawnSync("which", ["bun"], { encoding: "utf8", timeout: 1000 });
      if (which.status === 0 && which.stdout.trim() && fs.existsSync(which.stdout.trim())) {
        return which.stdout.trim();
      }
    } catch {}
    const candidates = [
      path.join(home, ".bun", "bin", "bun"),
      "/usr/local/bin/bun",
      "/usr/bin/bun",
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return null;
  })();
  const execPath = bunPath ?? process.execPath;
  return {
    platform: process.platform,
    home,
    appData: process.env.APPDATA,
    uid: typeof process.getuid === "function" ? process.getuid() : undefined,
    command: [execPath, ...process.execArgv, script],
    run(cmd, args) {
      try {
        return { ok: true, stdout: execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
      } catch {
        return { ok: false, stdout: "" };
      }
    },
  };
}

function managerFor(platform: NodeJS.Platform): AutostartManager | null {
  if (platform === "linux") return "systemd";
  if (platform === "darwin") return "launchd";
  if (platform === "win32") return "startup-folder";
  return null;
}

export function autostartPath(env: AutostartEnv): string | undefined {
  switch (managerFor(env.platform)) {
    case "systemd":
      return path.join(env.home, ".config", "systemd", "user", UNIT);
    case "launchd":
      return path.join(env.home, "Library", "LaunchAgents", `${LABEL}.plist`);
    case "startup-folder":
      return path.join(env.appData ?? path.join(env.home, "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "bansos-router.cmd");
    default:
      return undefined;
  }
}

const systemdQuote = (a: string) => `"${a.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%").replace(/\$/g, "$$$$")}"`;
const xmlEscape = (a: string) => a.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const xmlUnescape = (a: string) => a.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

// the supervisor owns the daemon, so it runs in the foreground; the startup folder has no supervisor, so it detaches
export function renderAutostart(env: AutostartEnv): string {
  switch (managerFor(env.platform)) {
    case "systemd":
      const extraPaths = [
        path.join(env.home, ".bun", "bin"),
        path.join(env.home, ".npm-global", "bin"),
        path.join(env.home, ".local", "bin"),
        "/usr/local/bin",
        "/usr/bin",
      ].join(":");
      return [
        "[Unit]",
        "Description=bansos-router daemon",
        "",
        "[Service]",
        `Environment="PATH=${extraPaths}"`,
        `ExecStart=${[...env.command, "daemon"].map(systemdQuote).join(" ")}`,
        "Restart=on-failure",
        "RestartSec=5",
        "",
        "[Install]",
        "WantedBy=default.target",
        "",
      ].join("\n");
    case "launchd":
      return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        "<dict>",
        `  <key>Label</key><string>${LABEL}</string>`,
        "  <key>ProgramArguments</key>",
        "  <array>",
        ...[...env.command, "daemon"].map((a) => `    <string>${xmlEscape(a)}</string>`),
        "  </array>",
        "  <key>RunAtLoad</key><true/>",
        "  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>",
        "</dict>",
        "</plist>",
        "",
      ].join("\n");
    case "startup-folder":
      return ["@echo off", `${[...env.command].map((a) => `"${a.replace(/%/g, "%%")}"`).join(" ")} start --bg`, ""].join("\r\n");
    default:
      return "";
  }
}

function parseCommand(manager: AutostartManager, text: string): string[] {
  if (manager === "systemd") {
    const line = text.split("\n").find((l) => l.startsWith("ExecStart=")) ?? "";
    return [...line.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) =>
      m[1]!.replace(/\\(.)/g, "$1").replace(/%%/g, "%").replace(/\$\$/g, "$"),
    );
  }
  if (manager === "launchd") {
    const array = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(text)?.[1] ?? "";
    return [...array.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => xmlUnescape(m[1]!));
  }
  return [...text.matchAll(/"([^"]*)"/g)].map((m) => m[1]!.replace(/%%/g, "%"));
}

function unsupportedReason(env: AutostartEnv): string | undefined {
  const manager = managerFor(env.platform);
  if (!manager) return `starting at login is not supported on ${env.platform}`;
  if (manager === "systemd" && !env.run("systemctl", ["--user", "show-environment"]).ok) {
    return "systemd user services are not available here; add `bansos start --bg` to your desktop's startup applications instead";
  }
  return undefined;
}

export function autostartStatus(env: AutostartEnv = defaultAutostartEnv()): AutostartStatus {
  const manager = managerFor(env.platform);
  const file = autostartPath(env);
  const reason = unsupportedReason(env);
  const installed = Boolean(file && fs.existsSync(file));
  const command = installed && manager ? parseCommand(manager, fs.readFileSync(file!, "utf8")) : undefined;
  const enabled = manager === "systemd" && !reason
    ? env.run("systemctl", ["--user", "is-enabled", UNIT]).stdout.trim() === "enabled"
    : installed;
  const broken = Boolean(command?.some((a) => path.isAbsolute(a) && !fs.existsSync(a)));
  return { manager, supported: !reason, ...(reason ? { reason } : {}), enabled, path: file, ...(command ? { command } : {}), broken };
}

// startNow is false when a daemon already runs, so the service waits for the next login instead of racing it for the port
export function enableAutostart(startNow: boolean, env: AutostartEnv = defaultAutostartEnv()): AutostartStatus {
  const reason = unsupportedReason(env);
  if (reason) throw new Error(reason);
  const file = autostartPath(env)!;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderAutostart(env));
  const manager = managerFor(env.platform);
  if (manager === "systemd") {
    env.run("systemctl", ["--user", "daemon-reload"]);
    if (!env.run("systemctl", ["--user", "enable", ...(startNow ? ["--now"] : []), UNIT]).ok) {
      fs.rmSync(file, { force: true });
      throw new Error(`systemctl --user enable ${UNIT} failed; check: systemctl --user status ${UNIT}`);
    }
  } else if (manager === "launchd" && startNow && env.uid !== undefined) {
    env.run("launchctl", ["bootstrap", `gui/${env.uid}`, file]);
  }
  return autostartStatus(env);
}

// leaves a running daemon alone: turning this off only stops the next login from starting one
export function disableAutostart(env: AutostartEnv = defaultAutostartEnv()): AutostartStatus {
  const file = autostartPath(env);
  if (managerFor(env.platform) === "systemd" && !unsupportedReason(env)) {
    env.run("systemctl", ["--user", "disable", UNIT]);
  }
  if (file) fs.rmSync(file, { force: true });
  if (managerFor(env.platform) === "systemd" && !unsupportedReason(env)) {
    env.run("systemctl", ["--user", "daemon-reload"]);
  }
  return autostartStatus(env);
}

function printStatus(s: AutostartStatus): void {
  if (!s.supported) {
    console.log(`autostart: unsupported (${s.reason})`);
    return;
  }
  console.log(`autostart: ${s.enabled ? "on" : "off"} (${s.manager})`);
  if (s.path) console.log(`file:      ${s.path}${s.enabled || s.command ? "" : " (not installed)"}`);
  if (s.command) console.log(`command:   ${s.command.join(" ")}`);
  if (s.broken) console.log(`warning:   the command points at a path that no longer exists; run "bansos autostart on" again`);
}

export async function runAutostart(argv: string[], json = false): Promise<number> {
  const cmd = argv[0] ?? "status";
  try {
    if (cmd === "status") {
      const s = autostartStatus();
      if (json) console.log(JSON.stringify(s, null, 2));
      else printStatus(s);
      return 0;
    }
    if (cmd === "on") {
      const running = (await runningDaemonUrl()) !== null;
      const s = enableAutostart(!running);
      if (json) {
        console.log(JSON.stringify(s, null, 2));
        return 0;
      }
      printStatus(s);
      if (s.manager === "startup-folder") {
        console.log(running ? "bansos will start at your next login." : 'bansos will start at your next login; run "bansos start --bg" to start it now.');
      } else if (running) {
        console.log("the daemon you are running now keeps going; the service takes over at your next login.");
      } else {
        console.log("started now, and at every login.");
      }
      if (s.manager === "systemd") console.log("to start before you log in: loginctl enable-linger $USER");
      return 0;
    }
    if (cmd === "off") {
      const s = disableAutostart();
      if (json) {
        console.log(JSON.stringify(s, null, 2));
        return 0;
      }
      printStatus(s);
      console.log('a daemon that is running now keeps going; stop it with "bansos stop".');
      return 0;
    }
  } catch (err) {
    console.error(`bansos autostart: ${(err as Error).message}`);
    return 1;
  }
  console.error(`bansos autostart: unknown subcommand "${cmd}" (use on, off or status)`);
  return 1;
}
