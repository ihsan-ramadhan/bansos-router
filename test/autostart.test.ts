import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  autostartStatus,
  disableAutostart,
  enableAutostart,
  renderAutostart,
  type AutostartEnv,
} from "../src/cli/autostart";
import { handleAdmin } from "../src/daemon/admin";
import { RuntimeCatalog } from "../src/daemon/catalog";
import { createLogger } from "../src/logger";
import type http from "node:http";

function fakeEnv(platform: NodeJS.Platform, opts: { systemd?: boolean; enabled?: boolean; enableFails?: boolean } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bansos-autostart-"));
  const node = path.join(home, "bin", "node");
  const script = path.join(home, "lib", platform === "win32" ? "50% dir" : "50% $HOME \"x\"", "index.js");
  fs.mkdirSync(path.dirname(node), { recursive: true });
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(node, "");
  fs.writeFileSync(script, "");
  const calls: string[] = [];
  let enabled = Boolean(opts.enabled);
  const env: AutostartEnv = {
    platform,
    home,
    uid: 1000,
    command: [node, script],
    run(cmd, args) {
      calls.push([cmd, ...args].join(" "));
      if (cmd !== "systemctl") return { ok: true, stdout: "" };
      if (opts.systemd === false) return { ok: false, stdout: "" };
      if (args[1] === "enable" && opts.enableFails) return { ok: false, stdout: "" };
      if (args[1] === "enable") enabled = true;
      if (args[1] === "disable") enabled = false;
      if (args[1] === "is-enabled") return { ok: enabled, stdout: enabled ? "enabled\n" : "disabled\n" };
      return { ok: true, stdout: "" };
    },
  };
  return { env, home, node, script, calls, cleanup: () => fs.rmSync(home, { recursive: true, force: true }) };
}

test("linux writes a systemd user unit that round-trips odd paths and survives a crash", () => {
  const f = fakeEnv("linux");
  try {
    const unit = renderAutostart(f.env);
    assert.match(unit, /^Restart=on-failure$/m);
    assert.match(unit, /^WantedBy=default\.target$/m);
    assert.match(unit, /%% \$\$HOME \\"x\\"/, "systemd specifiers, variables and quotes are escaped");

    const on = enableAutostart(false, f.env);
    assert.equal(on.enabled, true);
    assert.equal(on.manager, "systemd");
    assert.deepEqual(on.command, [f.node, f.script, "daemon"]);
    assert.equal(on.broken, false);
    assert.ok(f.calls.includes("systemctl --user daemon-reload"));
    assert.ok(f.calls.includes("systemctl --user enable bansos-router.service"), "a running daemon is not raced with --now");

    enableAutostart(true, f.env);
    assert.ok(f.calls.includes("systemctl --user enable --now bansos-router.service"));

    const off = disableAutostart(f.env);
    assert.equal(off.enabled, false);
    assert.ok(!fs.existsSync(on.path!));
    assert.ok(f.calls.includes("systemctl --user disable bansos-router.service"));
    assert.ok(!f.calls.some((c) => c.includes("stop")), "turning it off never stops the running daemon");
  } finally {
    f.cleanup();
  }
});

test("linux without a systemd user manager refuses and writes nothing", () => {
  const f = fakeEnv("linux", { systemd: false });
  try {
    const status = autostartStatus(f.env);
    assert.equal(status.supported, false);
    assert.match(status.reason ?? "", /startup applications/);
    assert.throws(() => enableAutostart(true, f.env), /systemd user services are not available/);
    assert.ok(!fs.existsSync(status.path!));
  } finally {
    f.cleanup();
  }
});

test("a failed systemctl enable leaves no half-installed unit behind", () => {
  const f = fakeEnv("linux", { enableFails: true });
  try {
    assert.throws(() => enableAutostart(true, f.env), /systemctl --user enable bansos-router.service failed/);
    assert.ok(!fs.existsSync(autostartStatus(f.env).path!));
  } finally {
    f.cleanup();
  }
});

test("a command whose node or script was moved is reported as broken", () => {
  const f = fakeEnv("linux");
  try {
    enableAutostart(false, f.env);
    fs.rmSync(f.node);
    assert.equal(autostartStatus(f.env).broken, true);
  } finally {
    f.cleanup();
  }
});

test("macOS writes a LaunchAgent that is not relaunched after bansos stop", () => {
  const f = fakeEnv("darwin");
  try {
    const plist = renderAutostart(f.env);
    assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
    assert.match(plist, /<key>KeepAlive<\/key><dict><key>SuccessfulExit<\/key><false\/><\/dict>/);

    const on = enableAutostart(false, f.env);
    assert.equal(on.enabled, true);
    assert.deepEqual(on.command, [f.node, f.script, "daemon"]);
    assert.ok(on.path!.endsWith(path.join("Library", "LaunchAgents", "io.github.ihsan-ramadhan.bansos-router.plist")));
    assert.ok(!f.calls.some((c) => c.startsWith("launchctl")), "a running daemon is left alone");

    enableAutostart(true, f.env);
    assert.ok(f.calls.includes(`launchctl bootstrap gui/1000 ${on.path}`));

    assert.equal(disableAutostart(f.env).enabled, false);
    assert.ok(!f.calls.some((c) => c.includes("bootout")));
  } finally {
    f.cleanup();
  }
});

test("windows drops a start --bg script into the Startup folder", () => {
  const f = fakeEnv("win32");
  try {
    const script = renderAutostart(f.env);
    assert.ok(script.includes("\r\n"), "cmd files use CRLF");
    assert.match(script, /50%% /, "cmd variables are escaped");
    assert.match(script, / start --bg\r\n$/);

    const on = enableAutostart(true, f.env);
    assert.equal(on.enabled, true);
    assert.ok(on.path!.endsWith(path.join("Startup", "bansos-router.cmd")));
    assert.deepEqual(on.command, [f.node, f.script]);
    assert.equal(disableAutostart(f.env).enabled, false);
  } finally {
    f.cleanup();
  }
});

test("the dashboard toggles start-at-login without starting a second daemon", async () => {
  const f = fakeEnv("linux");
  const opts = {
    security: { mode: "normal", dlp: "redact", allowedUpstreams: [], allowCrossProviderFailover: true, unsafeAllowNonLoopbackBind: false },
    catalog: new RuntimeCatalog([], createLogger({ level: "error" })),
    port: 17070,
    bind: "127.0.0.1",
    refreshIntervalMs: 0,
    autostartEnv: f.env,
  } as unknown as Parameters<typeof handleAdmin>[5];
  const req = { socket: { remoteAddress: "127.0.0.1" } } as http.IncomingMessage;
  const call = (method: string, body = "") => handleAdmin(req, method, "/bansos/autostart", "/bansos/autostart", async () => body, opts);
  try {
    assert.equal(((await call("GET")).body as { enabled: boolean }).enabled, false);
    const on = await call("POST", JSON.stringify({ enabled: true }));
    assert.equal(on.status, 200);
    assert.equal((on.body as { enabled: boolean }).enabled, true);
    assert.ok(!f.calls.some((c) => c.includes("--now")), "the daemon answering this request is already running");
    assert.equal((await call("POST", JSON.stringify({ enabled: "yes" }))).status, 400);
    const off = await call("POST", JSON.stringify({ enabled: false }));
    assert.equal((off.body as { enabled: boolean }).enabled, false);
  } finally {
    f.cleanup();
  }
});
