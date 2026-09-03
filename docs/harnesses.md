# bansos-router: Harness Integration Matrix

> Companion to `architecture.md`. Defines how each agent harness connects to
> the daemon, and what `bansos setup <harness>` writes.

## 1. Principles

1. **Config, not plugins.** Almost every harness accepts a custom base URL.
   `bansos setup` only ever writes declarative config files (or env in the
   user's shell rc): no per-harness code except the optional pi extension.
2. **Protocol selection is automatic.** The adapter picks the right endpoint
   (`/v1/chat/completions`, `/v1/messages`, or `/v1/responses`) for the
   harness's native wire format.
3. **Idempotent & reversible.** `setup` never overwrites user edits blindly  - 
   it writes a clearly-marked block, and `bansos setup <harness> --undo`
   removes it.
4. **No secrets written.** The daemon accepts any placeholder key
   (e.g. `bansos`); adapters never invent or persist real credentials.

## 2. Matrix

Legend: 🟢 config-only · 🟢* config-only but needs M3 wire (not live yet) · 🟡 config + small adapter · 🔵 works manually, no `bansos setup` adapter yet · 🔴 not supported (v1)

| Harness | Wire | Config location | Effort | Notes |
|---|---|---|---|---|
| **pi** | OpenAI Chat | extension (`registerProvider`) | 🟡 | Only code adapter: provider `bansosr` + `/bansosr` command, spawns daemon on demand, stops it again on exit if it spawned it |
| **Claude Code** | Anthropic Messages | `~/.claude/settings.json` (`env`) | 🟢 | `ANTHROPIC_BASE_URL=http://127.0.0.1:17070` + `ANTHROPIC_AUTH_TOKEN=bansos` + model mappings |
| **Aider** | OpenAI Chat | env / `aider.conf.yml` | 🟢 | `OPENAI_API_BASE=http://127.0.0.1:17070/v1`, `OPENAI_API_KEY=bansos`, `AIDER_MODEL=<id>` |
| **OpenCode** | OpenAI Chat | `~/.config/opencode/opencode.json` | 🟢 | Custom provider with `@ai-sdk/openai-compatible`, `baseURL` |
| **Codex CLI** | OpenAI Responses | `~/.codex/config.toml` | 🟢 | `[model_providers.bansos] base_url`, `wire_api = "responses"`: daemon serves `/v1/responses` (M3) |
| **Hermes (Nous)** | OpenAI Chat | `~/.hermes/config.yaml` | 🟢 | `model.provider: custom` + `model.base_url` |
| **OpenClaw** | OpenAI Chat or Anthropic | `~/.openclaw/config.json` / agent `models.json` | 🟢 | `models.providers.<id>.baseUrl`; can pick either wire |
| **Goose** | OpenAI Chat | `~/.config/goose/custom_providers/*.json` | 🟢 | `engine: "openai"`, `base_url`, model list |
| **Antigravity CLI** | OpenAI Chat | `~/.config/antigravity/config.toml` | 🟢 | `base_url`, `model`, `api_key_env` (or inline) |
| **JCode** | OpenAI Chat | `~/.jcode/config.toml` | 🟢 | `[providers.bansos] type="openai-compatible"`, `base_url` |
| **9Router** | OpenAI Chat | `~/.9router/db.json` | 🟢 | Custom compatible `providerNodes` + `providerConnections` |
| **Continue** | OpenAI Chat | `~/.continue/config.json` | 🟢 | Appends/merges OpenAI provider entries in `models` array |
| **Cline** | OpenAI Chat | `~/.config/cline/config.json` | 🟢 | Sets `apiProvider: "openai-compatible"`, `openAiBaseUrl` |
| **Roo Code** | OpenAI Chat | `~/.config/roo-cline/config.json` | 🟢 | Sets `apiProvider: "openai-compatible"`, `openAiBaseUrl` |
| **Claude Desktop** | Anthropic Messages |- | 🔴 | No supported custom base URL; out of scope (hacky MITM only) |
| **Copilot CLI** |- |- | 🔴 | OAuth-only, no custom endpoint |
| **Gemini CLI** |- |- | 🔴 | Retired (June 2026) -> Antigravity CLI |

## 3. Adapter contract (implementation spec)

```ts
type HarnessAdapter = {
  id: string;                 // "claude-code", "aider", ...
  name: string;               // human-readable
  wire: "chat" | "anthropic" | "responses";
  configPaths: string[];      // candidate locations, first existing wins (or create)
  render(ctx: SetupCtx): ConfigWrite[];  // ordered file writes
  undo(ctx: SetupCtx): void;  // remove only the bansos-marked block
};
type SetupCtx = {
  baseUrl: string;            // http://127.0.0.1:<port>
  defaultModel: string;       // from catalog or CLI flag
  models: ModelDef[];         // alive catalog snapshot
};
type ConfigWrite = {
  path: string;
  content: string;
  mode?: "merge" | "overwrite-block"; // block = wrapped in markers
  markers?: [string, string]; // e.g. <!-- bansos-router:start -->
};
```

### 3.1 Write modes

`bansos setup <harness>` writes with `--undo` support in two modes:

- **JSON targets** (Claude Code `settings.json`, OpenCode, Goose, OpenClaw):
  the existing file is parsed, the bansos fragment is deep-merged, and the
  file is re-serialized as valid JSON. `--undo` removes exactly the keys
  bansos added (per-adapter `undoKeys`), never touching user keys.
- **Non-JSON formats** (TOML, YAML, env: Aider, Codex, Hermes, Antigravity,
  JCode): a marked block (`# bansos-router:start` / `# ...:end`) is replaced or
  appended; `--undo` deletes between the markers.

### 3.2 Env-based adapters (Aider, Claude Code)

Claude Code and Aider can take env vars. The adapter offers two modes:

- **settings-file mode** (default): write into the harness's native config
  (`~/.claude/settings.json` `env` block / `aider.conf.yml`).
- **shell-rc mode** (`--rc`): *(planned)* append `export` lines to
  `~/.bashrc`/`~/.zshrc` inside markers. Preferred by users who want the
  change only in one shell.

### 3.3 Model pinning & smart tiering

`bansos setup <harness> --model <id>` pins one specific model. Without `--model`, adapters apply intelligent defaults:
- **Claude Code**: Maps tiers automatically (`haiku` -> fast non-reasoning, `sonnet` -> daily reasoning, `opus` -> highest-capacity reasoning) and sets `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`.
- **OpenCode, Goose, OpenClaw, Continue**: Register all catalog models so every model is selectable in the harness.
- **Aider, Codex, Hermes, Antigravity, JCode, Cline, Roo, 9Router**: Default to the smart primary model (highest-context reasoning model in the catalog, currently `minimax/minimax-m3:free` at 1M) and switch freely via `/v1/models`.

## 4. Per-harness setup snippets (target output)

### Claude Code: `~/.claude/settings.json`

```jsonc
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:17070",
    "ANTHROPIC_AUTH_TOKEN": "bansos",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "<fast-non-reasoning-id>",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "<flagship-reasoning-id>",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "<top-capacity-reasoning-id>",
    "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS": "1"
  }
}
```

### Aider

```bash
export OPENAI_API_BASE=http://127.0.0.1:17070/v1
export OPENAI_API_KEY=bansos
export AIDER_MODEL=<id>
# or: aider --openai-api-base http://127.0.0.1:17070/v1 --model <id>
```

### OpenCode: `~/.config/opencode/opencode.json`

```jsonc
{
  "provider": {
    "bansos": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "http://127.0.0.1:17070/v1" },
      "models": {
        "mimo-v2.5-free": {},
        "nemotron-3-ultra-free": {},
        "big-pickle": {},
        "ling-3.0-flash-fin-free": {}
        // ... all live free models registered by default
      }
    }
  }
}
```

### Codex: `~/.codex/config.toml`

```toml
model = "<id>"
model_provider = "bansos"
[model_providers.bansos]
name = "Bansos Router"
base_url = "http://127.0.0.1:17070/v1"
wire_api = "responses"
experimental_bearer_token = "bansos"   # keyless: router ignores auth; any token works
```

### Hermes: `~/.hermes/config.yaml`

```yaml
model:
  provider: custom
  default: "<id>"
  base_url: "http://127.0.0.1:17070/v1"
```

### OpenClaw: config `models.providers`

```jsonc
{ "models": { "providers": { "bansos": {
    "baseUrl": "http://127.0.0.1:17070/v1",
    "models": [{ "id": "<id>" }] } } } }
```

### Goose: `~/.config/goose/custom_providers/bansos.json`

```json
{ "name": "bansos", "engine": "openai",
  "display_name": "Bansos Router",
  "base_url": "http://127.0.0.1:17070/v1",
  "models": [{ "name": "<id>", "context_limit": 256000 }] }
```

### Antigravity: `~/.config/antigravity/config.toml`

```toml
base_url = "http://127.0.0.1:17070/v1"
model = "<id>"
api_key = "bansos"
```

### JCode: `~/.jcode/config.toml`

```toml
default_provider = "bansos"
default_model = "<id>"

[providers.bansos]
type = "openai-compatible"
base_url = "http://127.0.0.1:17070/v1"
```

### 9Router: `~/.9router/db.json`

```jsonc
{
  "providerNodes": [
    {
      "id": "bansos",
      "name": "Bansos Router",
      "type": "custom",
      "prefix": "bansos",
      "apiType": "openai",
      "baseUrl": "http://127.0.0.1:17070/v1"
    }
  ],
  "providerConnections": [
    {
      "id": "bansos-default",
      "provider": "bansos",
      "authType": "api_key",
      "name": "Bansos Router",
      "priority": 1,
      "isActive": true,
      "apiKey": "bansos"
    }
  ]
}
```

### pi: extension (the only code adapter)

Package `pi-bansos-router` (`pi install npm:pi-bansos-router`). Registers the
`bansosr` provider (base URL `http://127.0.0.1:17070/v1`, `api:
"openai-completions"`), fetches the live model list from `/v1/models`, and
registers a `/bansosr` status command:

```ts
pi.registerProvider("bansosr", {
  baseUrl: "http://127.0.0.1:17070/v1",
  apiKey: "bansos",
  api: "openai-completions",
  models: aliveModels.map(toPiModel),
});
pi.registerCommand("bansosr", { /* status */ });
```

Daemon lifecycle: if the daemon is not running when pi starts, the extension
spawns it (`bansos start --bg`); if the extension spawned it, it stops it
again on `session_shutdown`. A daemon started manually by the user is left
running.

## 5. Setup flows

### Fresh install (any harness)

```
npm i -g bansos-router
bansos setup aider --model deepseek-v4-flash-free
# writes OPENAI_API_BASE etc. (or shell rc)
bansos start       # start daemon (or: bansos doctor -> "start it?" -> yes)
aider              # works
```

### Claude Code

```
bansos setup claude-code
bansos doctor
claude
# /model -> picks from /v1/models
```

### Multi-harness

`bansos setup claude-code aider opencode codex`: all configs written, all
pointing at the same daemon. Rate limits are shared across harnesses (see
`docs/upstreams.md` §7): relay becomes the escape hatch. (pi is not a
`bansos setup` harness; install the `pi-bansos-router` extension instead.)

## 6. Verification (`bansos doctor`)

For each configured harness, doctor:

1. daemon running? (TCP connect to port)
2. `/v1/models` reachable & non-empty?
3. harness config file exists and contains bansos markers (or merged keys)?
4. for Codex: `wire_api = "responses"` present (not `chat`)?
5. report per-harness ✅/⚠️/❌ with fix hints.
