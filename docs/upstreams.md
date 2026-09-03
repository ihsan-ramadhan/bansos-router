# bansos-router: Upstreams, Catalog & Relay

> Companion to `architecture.md`. Details the keyless free upstreams, the
> curated model catalog, health checking, rate-limit handling, and the relay
> egress design (patterns carried over from `pi-bansos`; local-gateway
> chaining and ban-risk hygiene informed by `freebuff-proxy`).

## 1. Design goals for the upstream layer

- **Keyless first**: flagship upstreams need zero credentials.
- **Curated catalog**: we advertise only models we registered and verified;
  never pass through an upstream's full model list (avoids leaking paid
  models into `/v1/models`).
- **Liveness-gated**: free promos expire; dead models are skipped silently.
- **Relay escape hatch**: per-IP rate limits are dodged by routing egress
  through a user-owned relay, toggled live, no daemon restart.
- **Upstream taxonomy**: two kinds:
  - *remote keyless* (Zen, Kilo, LLM7): zero credentials; spoofed headers
    where needed; relay egress allowed.
  - *local token gateways* (freebuff-proxy, LiteLLM, 9router, ollama):
    **roadmap (M5)**: opt-in, chained at `127.0.0.1:<port>`; may carry a
    token; relay egress **off**.

### 1.1 Dynamic catalog & hardcoded fallback

Catalog bansos-router bersifat **live-first dengan pinned fallback**:

- **Kilo & LLM7** secara periodik (default tiap 30 menit,
  `refreshIntervalMs` di `~/.bansos/config.json`) memanggil endpoint
  `/models` upstream dan menyaring model gratis:
  - Kilo: filter `id` diakhiri `:free` ditambah ID dari pinned list.
  - LLM7: filter `usage_based_only === false` atau `tier === "turbo"`.
- Saat endpoint upstream gagal / timeout / mengembalikan array kosong,
  daemon otomatis mempertahankan model hasil `seed()` (pinned hardcoded)
  sehingga katalog tidak kosong.
- **Zen tetap hardcoded** karena endpoint `/models` mereka hanya
  mengembalikan id `claude-*` yang tidak relevan untuk catalog free.

## 2. Upstreams (v1)

### 2.1 OpenCode Zen

| Field | Value |
|---|---|
| Base URL | `https://opencode.ai/zen/v1` (OpenAI-compatible) |
| Auth | Keyless passthrough (no login) |
| Spoofed headers | `User-Agent: opencode/latest/1.14.50/cli`, `x-opencode-client: cli`, `x-opencode-project: default`, `x-opencode-session: <uuid>`, `x-opencode-request: <uuid>` |
| Model source | **Pinned seed** (`src/upstreams/zen.ts`); live `GET /v1/models` only lists `claude-*` ids, so `fetchCatalog()` returns `null` and the seeded free list is kept |
| Rate limit | Unpublished; treated as best-effort |

> ⚠️ ToS note: OpenCode Zen's free tier is intended for OpenCode users. The
> passthrough pattern (already used by pi-bansos, 9router, zen-proxy) is
> tolerated today but can change. Health-check + relay keep the router
> resilient if a model or the whole endpoint disappears.

### 2.2 KiloCode gateway

| Field | Value |
|---|---|
| Base URL | `https://api.kilo.ai/api/gateway/chat/completions` |
| Auth | Keyless: 200 requests/hour per IP |
| Model source | `GET https://api.kilo.ai/api/gateway/models` (filter `:free` suffix / known ids) |
| Quirk | Free models reject `reasoning_effort`; some emit output in `reasoning` field |

### 2.3 LLM7

| Field | Value |
|---|---|
| Base URL | `https://api.llm7.io/v1` (OpenAI-compatible) |
| Auth | **Anonymous**: send `api_key: "unused"`; optional free token from `dash.llm7.io` for higher limits |
| Model source | `GET /v1/models`: **dynamic** (filtered by `usage_based_only: false`); stable selectors: `default`, `fast` (pro is paid-only) |
| Rate limit | Shared anonymous tier (1 request concurrency per IP); free token raises limits |
| Quirk | Models can appear/disappear: dynamic catalog + health-check are mandatory |

> LLM7 models are dynamically snapshot via `GET /v1/models`. Only models with
> `usage_based_only: false` (tier turbo) are registered as free models. The
> pro tier models (paid per token) are automatically excluded.

### 2.4 Future (roadmap: out of v1 scope)

v1 ships **keyless upstreams only**. These land later:

- **FreeBuff: via `freebuff-proxy` (token-based local gateway)**. `freebuff-proxy`
  (Go, MIT) exposes FreeBuff/Codebuff CLI models through OpenAI, Anthropic, and
  Responses wires at `http://127.0.0.1:3457/v1`. Chaining it as a *local
  upstream* is designed but deferred: it needs a `cb_...` token, has **high
  ban risk** (ToS conflict), and requires relay egress **off** (its own docs
  warn against VPN/hosting egress). Design rules are captured in
  `docs/architecture.md` §7.7 + this section's history; implementation lands
  with `{ type: "local-openai", baseUrl, apiKey? }` in `~/.bansos/config.json`.
- **OpenRouter `:free`** models (20 req/min, 200 req/day per model: needs no
  key for some models, else optional key)
- **Routeway `:free`**, **OVHcloud AI Endpoints anonymous tier** (2 req/min/IP,
  no signup), DashScope free tokens
- Each new upstream must declare: base URL, auth mode, catalog source, rate
  limits, and `compat` flags (see `docs/protocols.md` §5).

## 3. Catalog format

Static registry shipped in code (`src/upstreams/catalog.ts`), one entry per
known free model. Exception: sources with **dynamic catalogs** (LLM7) are
snapshotted into the runtime catalog at health-check time instead of being
pinned statically. The **runtime catalog** is the union of the static
registry and dynamic snapshots, filtered by liveness; only the runtime
catalog is served.

```ts
type ModelDef = {
  id: string;            // exact upstream model id (never an alias)
  name: string;
  source: "zen" | "kilo" | "llm7" | "local";
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  input: ("text" | "image")[];
  compat: {
    supportsReasoningEffort: boolean;
    supportsDeveloperRole: boolean;
    thinkingFormat?: "content" | "reasoning-field";
  };
  cost: { input: 0; output: 0; cacheRead: 0; cacheWrite: 0 };
};
```

v1 seed (pinned seeds + live refresh; liveness drops dead ids, live `:free`
ids from the kilo API join at runtime):

**OpenCode Zen (7 seeded):** `mimo-v2.5-free`,
`nemotron-3-ultra-free`, `big-pickle`, `laguna-s-2.1-free`, `hy3-free`, `nemotron-3.5-lightning-free`,
`muse-spark-1.2-contributor-free`

**KiloCode gateway (13 seeded):** `kilo-auto/free`, `stepfun/step-3.7-flash:free`,
`nvidia/nemotron-3-ultra-550b-a55b:free`, `nvidia/nemotron-3-super-120b-a12b:free`,
`nvidia/nemotron-3.5-lightning:free`, `nvidia/nemotron-3.5-content-safety:free`,
`tencent/hy3:free`, `liquid/lfm-2.5-2.6b:free` (seed; dead upstream, liveness-dropped),
`poolside/laguna-s-2.1:free`, `cohere/north-mini-code:free`,
`poolside/laguna-xs-2.1:free`, `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`,
`openrouter/free`

**LLM7 (8 seeded + dynamic refresh):** `DeepSeek-V4-Flash-0731`, `gemini-3.1-flash-lite`,
`minimax-m2.7`, `gpt-oss:20b`, `mistral-Nemo-Instruct-2407`, `codestral-latest`,
`default`, `fast`. Live models are filtered by `usage_based_only: false`.

## 4. Health checking

| Phase | When | What |
|---|---|---|
| Startup | daemon boot | fetch each upstream catalog; mark alive/dead; log `✓/✗` per model |
| Periodic | every `refreshInterval` (default 30 min, configurable) | re-fetch; update runtime catalog in place; keep serving during the check |
| Manual | `bansos refresh` | force a check now |
| Failure policy | upstream unreachable | keep last-known-good catalog; mark source `degraded`; do not wipe models (a blip ≠ death) |

Catalog fetches are cheap (`GET /v1/models`-style); liveness of **individual**
models is derived from the upstream catalog containing that id: we do not
fire one request per model (pi-bansos's approach).

## 5. Rate limiting (daemon-local)

- Per-IP sliding window on inbound requests (default: generous, e.g. 300/min)
 : protects the loopback socket if the user binds LAN, not a real abuse
  defense for public exposure (which we don't support).
- Configurable via `~/.bansos/config.json`; disabled entirely with
  `BANSOS_RATE_LIMIT=0`.

## 6. Upstream rate-limit reality

| Upstream | Limit | Shared across harnesses? |
|---|---|---|
| KiloCode | 200 req/hr/IP | ✅ yes: all harnesses share your IP |
| OpenCode Zen | unpublished | ✅ likely |
| OpenRouter free | 20 req/min, 200 req/day/model | ✅ yes |

**Consequence:** running 5 harnesses through one daemon shares one budget.
This is the core argument for the relay feature (§8).

## 7. Relay egress

### 7.1 Pattern (proven in pi-bansos / 9router)

When enabled, upstream requests are sent **to the relay URL** with two
headers; the relay forwards to the real upstream and streams the body back
unchanged (SSE passes through untouched):

```
POST https://<relay>/            ← relay URL
x-relay-target: https://api.kilo.ai   ← upstream origin (allowlisted)
x-relay-path:   /api/gateway/chat/completions
```

- Relay is a trivial server: read `x-relay-target` + `x-relay-path`, validate
  against an allowlist, forward method/headers/body, stream back.
- **Allowlist:** `ALLOWED_TARGETS` = known upstream origins only
  (`opencode.ai`, `api.kilo.ai`, `llm7.io`, ...). Relay cannot be abused as an
  open proxy to arbitrary hosts.
- **Local gateways bypass the relay (M5)**: chained local upstreams
  (freebuff-proxy at `127.0.0.1:3457`, LiteLLM, 9router, ollama) will always
  be reached directly. For FreeBuff this is mandatory: relaying would route
  through a hosting egress IP and trigger upstream abuse scoring.
- Fallback: if the relay itself errors (unreachable, timeout, 5xx), egress
  silently falls back to direct so requests keep working. There is **no
  strict relay-only mode yet**; when the relay is flaky, traffic may leave
  from your real IP without a warning.

### 7.2 Relay types

| Type | Deploy | Lifetime |
|---|---|---|
| Vercel worker | `bansos relay deploy`, **stub (M4, belum berfungsi)**; bring-your-own URL dulu | free tier: 100 GB / 500k invocations/mo |
| Cloudflare worker | manual URL via `bansos relay url <URL>` | free tier generous |
| Deno / user-owned | manual URL | any |

### 7.3 State & UX

- Saved relays list + active relay + enabled flag persist in
  `~/.bansos/relay-state.json` (outside package dir, survives npm updates).
- Live toggling: `bansos relay on|off|use <URL>|list|remove <URL>|deploy`.
- **No built-in default relay**: a public package must never bake in one
  user's personal relay URL.
- A relay is a single fixed exit IP (no rotation): multiple relays can be
  saved and switched; auto-rotation across saved relays is a v1.1 candidate.
- **Probe (reachability check) is SSRF-limited**: `/bansos/relay/probe` may
  only target the active relay, a *saved* relay, or a public `https://` host.
  Literal loopback/private/link-local IPs (mis. `127.0.0.1`,
  `169.254.x`/metadata, `192.168.x`) are rejected with 403 unless the URL is
  explicitly saved as a relay.
- **Relay URLs are validated on write**: only `http(s)://` without embedded
  credentials and with a bounded length; payloads with unknown fields are
  sanitized. Invalid payloads get HTTP 400 and leave state untouched.

## 8. Failure taxonomy & handling

| Condition | Symptom | Handling |
|---|---|---|
| Model removed upstream | missing from catalog fetch | dropped at next health pass |
| Model promo expired (id 404s) | upstream 404/400 on request | returned as error; dropped on next refresh |
| Per-IP rate limit hit | upstream 429/402 | error surfaced (mapped per protocol); `bansos relay on` is the fix |
| Whole upstream down | connect timeout | mark source degraded, keep last-known catalog, log |
| Relay down | relay 5xx/timeout | silent direct fallback (keep working); `bansos relay off` untuk mematikan egress relay |

## 9. ToS & ethical guardrails (ship in README)

- Free tiers are **best-effort**: promos expire, IDs change, limits move.
- Don't hammer upstreams: the health check is the only automated traffic
  beyond actual usage.
- Relay usage must respect the upstream's ToS; the tool is for personal
  development use.
- **FreeBuff (M5) is opt-in with real ban risk**: requires a FreeBuff/Codebuff
  account token; using it conflicts with FreeBuff ToS and upstream detection
  can suspend accounts. Default off, residential IP only, modest usage, and
  never routed through the relay.
- bansos-router does not resell, pool, or proxy access for third parties.
