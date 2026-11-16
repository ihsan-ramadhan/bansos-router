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
3. **Idempotent & reversible.** `setup` never overwrites user edits blindly:
   it writes a clearly-marked block, and `bansos setup <harness> --undo`
   removes it.
4. **No secrets written.** The daemon accepts any placeholder key
   (e.g. `bansos`); adapters never invent or persist real credentials.

## 2. Matrix

Legend: 🟢 config-only · 🟡 config + small adapter · 🔵 works manually, no `bansos setup` adapter yet · 🔴 not supported (v1)

| Harness | Wire | Config location | Effort | Notes |
|---|---|---|---|---|
| **pi** | OpenAI Chat | extension (`registerProvider`) | 🟡 | Only code adapter: provider `bansosr` + `/bansosr` command, spawns daemon on demand, stops it again on exit if it spawned it |
| **Claude Code** | Anthropic Messages | `~/.claude/settings.json` (`env`) | 🟢 | `ANTHROPIC_BASE_URL=http://127.0.0.1:17070` + `ANTHROPIC_AUTH_TOKEN=bansos` + model mappings |
| **Aider** | OpenAI Chat | env / `aider.conf.yml` | 🟢 | `OPENAI_API_BASE=http://127.0.0.1:17070/v1`, `OPENAI_API_KEY=bansos`, `AIDER_MODEL=<id>` |
| **OpenCode** | OpenAI Chat | `~/.config/opencode/opencode.json` | 🟢 | Custom provider with `@ai-sdk/openai-compatible`, `baseURL` |
| **Codex CLI** | OpenAI Responses | `~/.codex/config.toml` | 🟢 | `[model_providers.bansos] base_url`, `wire_api = "responses"`: daemon serves `/v1/responses` |
| **Hermes (Nous)** | OpenAI Chat | `~/.hermes/config.yaml` | 🟢 | `model.provider: custom` + `model.base_url`, plus a `model_aliases` entry per model so `/model <id>` reaches all of them |
| **OpenClaw** | OpenAI Chat or Anthropic | `~/.openclaw/config.json` / agent `models.json` | 🟢 | `models.providers.<id>.baseUrl`; can pick either wire |
| **Goose** | OpenAI Chat | `~/.config/goose/custom_providers/*.json` | 🟢 | `engine: "openai"`, `base_url`, model list |
| **Antigravity CLI** | n/a | `~/.gemini/antigravity-cli/settings.json` | 🔴 | No endpoint override: OAuth-only, and no settings key or env var changes the inference URL (google-antigravity/antigravity-cli#514) |
| **JCode** | OpenAI Chat | `~/.jcode/config.toml` (`$JCODE_HOME`) | 🟢 | `[providers.bansos]` profile with a static model list plus a keyless catalog refresh; `[provider]` defaults are only filled when the user has not chosen a provider |
| **9Router** | OpenAI Chat | `~/.9router/db.json` | 🟢 | Custom compatible `providerNodes` + `providerConnections` |
| **dsh** (DeepSeek Harness) | OpenAI Chat | `~/.dsh/profiles/{web,headless}/cordis.patch.yml` | 🟢 | Adds a `bansos` route inside each profile's existing `llm-pi-ai` entry: `api: openai-completions`, `baseURL`, `apiKeyEnv`, `headers` |
| **Continue** | OpenAI Chat | `~/.continue/config.yaml` | 🟢 | Adds `models:` entries (`config.json` is ignored by Continue v1) |
| **Cline** | OpenAI Chat | `~/.cline/data/settings/providers.json` | 🟢 | `providers.openai-compatible` with `baseUrl`, `apiKey`, `model`: the extension, CLI and SDK all read this file |
| **Roo Code** | OpenAI Chat | VS Code global state (`state.vscdb`) | 🔵 | No config file on disk: set OpenAI Compatible by hand in the panel (Base URL, key `bansos`, model id) |
| **OMP (Oh My Pi)** | OpenAI Chat | `~/.omp/agent/models.yml` | 🟢 | Appends `bansos` provider with `openai-models-list` discovery |
| **Claude Desktop** | Anthropic Messages | n/a | 🔴 | No supported custom base URL; out of scope (hacky MITM only) |
| **Copilot CLI** | n/a | n/a | 🔴 | OAuth-only, no custom endpoint |
| **Gemini CLI** | n/a | n/a | 🔴 | Retired (June 2026) -> Antigravity CLI |

## 2.1 Your harness is not in this list

`bansos setup` is a convenience, not a requirement. Every row above is a config
file pointing at the daemon; if your client is missing (an editor plugin, a
shell one-liner, your own agent), wire it yourself. Three values cover all of
them:

| Setting | Value |
|---|---|
| Base URL | `http://127.0.0.1:17070/v1` for OpenAI Chat / Responses, `http://127.0.0.1:17070` for Anthropic Messages |
| API key | anything non-empty, e.g. `bansos`: the router checks no key |
| Model | any id from `bansos models`, or `curl -s 127.0.0.1:17070/v1/models` |

Steps:

1. In the client, choose "OpenAI compatible" / "custom provider" and paste the
   base URL. Anthropic-wire clients take the bare host; the daemon adds
   `/v1/messages` itself.
2. Model field: one id from the catalog. A single hard-coded name is fine, the
   router fails over to another free model on `429`/`5xx` by itself. If the
   client insists on fetching a model list, `/v1/models` serves one.
3. Environment-only clients: export whatever variable it reads (names differ per
   tool: `OPENAI_BASE_URL`, `OPENAI_API_BASE`, `ANTHROPIC_BASE_URL`, …):

   ```sh
   export OPENAI_BASE_URL=http://127.0.0.1:17070/v1
   export OPENAI_API_KEY=bansos
   ```

4. Test the endpoint before blaming the client:

   ```sh
   curl -s http://127.0.0.1:17070/v1/chat/completions \
     -H 'content-type: application/json' \
     -d '{"model":"deepseek-v4.1-flash-free","messages":[{"role":"user","content":"hi"}]}'
   ```

   If that answers, the daemon is fine and the client config is not.
5. Optional: send `x-bansos-client: <your-tool>` on every request so the
   Activity tab shows your client's name instead of guessing from the user
   agent. It is lowercased and must start with a letter or digit and use only
   `a-z 0-9 . _ / -`, max 32 chars; anything else falls back to the user agent.

Some clients cannot be wired at all, and no adapter will appear for them: they
sign in with OAuth and expose no endpoint override (Antigravity CLI, Copilot
CLI), or have no base-URL setting whatsoever (Claude Desktop). Those are the 🔴
rows.

If your client does have a base-URL field but still needs more (a non-standard
wire, a model-count limit, headers it refuses to send), open an issue with the
config file it writes: an adapter is one entry in `src/adapters/index.ts`.

## 3. Adapter contract (implementation spec)

```ts
type HarnessAdapter = {
  id: string;                 // "claude-code", "aider", ...
  name: string;               // human-readable
  wire: "chat" | "anthropic" | "responses";
  modelMode: "list" | "tiered" | "single" | "discovery";
  configPaths: string[];      // candidate locations, first existing wins (or create)
  render(ctx: SetupCtx): ConfigWrite[];  // ordered file writes
  undo(ctx: SetupCtx): string[];         // paths an undo would touch
  undoKeys?: string[];        // merge mode: dotted keys --undo removes
};
type SetupCtx = {
  baseUrl: string;            // http://127.0.0.1:<port>
  defaultModel: string;       // from catalog or CLI flag
  models: ModelDef[];         // alive catalog snapshot, narrowed by --models/--upstream
  specificModel?: boolean;    // true when --model pinned one model
};
type ConfigWrite = {
  path: string;
  content: string;
  mode: "merge" | "overwrite-block" | "toml-block" | "yaml-block";
  markers?: [string, string]; // e.g. # bansos-router:start
  tomlTable?: string;         // toml-block: the table the block defines
  yamlParent?: string;        // yaml-block: the key the block nests under
  replace?: string[];         // merge: dotted paths rewritten wholesale
};
```

### 3.1 Write modes

`bansos setup <harness>` writes with `--undo` support in these modes:

- **JSON targets** (Claude Code `settings.json`, OpenCode, Goose, OpenClaw):
  the existing file is parsed, the bansos fragment is deep-merged, and the
  file is re-serialized as valid JSON. `--undo` removes exactly the keys
  bansos added (per-adapter `undoKeys`, a trailing `*` matches a prefix such
  as Continue's `Bansos - <name>` titles), never touching user keys. Model
  lists are listed in the write's `replace` paths and rewritten wholesale on
  every run, so models that left the catalog do not pile up (Goose's
  key-less `{name}` entries used to double on each rerun).
- **Non-JSON formats** (TOML, YAML, env: Aider, Codex, Hermes, OMP,
  DeepSeek Harness): a marked block (`# bansos-router:start` / `# ...:end`) is
  replaced or appended; `--undo` deletes between the markers. `toml-block`
  (Codex, JCode) keeps the block inside its own table, and `yaml-block` (OMP)
  nested it under a top-level key such as `providers`. JCode needs two blocks
  (one per table, `[provider]` and `[providers.bansos]`), because the writer
  patches a single table per write. DeepSeek Harness and
  Hermes are the two cases where the block cannot simply be appended: dsh
  splices the provider into its single `llm-pi-ai` entry, and Hermes appends a
  second top-level `model_aliases:` key.
- **TOML root keys** (Codex `model` / `model_provider`)
  cannot live in the marked block, which sits after other tables. They are
  written in root scope with a trailing `# bansos-router` tag; a value the user
  already had is kept on the line above as `# bansos-router-prev: <line>`.
  `--undo` drops tagged lines and restores the `-prev` ones, so Codex is never
  left pointing at a provider table that no longer exists.

### 3.2 Env-based harnesses (Aider, Claude Code)

Claude Code and Aider also read env vars, but `bansos setup` writes their
native config instead (`~/.claude/settings.json` `env` block /
`~/.aider.conf.yml`), so nothing touches the shell rc. Export the variables
from §4 yourself if you want the change in one shell only.

### 3.3 Model pinning & smart tiering

`bansos setup <harness> --model <id>` pins one specific model.
`--models <id,...>` and `--upstream <id,...>` narrow the list instead (they
combine; an upstream adds every model it serves), and `--model` cannot be mixed
with them. Each adapter declares a `modelMode` (`list`, `tiered`, `single`,
`discovery`) that `/bansos/adapters` reports, so the dashboard shows a checklist,
a single picker, or nothing. With no model flag, adapters apply these defaults:
- **Claude Code**: Maps tiers automatically (`haiku` -> the largest non-reasoning model, `sonnet` -> the smart default when it reasons, otherwise the second-largest reasoning model, `opus` -> the largest reasoning model) and sets `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`.
- **OpenCode, Goose, OpenClaw, Continue, dsh**: Register all catalog models so every model is selectable in the harness.
- **Hermes**: The smart model becomes the live `model:`, every other model a `model_aliases` entry reachable with `/model <id>`.
- **9Router, OMP, JCode**: Register a provider that discovers models from `/v1/models` on its own. JCode also gets the model list written out (`models = [{ id = ... }]`), because it only builds picker routes for a non-active profile from that static list; `model_catalog = true` keeps the live refresh once the profile is active. JCode's defaults live in its `[provider]` table, not in root keys, and setup fills them only when they are absent.
- **Aider, Codex, Cline**: Default to the smart model (the preferred model in `src/upstreams/types.ts` when it is alive, otherwise the reasoning model with the largest context window) and switch freely via `/v1/models`.

In strict mode only models from `allowedUpstreams` are registered or picked as
the default.

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
        "mimo-v2.6-flash-free": {},
        "nemotron-3-ultra-free": {},
        "big-pickle": {},
        "kilo-auto/free": {}
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
http_headers = { "x-bansos-client" = "codex" }
```

### Hermes: `~/.hermes/config.yaml`

`model:` is the live default; every other model becomes an alias, so `/model <id>`
switches between them without editing the file again.

```yaml
model:
  provider: custom
  default: "<id>"
  base_url: "http://127.0.0.1:17070/v1"
  api_key: bansos
model_aliases:
  <other-id>:
    model: <other-id>
    provider: custom
    base_url: "http://127.0.0.1:17070/v1"
    api_key: bansos
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
  "api_key_env": "BANSOS_API_KEY",
  "base_url": "http://127.0.0.1:17070/v1",
  "headers": { "x-bansos-client": "goose" },
  "models": [{ "name": "<id>", "context_limit": 256000 }] }
```

Goose resolves `api_key_env` itself, so export `BANSOS_API_KEY` (any value) before
the first run.

### Cline: `~/.cline/data/settings/providers.json`

```json
{ "version": 1, "lastUsedProvider": "openai-compatible",
  "providers": { "openai-compatible": {
    "provider": "openai-compatible", "apiKey": "bansos",
    "model": "<id>", "baseUrl": "http://127.0.0.1:17070/v1",
    "headers": { "x-bansos-client": "cline" } } } }
```

### JCode: `~/.jcode/config.toml`

```toml
[provider]
default_provider = "bansos"
default_model = "<id>"

[providers.bansos]
type = "openai-compatible"
base_url = "http://127.0.0.1:17070/v1"
auth = "none"
requires_api_key = false
model_catalog = true
default_model = "<id>"
models = [{ id = "<id>" }, { id = "<id>" }]
```

`default_provider` only counts inside `[provider]`; written at the root of the
file jcode ignores it and falls back to auto-detection. Setup fills those two
keys only when they are missing, so an existing `default_provider` (another
router, a subscription) keeps running and the run says so on stdout; pick
bansos with `/model` when you want it.

No key goes on disk: jcode looks up `OPENAI_COMPAT_API_KEY` in its own env file
the moment a key is named, so `auth = "none"` with `requires_api_key = false`
is the pair that keeps a keyless router keyless.

`model_catalog = true` lets the picker refresh from this router's `/v1/models`,
but jcode builds picker routes for a profile that is not the active provider
only from that profile's own `models` list — which is why setup writes the
catalog out as well. Those entries must be objects (`{ id = "..." }`); a bare
`models = ["my-model"]` array makes jcode reject the whole config with
`invalid type: string, expected struct NamedProviderModelConfig`.

`$JCODE_HOME` is honoured when it is set, otherwise `~/.jcode` is used.

### 9Router: `~/.9router/db.json`

```jsonc
{
  "providerNodes": [
    {
      "id": "openai-compatible-chat-bansos",
      "name": "Bansos Router",
      "type": "openai-compatible",
      "prefix": "bansos",
      "apiType": "chat",
      "baseUrl": "http://127.0.0.1:17070/v1"
    }
  ],
  "providerConnections": [
    {
      "id": "bansos-default",
      "provider": "openai-compatible-chat-bansos",
      "authType": "api_key",
      "name": "Bansos Router",
      "priority": 1,
      "isActive": true,
      "apiKey": "bansos"
    }
  ]
}
```

### dsh (DeepSeek Harness): `$DSH_HOME/profiles/{web,headless}/cordis.patch.yml`

`dsh` keeps config per profile (default home `~/.dsh`): `web` for the UI,
`headless` for terminal runs. Each profile mounts one `llm-pi-ai` entry, so
`bansos setup dsh` splices a `bansos` route under that entry's existing
`providers:` in both files instead of adding a second entry. The same block
points `agent-default-model` at `bansos`, so dsh stops answering from
`deepseek-official` (an entry you set yourself is left alone). A rerun replaces
only the marked block; `--undo` removes it from both.

```yaml
# bansos-router:start
- id: llm-pi-ai
  config:
    providers:
      bansos:
        displayName: Bansos Router
        api: openai-completions
        baseURL: http://127.0.0.1:17070/v1
        apiKeyEnv: BANSOS_API_KEY
        # dsh reads the key from the env or .credentials.yaml; the router checks none
        headers:
          x-bansos-client: dsh
        models:
          - id: deepseek-v4.1-flash-free
            contextWindow: 262144
            maxTokens: 16384
            input: [text, image]
# bansos-router:end
```

dsh resolves `apiKeyEnv` through its credential seam per request: its own store,
then the launch environment, then `$DSH_HOME/.env`. A route whose key variable is
unset fails with `MISSING_CREDENTIAL` even though this router checks no key, so
setup also writes the last layer for you:

```sh
# bansos-router:start
BANSOS_API_KEY=bansos
# bansos-router:end
```

in `~/.dsh/.env`: no `export` needed, and the value is irrelevant to
bansos-router. Providers written on one line (`providers: {...}`) are left
alone: setup refuses and prints the block to paste by hand.

dsh rewrites `cordis.patch.yml` from its own settings model on restart and can
drop custom routes it does not recognize
([deepseek-ai/deepseek-harness#11074](https://github.com/deepseek-ai/deepseek-harness/discussions/11074)),
so rerun `bansos setup dsh` if the provider disappears after a restart.

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
bansos start --bg  # start the daemon
bansos setup aider --model big-pickle
# writes openai_api_base / openai_api_key / model into ~/.aider.conf.yml
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
`docs/upstreams.md` §6): relay (§7) becomes the escape hatch. (pi is not a
`bansos setup` harness; install the `pi-bansos-router` extension instead.)

## 6. Verification (`bansos doctor`)

`bansos doctor` checks, in order:

1. the daemon answers `/healthz` (and how many models it serves);
2. relay state and the security config (strict mode, DLP, config warnings);
3. autostart: on, off, or pointing at a path that no longer exists;
4. per harness: config file missing, present with bansos markers or merged
   keys, or present without them;
5. whether a newer `bansos-router` is on npm.

It exits 1 when any check fails.
