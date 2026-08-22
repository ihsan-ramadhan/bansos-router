# Contributing to bansos-router

Thanks for helping make free keyless models reachable from every coding harness. This guide covers local setup, the layout of the codebase, and the small set of conventions the project follows.

## Prerequisites

- Node.js 20 or newer
- npm (ships with Node)
- A running `bansos` daemon for end to end testing (or start one with `bansos start --bg`)

## Fork workflow

1. Fork the repo on GitHub (button top right), then clone your fork:

   ```bash
   git clone https://github.com/<your-username>/bansos-router
   cd bansos-router
   git remote add upstream https://github.com/ihsan-ramadhan/bansos-router
   ```

2. Keep your fork in sync before starting work:

   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

3. Create a branch for the change, make it, then open a pull request against `ihsan-ramadhan/bansos-router:main`. The PR template will guide the description.

## Local setup

```bash
git clone https://github.com/ihsan-ramadhan/bansos-router
cd bansos-router
npm install
npm run build      # build Web UI (Vite) + CLI (esbuild), outputs dist/
npm link           # make `bansos`/`bansosd` available globally
npm run typecheck  # tsc --noEmit
npm test           # node --test (node:test, run with --test-concurrency=1)

npm run dev        # run the bansos CLI from source (tsx)
npm run dev:daemon # run the daemon from source (tsx)
npm run dev:ui     # run Vite dev server for the Web UI
```

The pi extension lives in `extensions/pi` and is published as a separate package (`pi-bansos-router`). Build and test it separately:

```bash
cd extensions/pi
npm install
npm run typecheck
npm run build      # esbuild, outputs extensions/pi/dist/index.js
```

## Project layout

```
src/
  cli/            CLI commands: index (dispatch), setup, doctor, ping, write, relay
  adapters/       harness adapters (claude-code, opencode, goose, openclaw, continue, cline, roo, ...)
  protocols/      wire protocol parsing + translation (anthropic, openai-chat, responses, stream)
  upstreams/      keyless upstream definitions (zen, kilo, llm7, local) + catalog seeds
  daemon/         server, catalog, runtime state, static UI serving, logging
  relay/          relay egress logic + vercel deploy stub (M4)
  ui/             web console dashboard (Preact, Vite)
  update.ts       npm registry version check (24h cache)
  logger.ts       JSON line logger
extensions/pi/    pi coding agent extension (registers the bansosr provider)
docs/             architecture, protocols, harnesses, upstreams
test/             node:test suites
```

## Architecture in one minute

- The **daemon** (`src/daemon`) is a long running HTTP server bound to `127.0.0.1:17070` (auto bumps to `17090` if busy). It exposes `/v1/chat/completions`, `/v1/messages`, `/v1/models`, `/healthz`, `/bansos/status`, `/bansos/refresh`, and the Web UI dashboard on `/`.
- The **Web UI** (`src/ui`) provides a browser dashboard for exploring models, probing latency, generating harness configs, managing relay egress, and testing completions.
- Inbound requests are translated to OpenAI Chat Completions and forwarded to a keyless upstream (OpenCode Zen, KiloCode, or LLM7). The upstream reply is translated back to the caller's wire format.
- The **catalog** (`src/daemon/catalog.ts`) holds the live model registry. `resolve(id)` tolerates bare aliases (e.g. `hy3:free` resolves to `tencent/hy3:free`).
- **Relay egress** (`src/relay`) wraps outbound upstream calls through a user owned relay when enabled, using `x-relay-target` / `x-relay-path` headers.
- **Setup adapters** (`src/adapters`) render harness config. There is no plugin system: each adapter is a plain object describing its wire protocol, config path, and a pure render function.

## Conventions

- Keep it dependency free where possible. The only runtime deps are `yaml` and `smol-toml` for harness config reads; everything else uses Node stdlib.
- Prefer stdlib over new packages. A regex JSONC stripper or a tiny semver compare is fine inline instead of a dependency.
- Cross platform paths must use `os.homedir()` (never `process.env.HOME`, which is undefined on Windows). Use `expandHome()` from `src/cli/write.ts`.
- Tests use the built in `node:test` runner. Add a focused test for any new adapter, upstream, or protocol behavior.

## Adding a harness adapter

1. Open `src/adapters/index.ts`.
2. Add a function returning a `HarnessAdapter`:
   - `id`, `name`, `wire` (`chat` | `anthropic` | `responses`)
   - `configPaths` (first existing wins, or created)
   - `render(ctx)` returns `ConfigWrite[]` (mode `merge` for JSON, or `overwrite-block` for TOML/YAML with `START_MARKER`/`END_MARKER`)
   - `undoKeys` for JSON merge adapters (exactly the keys bansos added)
3. Append it to the `ADAPTERS` array.
4. Add a test in `test/setup.test.ts` covering both the all models and `--model` cases.

`ctx` carries `baseUrl`, `defaultModel`, `models` (all live/seeded models), and `specificModel` (true when the user passed `--model`). Adapters that need an explicit model list (`opencode`, `goose`, `openclaw`) should register all `ctx.models` unless `ctx.specificModel` is set.

## Adding an upstream

1. Create `src/upstreams/<name>.ts` exporting the `Upstream` object and a `ModelDef[]` list using `modelDef(...)`.
2. Add the models to `SEEDED_MODELS` in `src/upstreams/index.ts` so the daemon works offline.
3. Implement `fetchCatalog()` to return the live model list (or `null` on failure, which keeps last known models).

## Running tests

```bash
npm test                                   # all suites
node --import tsx --test test/setup.test.ts # one file
```

Type checking and building must both pass before opening a pull request:

```bash
npm run typecheck && npm test && npm run build
cd extensions/pi && npm run typecheck && npm run build
```

## Roadmap

See `docs/architecture.md` for the milestone plan (M0 through M5). `/v1/responses` (M3, Codex CLI) and one click relay deploy (M4) are the next major items.
