# bansos-router

Free, keyless coding models for every coding harness, through one local
daemon. Works without accounts or API keys.

Status: M0, M1, and M2 are working. OpenAI Chat Completions
(`/v1/chat/completions`) and Anthropic Messages (`/v1/messages`) are live,
along with `bansos setup` and the pi extension. OpenAI Responses (for Codex
CLI) lands in M3. Full roadmap in `docs/architecture.md`.

## Quick start

```bash
npm i -g bansos-router
```

Start the daemon, then point a harness at it:

```bash
bansos start --bg       # detached daemon on 127.0.0.1:17070
bansos setup opencode   # writes the config for your harness
```

Open `http://127.0.0.1:17070` in your browser to access the Web UI dashboard (explore models, probe live latency, generate harness configs, manage relay egress, and test completions).

Any OpenAI-compatible or Anthropic-compatible client can now use
`http://127.0.0.1:17070` (chat at `/v1/chat/completions`, Claude Code at
`/v1/messages`). `bansos setup <harness>` merges or appends config blocks, and
`--undo` removes them again.

## CLI reference

| Command | Purpose |
|---|---|
| `bansos start [--bg] [--port N] [--bind H]` | Run the daemon (foreground, or detached with `--bg`) |
| `bansos logs` | Tail the daemon log in real time (for a `--bg` daemon), same output as `bansos start` |
| `bansos stop` | Stop all running daemons |
| `bansos status` | Daemon status (port, model count, alive models); reports every running daemon on the auto-bump range (17070-17090) |
| `bansos models` | List live catalog from `/v1/models` |
| `bansos ping [model]` | Probe live latency and rate-limit status of all models (or a specific model) |
| `bansos refresh` | Ask the daemon to re-run health checks now |
| `bansos setup <harness...> [--model <id>] [--dry-run] [--undo]` | Write, update, or undo harness configs |
| `bansos relay <on\|off\|status\|url\|use\|list\|remove>` | Manage relay egress (deploy comes in M4) |
| `bansos doctor` | Diagnose daemon reachability and harness config validity |
| `bansos --version` | Print version |
| `bansosd` | Alias for the daemon (e.g. `bansosd --bg`) |

Supported harnesses for `bansos setup`: `claude-code`, `aider`, `opencode`,
`hermes`, `goose`, `openclaw`, `antigravity`, `jcode`, `9router`, `continue`, `cline`, `roo`.
pi is handled by the separate extension. `codex` writes its config too, but its
`wire_api = "responses"` needs M3. See the roadmap.

## What it does

- One local daemon on `127.0.0.1:17070`, started with `bansos start`. Today it
  speaks two wire protocols: OpenAI Chat Completions and Anthropic Messages.
  OpenAI Responses, for Codex CLI, lands in M3.
- Keyless free upstreams only: OpenCode Zen, KiloCode gateway, and LLM7.
- `bansos setup <harness>` writes config for Claude Code, Aider, OpenCode,
  Codex, Hermes, Goose, OpenClaw, Antigravity, JCode, 9Router, Continue, Cline, and Roo Code.
- Web UI dashboard served at `http://127.0.0.1:17070/` with model catalog explorer,
  live ping probes, 1-click harness setup generator, relay egress manager, and test playground.
- The pi extension (`pi install npm:pi-bansos-router`) registers the `bansosr`
  provider, so every free model shows up in pi's `/model` picker. There is
  also a `/bansosr` command for status. If the daemon is not running when pi
  starts, the extension starts it and stops it again when pi exits. A daemon
  you started yourself is left alone.
- The catalog is health-checked: live `:free` models replace stale seeds on a
  timer. Relay egress can route around rate limits (bring your own relay URL,
  auto-deploy lands in M4), and there is a per-IP rate limiter.
- If a model is rejected with `429`/`5xx`, the daemon auto-fails over to the
  closest equivalent model on a different upstream (same reasoning level,
  context window, and effort capability), retrying up to two extra candidates
  before surfacing an error. Request duration (`durationMs`) is logged on every
  completion and rejection.

## Available models

All upstreams are text-only and keyless. By default, `bansos setup` automatically
registers all available free models into harnesses with explicit model lists (like
OpenCode, Goose, OpenClaw, and Continue), using `tencent/hy3:free` as the primary default.
Pass `--model <id>` if you wish to pin a specific single model. Context and max output
are token counts. The live catalog is ~33 models and changes as upstreams rotate
free tiers; run `bansos models` or `bansos ping` to see what is alive right now.

### OpenCode Zen

| model id | reasoning | context | max output |
|---|---|---|---|
| `x-preview-f-free` | yes | 1M | 65k |
| `mimo-v2.5-free` | no | 1M | 131k |
| `nemotron-3-ultra-free` | yes | 1M | 65k |
| `big-pickle` | yes | 200k | 32k |
| `laguna-s-2.1-free` | yes | 262k | 32k |
| `hy3-free` | yes | 256k | 65k |
| `nemotron-3.5-lightning-free` | yes | 1M | 65k |
| `muse-spark-1.2-contributor-free` | no | 1M | 65k |

### KiloCode gateway

| model id | reasoning | context | max output |
|---|---|---|---|
| `kilo-auto/free` | no | 256k | 10k |
| `stepfun/step-3.7-flash:free` | no | 262k | 262k |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | yes | 1M | 65k |
| `nvidia/nemotron-3-super-120b-a12b:free` | yes | 262k | 262k |
| `nvidia/nemotron-3.5-lightning:free` | yes | 1M | 65k |
| `nvidia/nemotron-3.5-content-safety:free` | yes | 128k | 8k |
| `tencent/hy3:free` | yes | 262k | 128k |
| `liquid/lfm-2.5-2.6b:free` | no | 128k | 8k |
| `dots-studio/dots-3-note-preview:free` | no | 128k | 8k |
| `poolside/laguna-s-2.1:free` | yes | 262k | 32k |
| `cohere/north-mini-code:free` | no | 256k | 64k |
| `poolside/laguna-xs-2.1:free` | no | 262k | 32k |
| `thinkingmachines/inkling:free` | no | 262k | 10k |
| `thinkingmachines/inkling-small:free` | no | 262k | 10k |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | yes | 256k | 65k |
| `openrouter/free` | no | 200k | 65k |

### LLM7

| model id | reasoning | context | max output |
|---|---|---|---|
| `DeepSeek-V4-Flash-0731` | yes | 400k | 131k |
| `meta-Llama-3.1-8B-Instruct-Turbo` | no | 128k | 16k |
| `gemini-3.1-flash-lite` | no | 256k | 65k |
| `minimax-m2.7` | yes | 180k | 32k |
| `gpt-oss:20b` | no | 128k | 16k |
| `mistral-Nemo-Instruct-2407` | no | 128k | 16k |
| `codestral-latest` | no | 32k | 8k |
| `default` | no | 128k | 8k |
| `fast` | no | 128k | 8k |

Notes:

- Kilo's `:free` models are liveness-gated: the daemon re-checks the kilo
  catalog on a timer and drops models that are no longer offered free.
- Zen's `/v1/models` lists *claude-\** ids that differ from the free coding
  models above, so the zen set is pinned to the seeded list.
- LLM7 models are filtered dynamically by `usage_based_only: false` (tier turbo);
  `default` and `fast` are stable selectors. `pro` tier is paid-only and excluded.

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
