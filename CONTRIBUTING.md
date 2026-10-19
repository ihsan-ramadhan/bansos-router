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
  cli/            CLI commands: index (dispatch), setup, doctor, ping, write, relay, autostart
  adapters/       harness adapters (claude-code, opencode, goose, openclaw, continue, cline, roo, ...)
  protocols/      wire protocol parsing + translation (anthropic, openai-chat, responses, stream)
  upstreams/      keyless upstream definitions (zen, kilo, llm7, ovh, local) + catalog seeds
  daemon/         server, admin routes, catalog, activity, runtime state, static UI serving
  security/       strict mode policy and the DLP secret guard
  relay/          relay egress logic + vercel deploy stub (M4)
  ui/             web console dashboard (Preact, Vite)
  update.ts       npm registry version check (24h cache)
scripts/          sync-version.mjs (copies the root version into extensions/pi)
  logger.ts       JSON line logger
extensions/pi/    pi coding agent extension (registers the bansosr provider)
docs/             architecture, protocols, harnesses, upstreams
test/             node:test suites
```

## Architecture in one minute

- The **daemon** (`src/daemon`) is a long running HTTP server bound to `127.0.0.1:17070` (auto bumps to `17090` if busy). It exposes `/v1/chat/completions`, `/v1/messages`, `/v1/responses`, `/v1/models`, the `/healthz` and `/bansos/*` control routes, and the Web UI dashboard on `/` (full list in `docs/protocols.md` §1).
- The **Web UI** (`src/ui`) provides a browser dashboard for exploring models, probing latency, generating and applying harness configs, managing relay egress, testing completions, following activity and logs, and editing settings.
- Inbound requests are translated to OpenAI Chat Completions (or Responses, for models that only serve it) and forwarded to a keyless upstream (OpenCode Zen, KiloCode, LLM7, or OVHcloud). The upstream reply is translated back to the caller's wire format.
- The **catalog** (`src/daemon/catalog.ts`) holds the live model registry. `resolve(id)` tolerates bare aliases (e.g. `laguna-xs-2.1:free` resolves to `poolside/laguna-xs-2.1:free`).
- **Relay egress** (`src/relay`) wraps outbound upstream calls through a user owned relay when enabled, using `x-relay-target` / `x-relay-path` headers.
- **Setup adapters** (`src/adapters`) render harness config. There is no plugin system: each adapter is a plain object describing its wire protocol, config path, and a pure render function.

## Conventions

- Keep it dependency free. There are no runtime deps at all: harness config reads use an inline JSONC stripper and a TOML-aware block writer in `src/cli/write.ts`, everything else is Node stdlib.
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

`ctx` carries `baseUrl`, `defaultModel`, `models` (the live catalog, minus upstreams strict mode blocks), and `specificModel` (true when the user passed `--model`). Adapters that need an explicit model list (`opencode`, `goose`, `openclaw`, `continue`) should register all `ctx.models` unless `ctx.specificModel` is set.

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

## Releasing

Bump the root version, then copy it into the extension with one command:

```bash
npm version <x.y.z> --no-git-tag-version
npm run sync-version   # extensions/pi package.json, package-lock.json, EXTENSION_VERSION
```

## Roadmap

See `docs/architecture.md` §9 for the milestone plan (M0 through M5). One-click relay deploy (M4) and more upstreams (M5) are the next major items.
