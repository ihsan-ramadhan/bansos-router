# bansos-router — Architecture

> Status: **draft** · Not yet implemented. This document defines the target
> architecture before any code is written.

## 1. Vision

`bansos-router` ("bansos" = Indonesian for *bantuan sosial*, social aid) is a
**keyless free-model router for coding agents**. It aggregates free, no-account
LLM endpoints (OpenCode Zen, KiloCode gateway, …), exposes them through **one
local endpoint speaking the three major wire protocols**, and ships a
one-command setup for every major agent harness (pi, Claude Code, Aider,
OpenCode, Codex, Hermes, OpenClaw, Goose, Antigravity, JCode, …).

Core promise: **no accounts, no API keys, no cost — one local port, every
harness.**

```
┌─────────────────────────────── agent harnesses ───────────────────────────────┐
│  pi · Claude Code · Aider · OpenCode · Codex · Hermes · OpenClaw · Goose ·    │
│  Antigravity · JCode · Cline · Continue · …                                   │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                │  3 wire protocols
                ┌───────────────▼────────────────┐
                │          bansosd (daemon)       │
                │  run via: bansos start / --bg   │
                │  local-only, 127.0.0.1:17070   │
                │                                │
                │  /v1/chat/completions  (OpenAI) │
                │  /v1/messages         (Anthropic)│
                │  /v1/responses        (OpenAI)  │
                │  /v1/models                     │
                │                                │
                │  ┌──────────────────────────┐  │
                │  │ protocol translation     │  │
                │  │  inbound wire → internal │  │
                │  │  → upstream wire         │  │
                │  └──────────────────────────┘  │
                │  catalog · health-check · rate │
                │  limit · relay egress          │
                └───────────────┬────────────────┘
                                │  OpenAI Chat Completions (+ relay egress)
                ┌───────────────▼────────────────┐
                │   keyless free upstreams        │
                │   OpenCode Zen · KiloCode GW ·  │
                │   LLM7 (anonymous) ·            │
                │   (future: OpenRouter :free,    │
                │    Routeway, OVH, …)            │
                └────────────────────────────────┘
```

## 2. Goals / Non-goals

### Goals

1. **Keyless by default** — at least the flagship upstreams work with zero
   credentials (OpenCode Zen passthrough, KiloCode 200 req/hr/IP).
2. **One endpoint, three protocols** — any harness that can point at a custom
   OpenAI, Anthropic, or Responses base URL works out of the box.
3. **Only alive models** — startup + periodic health checks; dead/free-promo-
   expired models are never advertised.
4. **One-command setup** — `bansos setup <harness>` writes the correct config
   file for that harness. No manual config hunting.
5. **Relay rotation** — escape per-IP rate limits via user-owned Vercel /
   Cloudflare / Deno relays, toggled live.
6. **Portable daemon** — works standalone (no harness required to run the
   server) so every harness can share it.
7. **Optional local gateway chaining (roadmap M5)** — token-based local
   gateways (freebuff-proxy, LiteLLM, 9router, ollama) can be chained as
   **opt-in** local upstreams without polluting the keyless default set.
   v1 scope is **keyless upstreams only**.

### Non-goals (v1)

- **Not a paid gateway** — no billing, no credits, no team plans.
- **Not a model host** — we route to upstreams; we never run inference.
- **No BYOK management** — storing/rotating third-party API keys is out of
  scope initially (this is the deliberate difference from LiteLLM/Free-Way).
- **No token-based local gateways in v1** — chaining freebuff-proxy-style
  local gateways is roadmap M5; v1 ships keyless remote upstreams only.
- **No multi-user / multi-tenant** — single-user local tool.
- **No external telemetry** — privacy first; strictly local logs and diagnostics.
- **No protocol we don't need** — Gemini's `generateContent` is out of scope
  until a harness in scope actually requires it (Antigravity CLI speaks
  OpenAI-compatible, not Gemini-native).

## 3. Components

### 3.1 The daemon (long-running)

The core server, run via `bansos start` (foreground or `--bg`) or the
`bansosd` alias bin. Responsibilities:

| Concern | Design |
|---|---|
| HTTP server | Node `http`/Bun native server, bound to `127.0.0.1`, port `17070`, auto-bump to next free port up to `17090` (proven pattern from pi-bansos); port/bind configurable via `~/.bansos/config.json` |
| Inbound routes | `POST /v1/chat/completions`, `POST /v1/messages`, `GET /v1/models`, `GET /healthz`, `GET /bansos/status`, `POST /bansos/refresh` — all live; `POST /v1/responses` returns 501 until M3 |
| Catalog | Runtime catalog = static registry ∪ dynamic snapshots (LLM7 today; local gateways join in M5), filtered by liveness; served by `/v1/models`; **never forwarded upstream** (prevents paid-model leakage, see §6) |
| Health checker | At startup: fetch each upstream catalog, mark models alive/dead. Periodic refresh (configurable, e.g. every 30 min) + manual refresh via CLI |
| Protocol translation | Inbound wire → internal normalized turn → upstream Chat Completions. See `docs/protocols.md` |
| Rate limiter | Local per-IP limit (protects against accidental LAN exposure; upstreams have their own limits) |
| Relay egress | When enabled, upstream calls go through a user-owned relay via `x-relay-target` / `x-relay-path` headers (proven pattern). See `docs/upstreams.md` §8 |
| Request logging | Structured logs (JSON lines) to stdout + optional file; quiet by default |

### 3.2 `bansos` — the CLI (short-lived)

| Command | Purpose |
|---|---|
| `bansos setup <harness>` | Write/update the harness config (see `docs/harnesses.md`) |
| `bansos status` | Show daemon state: port, alive models, relay on/off, request count |
| `bansos models` | List catalog with liveness |
| `bansos ping [model]` | Probe live health, latency, and rate-limit status of models |
| `bansos refresh` | Re-run health checks now |
| `bansos relay on/off/status` | Toggle relay egress live |
| `bansos relay url <URL>` / `use <URL>` / `list` / `remove <URL>` | Manage saved relays |
| `bansos relay deploy` | Deploy a fresh Vercel relay (token used once, never stored) |
| `bansos doctor` | Diagnose: port conflicts, upstream reachability, harness config validity |
| `bansos start [--bg]` | Start the daemon (foreground, or detached with `--bg`) |
| `bansos stop` | Stop all running daemons (via `~/.bansos/state.json` + process scan) |
| `bansosd` | Alias bin for the daemon (same entry file as `bansos`) |

The CLI **does not require the daemon to be running** for setup/doctor
operations — it writes configs that point at `http://127.0.0.1:17070/v1`.

### 3.3 Harness adapters

Not code — **declarative config templates + a writer per harness**. Each
adapter knows: which wire protocol to use, where the config file lives, and
how to render it. A harness needs no plugin to work with bansos-router; the
only code adapter is the optional **pi extension** (package `pi-bansos-router`;
registers provider `bansosr` + `/bansosr` command, spawns the daemon on
demand, stops it again when pi exits if the extension spawned it).

## 4. Runtime topology

```
127.0.0.1:17070 ── bansosd ──► upstreams (direct, default)
        │                        │
        │                        └─► relay (optional) ──► upstreams
        │
        ├── pi (extension registers provider `bansosr`)
        ├── Claude Code  (ANTHROPIC_BASE_URL → /v1/messages)
        ├── Aider        (OPENAI_API_BASE → /v1/chat/completions)
        ├── Codex        (config.toml → /v1/responses, M3)
        └── …            (per-harness config)
```

- **Default bind is loopback only.** Listening on `0.0.0.0` is possible but
  explicitly discouraged; set it via `~/.bansos/config.json` (`"bind"`) with
  awareness of the risks.
- Daemon lifecycle: started manually (`bansos start`, or `bansosd`) or spawned
  on demand by the pi extension. A `bansos doctor` subcommand detects "daemon
  not running" and offers to start it. `bansos stop` kills every daemon
  process (state.json pid + `/proc` scan for the daemon binary).

## 5. State & persistence

Everything lives under `~/.bansos/` (outside any package dir, so npm updates
never wipe it):

```
~/.bansos/
├── config.json        # port, bind, refresh interval, default harness settings
├── state.json         # runtime state: alive catalog, request counts, relay state
├── relay-state.json   # saved relays + active relay + enabled flag
└── logs/              # optional structured logs
```

State files are plain JSON, never secret-bearing (keyless design).

## 6. Security model

| Threat | Mitigation |
|---|---|
| Remote abuse | Bind `127.0.0.1` by default; loopback-only opt-in |
| Paid-model leakage | `/v1/models` serves **only the curated alive catalog**, never the upstream catalog (OpenCode Zen returns ~60 models incl. paid) |
| Path/method abuse | Allowlist of paths + methods; reject traversal/encoded variants (pattern from pi-bansos) |
| Relay abuse | Relay allowlist (`ALLOWED_TARGETS`): only known upstream hosts may be targeted via `x-relay-target` |
| Secret handling | No keys stored. Vercel deploy token is used once in-memory, never persisted |
| Local abuse | Per-IP rate limit on the daemon itself |
| Local socket | No TLS needed (loopback); upstream calls are HTTPS |

## 7. Technology decisions (best practice)

### 7.1 Hard constraints

1. **Dual-runtime** — the core must run under both **Node** (standalone
   `bansosd`) and **Bun** (inside the pi extension, which pi loads into its
   own Bun process). Rule: use web-standard APIs only (`fetch`,
   `ReadableStream`, `TextEncoder`) plus `node:http` — both runtimes support
   them (proven by pi-bansos). No Node-only or Bun-only APIs in shared code.
2. **npm distribution** — `npm i -g bansos-router`, two bins.
3. **Minimal dependencies** — a proxy must be auditable; keep the tree tiny.

### 7.2 Decisions

| Layer | Decision | Rationale |
|---|---|---|
| Runtime | **TypeScript on Node ≥20** (target LTS 22), Bun-compatible style | Widest install base; reuse pi-bansos logic (TS); Bun as a dev/binary bonus |
| Language | TS strict, ES modules, `verbatimModuleSyntax`; `tsc --noEmit` for type-check only | No build-time type checking in the hot path |
| HTTP server | `node:http` — **no framework** | Raw streaming control; frameworks add nothing (pi-bansos proof) |
| Upstream client | global `fetch` + `duplex: "half"` | SSE pass-through; connection pooling built into undici |
| Streaming | async-iterator translation, **never buffer** a streaming response | Protocols.md T1–T8 require real-time SSE in all three wires |
| Config serializers | JSON (built-in) + `smol-toml` (Codex/Antigravity/JCode) + `yaml` (Hermes) | Setup CLI writes three config formats |
| CLI parsing | hand-rolled subcommand parser | Surface is small (`setup/status/relay/doctor`); no dep needed |
| State | JSON under `~/.bansos/`, **atomic writes** (temp file + rename) | Crash-safe, no DB, survives npm updates |
| Logging | hand-rolled JSON-lines logger, quiet by default | Proxy doesn't need pino-grade observability |
| Testing | `node:test` (+ `tsx` loader in dev) | Zero-dep; enough for unit + streaming integration tests |
| Build | **esbuild** → one bundle (`dist/cli/index.js`); bins `bansos` + `bansosd` point at it | Single-file entry, no runtime build dep; `tsx` only for dev |
| Process mgmt | `bansos start` foreground; `--bg` = detached spawn + log file; `bansos stop` = SIGTERM all daemon pids; `bansos status` = TCP health-check | `state.json` pid + `/proc` scan, no PID-file complexity |

### 7.3 Dependency budget

```
runtime (2): smol-toml, yaml
dev (4):    typescript, esbuild, tsx, @types/node
```

Everything else is standard library. This keeps the audit surface tiny and is
itself a differentiator (LiteLLM ships dozens of deps; freebuff-proxy vendors
its frontend and stealth libs).

### 7.4 Package layout

```
bansos-router/            # npm: bansos-router (bins: bansos, bansosd)
├── src/                  # core — Bun+Node compatible (web APIs + node:http)
├── dist/                 # esbuild output (gitignored; built by `prepare`)
├── extensions/pi/        # separate npm package: pi-bansos-router (planned)
│                         #   (pi installs packages from npm, not folders)
├── docs/
└── package.json          # engines: node >=20
```

### 7.5 Distribution options (phased)

1. **npm package** — primary; `npm i -g bansos-router`.
2. **`bun build --compile`** — optional native binaries per platform in GitHub
   Releases for users without Node (same TS core, zero language change).
3. **Go rewrite** — last resort, only if single-static-binary becomes the
   dominant requirement (that's the path freebuff-proxy took).

### 7.6 Open question (must be fixed before M0)

Self-built translation vs. wrapping **LiteLLM**. This doc assumes self-built.
If the Responses/Messages translation effort balloons, LiteLLM as an embedded
engine with bansos as a config generator is the fallback plan.

### 7.7 References (what we borrow from each)

| Repo | Language | What bansos-router reuses / learns |
|---|---|---|
| [`mannnrachman/pi-bansos`](https://github.com/mannnrachman/pi-bansos) | TypeScript (pi extension) | Keyless upstream patterns (Zen spoofed headers, Kilo keyless), startup health-check, relay egress (`x-relay-target`/`x-relay-path`), auto port bump, pi `registerProvider` + `/bansos` command |
| [`trefeon/freebuff-proxy`](https://github.com/trefeon/freebuff-proxy) | Go | Reference only (future M5 scope): production 3-wire translation in practice (chat / responses / messages), token pooling + bridge/hybrid modes, safe-mode stealth, registry refresh + per-token quota lock, admin dashboard, Go release tooling (goreleaser, service install) — its ban-risk hygiene rules inform our ToS guardrails |

## 8. Repository layout (planned)

```
bansos-router/
├── package.json            # bins: bansos, bansosd
├── src/
│   ├── logger.ts           # shared JSON-lines logger (hand-rolled)
│   ├── cli/                # bansos command (setup, status, relay, doctor)
│   │   ├── index.ts
│   │   ├── setup.ts        # per-harness config writers
│   │   ├── relay.ts
│   │   └── doctor.ts
│   ├── daemon/             # bansosd server
│   │   ├── index.ts        # entry, port bump, lifecycle
│   │   ├── server.ts       # http server + routing + static UI serving
│   │   ├── catalog.ts      # model registry + liveness
│   │   ├── rate-limit.ts
│   │   └── state.ts        # ~/.bansos persistence
│   ├── ui/                 # Web console dashboard (Preact + Vite)
│   ├── protocols/          # wire translation
│   │   ├── internal.ts     # normalized chat-turn model
│   │   ├── openai-chat.ts  # inbound/outbound Chat Completions
│   │   ├── anthropic.ts    # inbound Messages
│   │   ├── responses.ts    # inbound Responses
│   │   ├── index.ts        # protocol router (endpoint → parser)
│   │   └── stream.ts       # SSE translation helpers
│   ├── upstreams/          # sources + health checks
│   │   ├── index.ts        # registry (keyless defaults + configured locals)
│   │   ├── types.ts        # ModelDef / Upstream contracts
│   │   ├── zen.ts          # OpenCode Zen (keyless)
│   │   ├── kilo.ts         # KiloCode gateway (keyless)
│   │   ├── llm7.ts         # LLM7 (keyless, dynamic catalog)
│   │   ├── local.ts        # local OpenAI-compatible gateways
│   │   │                   #   (freebuff-proxy, LiteLLM, 9router, ollama)
│   │   └── types.ts
│   ├── relay/              # relay egress + deploy
│   │   ├── egress.ts       # x-relay-target forwarding
│   │   └── vercel.ts       # one-shot deploy
│   └── adapters/           # harness config templates
│       ├── index.ts        # registry + per-harness render (all harnesses)
│       ├── types.ts        # HarnessAdapter contract
│       │                   #   (pi lives in extensions/pi — separate package)
├── test/                   # node:test suites (SSE framing, rate limiter, …)
├── docs/
│   ├── architecture.md    # this file
│   ├── protocols.md
│   ├── harnesses.md
│   └── upstreams.md
├── README.md
└── LICENSE                # MIT
```

## 9. Milestones

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M0 — Core daemon** | Port pi-bansos core: server, path guards, rate limit, catalog, OpenCode Zen upstream, health check, `/v1/chat/completions` + `/v1/models` | `curl http://127.0.0.1:17070/v1/chat/completions` streams a reply; only alive models listed |
| **M1 — Anthropic wire** | `/v1/messages` translation (system, tools, thinking, SSE) | Claude Code works via `ANTHROPIC_BASE_URL` against bansosd |
| **M2 — Setup CLI** | `bansos setup` (9 harness adapters), `bansos start/stop`, `bansos status/models/doctor`, single `bansos` binary (+ `bansosd` alias) | Fresh machine: `npm i -g` → `bansos setup aider` → aider works |
| **M3 — Responses wire** | `/v1/responses` translation | Codex CLI works via `wire_api = "responses"` |
| **M4 — Relay UX** | `relay on/off/url/use/list/remove/deploy` + rotation | Rate-limit hit → relay on → back in business, no restart |
| **M5 — More upstreams** | OpenRouter `:free`, Routeway, OVHcloud anonymous tier, FreeBuff via `freebuff-proxy` (token-based local gateway, relay off), periodic health refresh | Catalog grows without breaking `/v1/models` contract |
