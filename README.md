<div align="center">

<img src="assets/logo-rounded.png" alt="bansos-router logo" width="140" />

# bansos-router

Free, keyless coding models for every coding harness, through one local daemon. Works without accounts or API keys.

</div>

<div align="center">

![npm version](https://img.shields.io/npm/v/bansos-router?color=blue&label=npm)
![npm downloads total](https://img.shields.io/npm/dt/bansos-router?color=informational&label=downloads)
![CI build](https://img.shields.io/github/actions/workflow/status/ihsan-ramadhan/bansos-router/ci.yml?branch=main&label=ci)
[![free models](https://img.shields.io/endpoint?url=https%3A%2F%2Fihsan-ramadhan.github.io%2Fbansos-router%2Fbadge.json)](https://ihsan-ramadhan.github.io/bansos-router/)
![License](https://img.shields.io/npm/l/bansos-router?color=lightgrey&label=license)

</div>

## Quick start

```bash
npm i -g bansos-router
```

Start the daemon and point your coding harness at it:

```bash
bansos start --bg       # detached daemon on 127.0.0.1:17070
bansos setup opencode   # configure any supported harness
```

For **[pi](https://github.com/earendil-works/pi)**, install the companion extension ([`extensions/pi`](extensions/pi/README.md)):

```bash
pi install npm:pi-bansos-router
```

Supported harnesses for `bansos setup`: `claude-code`, `aider`, `opencode`, `codex`, `hermes`, `goose`, `openclaw`, `antigravity`, `jcode`, `9router`, `continue`, `cline`, `roo`, and `omp`. See [docs/harnesses.md](docs/harnesses.md) for harness-specific details.

**OMP ([Oh My Pi](https://github.com/can1357/oh-my-pi))** can connect two ways, pick one:

- `bansos setup omp` writes a `bansos` provider into `~/.omp/agent/models.yml` (start the daemon yourself with `bansos start`).
- The pi extension loads in OMP too (it is a pi fork): `omp plugin install pi-bansos-router` registers a `bansosr` provider and auto-manages the daemon.

Using both is harmless but redundant: the IDs differ (`bansos` vs `bansosr`), so you get two providers listing the same models. Prefer one.

Open `http://127.0.0.1:17070` in your browser for the Web UI dashboard: model catalog with live latency ping, harness setup (preview or apply in one click), relay manager, playground, activity and usage, daemon logs, and settings (security mode, catalog refresh, port and bind, restart, health check).

### Start at login

```bash
bansos autostart on       # also: off, status
```

The daemon then starts whenever you log in, through the system's own service manager: a systemd user service on Linux, a LaunchAgent on macOS, a script in the Startup folder on Windows. On Linux and macOS it is also restarted if it crashes, while `bansos stop` still stops it for good. A daemon you are already running is left alone and the service takes over at the next login. The same switch is in the dashboard's Settings tab. On Linux, `loginctl enable-linger $USER` starts it at boot, before you log in.

### Always-on local protections

These hold in every mode (not just strict):

- **CORS only for loopback origins**: a page served from a non-loopback origin gets no CORS headers, so it can neither read nor write the daemon.
- **Host header validated**: loopback clients must present a loopback (or own-interface) Host header; anything else gets 403. This blocks DNS rebinding where a hostile page resolves to `127.0.0.1`.
- **Relay probe & mutation are SSRF-guarded**: probes may only target the active/saved relay or a public `https://` host; literal loopback, private, and link-local IPs (e.g. `169.254.x` metadata) are rejected unless explicitly saved. Relay URLs must be `http(s)://` without credentials.

## Docker

Run the daemon in a container instead of installing globally:

```bash
docker build -t bansos-router .
docker run -d --name bansos -p 17070:17070 -v bansos-data:/home/node/.bansos bansos-router
```

The container runs as the non-root `node` user (uid 1000); state lives in `/home/node/.bansos` inside the container, which is what the volume above mounts.

Or with compose:

```bash
docker compose up -d
```

- Image is a multi-stage build on node:22-alpine (~58 MB compressed), CLI + daemon + Web UI included, zero runtime dependencies.
- The container runs the daemon in the foreground (Docker owns the lifecycle) bound to `0.0.0.0`, with tini for correct signal forwarding and a healthcheck on `/healthz`.
- State persists across restarts in the `bansos-data` volume; point your harnesses at `http://127.0.0.1:17070` as usual.
- `docker compose logs -f` replaces `bansos logs` inside the container.

## CLI reference

| Command | Purpose |
|---|---|
| `bansos start [--bg] [--port N] [--bind H] [--unsafe-allow-non-loopback]` | Run the daemon (foreground, or detached with `--bg`) |
| `bansos logs [--activity]` | Tail the daemon log in real time (every mode: daemon always logs to `~/.bansos/logs/bansosd.log`); `--activity` prints the structured request feed shown in the web UI "Activity" tab |
| `bansos stop [--all]` | Stop the daemon recorded in `state.json`; `--all` stops every bansos daemon on the machine |
| `bansos status [--json]` | Daemon status (port, model count, alive models); reports every running daemon on the auto-bump range (17070-17090) |
| `bansos models [--json]` | List live catalog from `/v1/models` |
| `bansos ping [model] [--json]` | Probe live latency and rate-limit status of all models (or a specific model) |
| `bansos refresh` | Ask the daemon to re-run health checks now |
| `bansos usage [--json]` | Request counts and token totals per model and upstream (last 60 days) |
| `bansos setup <harness...> [--model <id> \| --models <id,...> --upstream <id,...>] [--dry-run] [--undo]` | Write, update, or undo harness configs |
| `bansos relay <on\|off\|status\|url\|use\|list\|remove>` | Manage relay egress |
| `bansos autostart <on\|off\|status> [--json]` | Start the daemon when you log in (systemd / launchd / Startup folder) |
| `bansos doctor` | Diagnose daemon reachability and harness config validity |
| `bansos --version` | Print version |
| `bansos <command> --help` / `bansos help <command>` | Per-command usage, defaults, exit codes, examples |
| `bansosd` | Alias for the daemon (e.g. `bansosd --bg`) |

## Strict security mode

Strict mode is opt-in and fail-closed. Add a `security` block to `~/.bansos/config.json` and explicitly list every provider that may receive requests:

```json
{
  "port": 17070,
  "bind": "127.0.0.1",
  "security": {
    "mode": "strict",
    "dlp": "redact",
    "allowedUpstreams": ["zen"],
    "allowCrossProviderFailover": false
  }
}
```

`mode` is case-insensitive. Any value other than `"strict"` or `"normal"` runs in normal mode, and the daemon log and `bansos doctor` flag it. The same settings can be changed from the dashboard's Settings tab; a security change applies live.

With `mode: "strict"`:

- Non-loopback binds rejected unless `--unsafe-allow-non-loopback` passed.
- Relay egress, probing, and mutation disabled across CLI, API, Web UI.
- Only exact upstreams in `allowedUpstreams` receive requests (empty list blocks all). Models from the other upstreams are left out of `/v1/models`, `bansos setup` and the smart default; the dashboard still lists them, marked blocked.
- Cross-provider failover disabled.
- Sensitive values and raw upstream errors suppressed from logs.
- **DLP keeps pasted credentials from leaving**: API keys, PATs, private keys, and credential assignments in a request bound for an external upstream (zen/kilo/llm7/ovh) are replaced with `[REDACTED:<type>]` before it is sent, so the rest of the message still goes through and the session keeps working. Set `"dlp": "block"` to reject such requests with HTTP 422 instead (note that a blocked secret stays in the session history, so every later request in that session is blocked too). Loopback (self-hosted) gateways are exempt, since their own keys are legitimately part of the request body.

## What it does

- One local daemon on `127.0.0.1:17070`, started with `bansos start`. It speaks three wire protocols: OpenAI Chat Completions, Anthropic Messages, and OpenAI Responses (Codex CLI).
- Keyless free upstreams only: OpenCode Zen, KiloCode gateway, LLM7, and OVHcloud AI Endpoints (anonymous tier).
  - *OpenCode Zen note*: Zen uses Cloudflare JA4 TLS fingerprinting and session affinity. It requires either Bun runtime or an OpenCode installation (installed via `curl -fsSL https://opencode.ai/v2/install | bash`, package managers, or `npm i -g @opencode/cli`). When OpenCode is installed, bansos-router automatically launches its background service. If neither is available, requests to Zen models transparently fail over to Kilo/LLM7/OVH free models.
- `bansos setup <harness>` writes config for Claude Code, Aider, OpenCode, Codex, Hermes, Goose, OpenClaw, Antigravity, JCode, 9Router, Continue, Cline, Roo Code, and OMP.
- Web UI dashboard served at `http://127.0.0.1:17070/`. The catalog shows per-model capabilities (Think / Vision badges) and live latency; the activity tab tracks requests, tokens, latency, and error rate; the settings tab edits `~/.bansos/config.json` and restarts the daemon.
- The pi extension ([`pi-bansos-router`](extensions/pi/README.md)) registers the `bansosr` provider, so every free model shows up in pi's `/model` picker. There is also a `/bansosr` command for status. If the daemon is not running when pi starts, the extension starts it and stops it again on exit.
- The catalog is health-checked: live `:free` models replace stale seeds on a timer. Relay egress can route around rate limits, and there is a per-IP rate limiter.
- If a model is rejected with `401`/`403`/`429`/`5xx`, the daemon auto-fails over to the closest equivalent model on a different upstream (same reasoning level, context window, and effort capability), retrying up to two extra candidates before surfacing an error. Request duration (`durationMs`) is logged on every completion and rejection.
- A model that answers `429` is parked for a cooldown, so the next request starts on a fallback instead of spending another round trip to learn the same thing. `Retry-After` sets the duration when the upstream sends one, otherwise it is a minute, capped at fifteen. Parked models stay listed in `/v1/models` and are still used when nothing else qualifies.
- A `401`/`403` means the upstream will not serve that model from where the request egressed (OpenCode Zen, for instance, returns `403 This service is not available in your region` when Cloudflare routes through a region its providers block). Retrying cannot help, so the model is parked for 30 minutes and the request fails over instead of returning the error. Send `x-bansos-no-failover: 1` when you want the model's own status back. The upstream's own message is logged alongside the status.

## Available models

By default, `bansos setup` automatically configures intelligent defaults per harness:
- **Claude Code**: Maps tiers automatically (`haiku` -> fast non-reasoning, `sonnet` -> daily reasoning, `opus` -> highest-capacity reasoning).
- **Multi-model harnesses** (`opencode`, `goose`, `openclaw`, `continue`): Registers all available models with the smart default (currently `muse-spark-1.3-contributor-free`) as primary.
- **Discovery harnesses** (`9router`, `omp`): Register a provider that lists models from `/v1/models` itself.
- **Single-model harnesses** (`aider`, `codex`, `hermes`, `antigravity`, `jcode`, `cline`, `roo`): Same smart default. Pass `--model <id>` to pin a specific model.

To write only some models, pass `--models <id,...>` and/or `--upstream <id,...>` (every model of that upstream), for example `bansos setup opencode --upstream zen --models kilo-auto/free`. Claude Code then picks its Haiku, Sonnet and Opus tiers from that set. The dashboard's Agent Setup tab has the same picker, with a checkbox per model and per upstream.

The model list changes as upstreams rotate their free tiers, so it lives on its own page: [ihsan-ramadhan.github.io/bansos-router](https://ihsan-ramadhan.github.io/bansos-router/). A GitHub Action runs the daemon's own catalog check every six hours and publishes the result there, with reasoning, vision, context and max output for each model, and as [`models.json`](https://ihsan-ramadhan.github.io/bansos-router/models.json). It checks from a GitHub datacenter, so run `bansos models` or `bansos ping` to see what your machine can reach.

Muse Spark answers only on the Responses API (`/v1/responses`) and returns HTTP 500 on chat completions. bansos-router translates the upstream leg both ways, so Muse works from any harness: chat completions, Responses, and Anthropic clients all see their usual wire format, tool calls included.

Notes:

- Kilo's `:free` models are liveness-gated: the daemon re-checks the kilo catalog on a timer and drops models that are no longer offered free.
- Zen seeds are re-checked against `GET /v1/models` on refresh. The listing is not exhaustive (some servable promos are never listed), so an unlisted seed is probe-verified keyless before being kept; a retired promo (e.g. `hy3-free`, gone and answering 401) disappears automatically.
- LLM7 models are filtered dynamically by `usage_based_only: false` (tier turbo); `default` and `fast` are stable selectors. `pro` tier is paid-only and excluded.
- OVH's anonymous tier allows only 2 requests per minute per IP, so its models mostly serve as failover targets. The `ovh/` prefix is local to bansos and stripped before the request leaves; a bare id like `gpt-oss-120b` resolves too.

## Development

For contributors working from source:

```bash
git clone https://github.com/ihsan-ramadhan/bansos-router
cd bansos-router
npm install
npm run build      # builds Web UI (Vite) + CLI (esbuild), outputs dist/
npm link           # make `bansos`/`bansosd` available globally
npm run typecheck  # tsc --noEmit
npm test           # node:test

npm run dev        # run the bansos CLI from source
npm run dev:daemon # run the daemon from source
npm run dev:ui     # run Vite dev server for Web UI
```

## Docs

- [Architecture](docs/architecture.md)
- [Wire protocols & translation](docs/protocols.md)
- [Harness integration](docs/harnesses.md)
- [Upstreams, catalog & relay](docs/upstreams.md)
- [Contributing](CONTRIBUTING.md)

## License

MIT
