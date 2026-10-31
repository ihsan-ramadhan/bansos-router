# Contributing to bansos-router

Thanks for helping make free keyless models reachable from every coding harness. This guide covers local setup, the layout of the codebase, and the small set of conventions the project follows.

## Prerequisites

- [Bun](https://bun.sh) 1.3.14 (pinned by `packageManager`; `bun test --isolate` needs >= 1.3.13) — the only runtime for the root package
- Node.js 20+ and npm, only for `extensions/pi` (which runs inside the Node pi process)
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
bun install
bun run build      # build Web UI (Vite) + CLI (bun build), outputs dist/
bun link           # make `bansos`/`bansosd` available globally
bun run typecheck  # tsc --noEmit
bun run test       # node:test suites run by `bun test` (isolated per file)

bun run dev        # run the bansos CLI from source
bun run dev:daemon # run the daemon from source
bun run dev:ui     # run Vite dev server for the Web UI
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
  cli/bin.ts      runtime guard entry (refuses non-Bun) that defers to cli/index
scripts/          build-cli.ts (bun build split bundle), sync-version.mjs (copies the root version into extensions/pi)
  logger.ts       JSON line logger
extensions/pi/    pi coding agent extension (registers the bansosr provider)
docs/             architecture, protocols, harnesses, upstreams
test/             node:test suites, run by `bun test`
```

## Architecture in one minute

- The **daemon** (`src/daemon`) is a long running HTTP server bound to `127.0.0.1:17070` (auto bumps to `17090` if busy). It exposes `/v1/chat/completions`, `/v1/messages`, `/v1/responses`, `/v1/models`, the `/healthz` and `/bansos/*` control routes, and the Web UI dashboard on `/` (full list in `docs/protocols.md` §1). Every route except `/healthz`, the static UI and login/logout requires the router API key (`src/daemon/auth.ts`, `docs/protocols.md` §1.1); tests that build `createServer` pass `apiKey: null` unless they test auth.
- The **Web UI** (`src/ui`) provides a browser dashboard for exploring models, probing latency, generating and applying harness configs, managing relay egress, testing completions, following activity and logs, and editing settings.
- Inbound requests are translated to OpenAI Chat Completions (or Responses, for models that only serve it) and forwarded to a keyless upstream (OpenCode Zen, KiloCode, LLM7, or OVHcloud). The upstream reply is translated back to the caller's wire format.
- The **catalog** (`src/daemon/catalog.ts`) holds the live model registry. `resolve(id)` tolerates bare aliases (e.g. `laguna-xs-2.1:free` resolves to `poolside/laguna-xs-2.1:free`).
- **Relay egress** (`src/relay`) wraps outbound upstream calls through a user owned relay when enabled, using `x-relay-target` / `x-relay-path` headers.
- **Setup adapters** (`src/adapters`) render harness config. There is no plugin system: each adapter is a plain object describing its wire protocol, config path, and a pure render function.

## Conventions

- Keep it dependency free. There are no runtime deps at all: harness config reads use an inline JSONC stripper and a TOML-aware block writer in `src/cli/write.ts`, everything else is Node stdlib.
- Prefer stdlib over new packages. A regex JSONC stripper or a tiny semver compare is fine inline instead of a dependency.
- Cross platform paths must use `os.homedir()` (never `process.env.HOME`, which is undefined on Windows). Use `expandHome()` from `src/cli/write.ts`.
- Bun is the runtime: `node:` built-ins (fs, http, crypto, ...) are fine and preferred; use `bun:sqlite` for sqlite access. Don't rewrite working `node:` code to Bun-specific APIs just for style.
- Tests use the `node:test` API (with `node:assert`), run by `bun test`. Add a focused test for any new adapter, upstream, or protocol behavior.

## Adding a harness adapter

1. Open `src/adapters/index.ts`.
2. Add a function returning a `HarnessAdapter`:
   - `id`, `name`, `wire` (`chat` | `anthropic` | `responses`)
   - `configPaths` (first existing wins, or created)
   - `render(ctx)` returns `ConfigWrite[]` (mode `merge` for JSON, or `overwrite-block` for TOML/YAML with `START_MARKER`/`END_MARKER`)
   - `undoKeys` for JSON merge adapters (exactly the keys bansos added)
   - `keyEnv` only when the harness reads its key from an environment variable instead of the file (Goose: `BANSOS_API_KEY`)
3. Append it to the `ADAPTERS` array.
4. Add a test in `test/setup.test.ts` covering both the all models and `--model` cases. The `ADAPTERS` loop there also checks that every rendered config contains `ctx.apiKey`.

`ctx` carries `baseUrl`, `defaultModel`, `models` (the live catalog, minus upstreams strict mode blocks), `specificModel` (true when the user passed `--model`), and `apiKey`. Adapters that need an explicit model list (`opencode`, `goose`, `openclaw`, `continue`) should register all `ctx.models` unless `ctx.specificModel` is set.

`ctx.apiKey` is the router key the daemon requires. Write it wherever the harness takes its API key or bearer token, never a hard-coded placeholder. It is the real key for `bansos setup` and the dashboard's Apply, and `<BANSOS_API_KEY>` for `--dry-run`, `--undo` and the dashboard preview. The key is limited to `[A-Za-z0-9._~+/=-]`, so it is safe inside quoted TOML/YAML strings and env lines; quote it in YAML/TOML anyway.

## Adding an upstream

1. Create `src/upstreams/<name>.ts` exporting the `Upstream` object and a `ModelDef[]` list using `modelDef(...)`.
2. Add the models to `SEEDED_MODELS` in `src/upstreams/index.ts` so the daemon works offline.
3. Implement `fetchCatalog()` to return the live model list (or `null` on failure, which keeps last known models).

## Running tests

```bash
bun run test                 # all suites
bun test test/setup.test.ts  # one file (bunfig preloads test/isolate.ts for an isolated BANSOS_DIR)
```

Type checking and building must both pass before opening a pull request:

```bash
bun run typecheck && bun run test && bun run build
cd extensions/pi && npm run typecheck && npm run build
```

## Releasing

Bump the root version, then copy it into the extension with one command:

```bash
# bun pm version <x.y.z> --no-git-tag-version if your Bun supports it (check `bun pm version --help`),
# otherwise edit "version" in package.json by hand
bun run sync-version   # extensions/pi package.json, package-lock.json, EXTENSION_VERSION
```

## Roadmap

See `docs/architecture.md` §9 for the milestone plan (M0 through M5). One-click relay deploy (M4) and more upstreams (M5) are the next major items.
