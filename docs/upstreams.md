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
  - *remote keyless* (Zen, Kilo, LLM7, OVH): zero credentials; spoofed headers
    where needed; relay egress allowed (OVH: direct only).
  - *local token gateways* (freebuff-proxy, LiteLLM, 9router, ollama):
    **roadmap (M5)**: opt-in, chained at `127.0.0.1:<port>`; may carry a
    token; relay egress **off**.

### 1.1 Dynamic catalog & pinned fallback

The catalog is **live-first with a pinned fallback**:

- On a timer (every 30 minutes by default, `refreshIntervalMs` in
  `~/.bansos/config.json`) each upstream's own model listing is fetched and
  filtered down to free models:
  - Kilo: ids ending in `:free`, plus the pinned list.
  - LLM7: `usage_based_only === false` or `tier === "turbo"`.
  - OVH: the listing intersected with the seeds.
- When a listing fails, times out or comes back empty, the daemon keeps the
  models from `seed()` (the pinned list), so the catalog never empties.
- All upstreams are queried **in parallel** in one pass, so a slow gateway
  costs only its own latency instead of adding to the others.
- **Zen uses models.dev for metadata**: its `/models` endpoint returns only
  `{id, object, created, owned_by}`, none of the fields `ModelDef` needs and no
  free/paid marker (even `created` is fake, stamped per request). The catalog
  is the intersection of models.dev with the Zen listing; the local seed only
  supplies `wireApi`, fallbacks for fields the index leaves out, and the ids to
  probe. New free models join on their own. See §4.1.

## 2. Upstreams (v1)

### 2.1 OpenCode Zen

| Field | Value |
|---|---|
| Base URL | `https://opencode.ai/inference/openai/v1/chat/completions` |
| Auth | Keyless passthrough (`authorization: Bearer public`) |
| Spoofed headers | `User-Agent: opencode/latest/2.1.3/cli`, `authorization: Bearer public`, `x-opencode-client: cli`, `x-opencode-project: <hex40>`, `x-opencode-session: <session_id>`, `x-session-affinity: <session_id>`, `b3`, `traceparent` |
| Model source | models.dev free models (`cost.input === 0`, not deprecated) intersected with live `GET /v1/models`, plus the pinned seed (`src/upstreams/zen.ts`); seeded ids missing from the live list are probed once and dropped if they fail. An id models.dev marks paid never enters, so the catalog cannot leak paid models |
| Rate limit | Unpublished; treated as best-effort |
| Gateway quirk | The free-tier gate requires `stream: true`, the presence of core tools (`read` + `shell`), an `<env>` block in the system prompt, and Cloudflare JA4 TLS fingerprint matching BoringSSL. The daemon auto-spawns the local OpenCode background service (`opencode serve --service`) if installed to reuse live session affinity. When neither OpenCode nor Bun is available, requests auto-failover to Kilo/LLM7/OVH. |

#### 2.1.1 Consequences of the injected tools

The gate forces two things on every Zen request, and each one has to be undone
before the caller sees the answer.

**`stream: true`.** Zen answers in SSE even when the caller asked for JSON. The
chat wire folds those frames back with `streamToChatResponse`. The responses
wire needs two hops: responses SSE to chat SSE first (`toChatResponse`), then
the same fold. Handing `toChatResponse` an SSE body while asking it for JSON
makes it fail its `JSON.parse` and pass raw SSE to the caller.

**`read` + `shell` tool definitions.** They are added only when the caller
did not declare a tool of that name, and the caller's `tool_choice` is left
alone (`none` would not help on the responses wire anyway: it answers
`400 only "auto" is supported for tool_choice`). The model can and does call
them, so the cleanup happens on the response: `streamToChatResponse` takes the
tools the caller actually declared and drops (or bridges, below) any call
outside them, demoting `finish_reason` from `tool_calls` back to `stop` when
nothing survives.

Streaming chat callers are covered by `filterInjectedToolCallsTransform`, which
sits in the outbound SSE pipeline right after the reasoning fold (so the fold
still sees the hidden call and does not promote planning text to an answer) and
therefore serves both wires
(the responses wire reaches it already translated to chat SSE). Streaming
`/v1/messages` and `/v1/responses` callers get the same filter inside
`AnthropicStreamEncoder` / `ResponsesStreamEncoder`, which take the declared
names as a constructor argument.

**Bridging instead of hiding.** Hiding alone left the turn empty whenever the
model picked an injected tool over the caller's own (pi/OMP `bash`, Codex
`exec_command`, Claude Code `Bash`/`Read`): the agent loop simply stopped. So
before a hidden call is dropped, `callerToolsFromBody` (`src/protocols/tool-bridge.ts`)
looks for the caller's equivalent and re-emits the call under that name:

- target by known name first (`bash`, `exec_command`, `run_command`, … /
  `read_file`, `read`, `view`, …, case-insensitive), and only if its JSON schema
  has a matching argument (`command`/`cmd`/…, `path`/`file_path`/`filePath`/…);
- arguments are mapped key by key from the target schema (`workdir`→`cwd`,
  `timeout`, `offset`/`limit`); an array-typed command becomes
  `["bash", "-lc", cmd]`;
- `read` with no reader but a shell (Codex) becomes `sed -n 'a,bp' -- '<path>'`
  with the path single-quoted;
- if a `required` field of the target cannot be filled, or the arguments are
  not JSON, the call stays hidden as before;
- a caller's own `read`/`shell` is never bridged;
- required description-style fields (`i` in OMP, `intent`, `description`,
  `reason`) are filled with a short "Run …"/"Read …" line; any other required
  field we cannot fill blocks the mapping.

The bridge remembers each translated call id (in memory, last 2000). When the
caller sends that turn back, the Zen transform restores the call to the
injected name and arguments the model actually produced, because a model that
sees `exec_command` where it remembers calling `read` concludes the read never
happened and calls it again (seen with Codex + muse looping on the same file).
Other upstreams receive the caller's own version.

Arguments are buffered until complete and the call is emitted whole, right
before the finish frame (chat) or at close (Anthropic block, Responses item),
keeping the upstream call id. Only the response side changes; what is sent
upstream is untouched.

The declared set is computed from the inbound body **before** forwarding, and
the Zen transform works on its own copy of the `tools` array. Both matter: the
transform used to `push` into the caller's array, which made the injected
`read`/`shell` count as caller tools (so the filter let them through, e.g.
Codex logged `unsupported call: read`) and carried them to whichever upstream
the request failed over to. A tool name arrives
in the first delta for its index, so the verdict is taken there and reused for
the argument deltas that follow; an index whose name is never seen is let
through, so a malformed stream loses nothing. Frames it does not change are
forwarded byte-for-byte.

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

### 2.4 OVHcloud AI Endpoints

| Field | Value |
|---|---|
| Base URL | `https://oai.endpoints.kepler.ai.cloud.ovh.net/v1` (OpenAI-compatible) |
| Auth | **Anonymous**: no `Authorization` header at all, no account |
| Model source | `GET /v1/models`, intersected with the seeds in `src/upstreams/ovh.ts`. The listing carries only id and context (no reasoning or vision flags) and mixes in TTS, embedding, image and guard models, so unseeded ids are never auto-added |
| Rate limit | **2 requests/min per IP** (`x-ratelimit-limit-minute: 2`); a 429 parks the model via `retry-after` |
| Routing | Direct only (`relayAllowed: false`) |
| Ids | Served as `ovh/<id>`; `transformRequestBody` strips the prefix. The prefix keeps OVH ids apart from look-alikes such as LLM7's `mistral-Nemo-Instruct-2407` |
| Quirk | Chat wire only: OVH's `/v1/responses` rejects array `input` with 422, so Codex traffic is translated to chat like any other chat model. `reasoning_effort` and tool calls verified on gpt-oss and Qwen (2026-10-16); `supportsReasoningEffort` stays `false` like every other source so failover can pair OVH with Zen/Kilo models |

### 2.5 Future (roadmap: out of v1 scope)

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
- **Routeway `:free`**, DashScope free tokens
- Each new upstream must declare: base URL, auth mode, catalog source, rate
  limits, and `compat` flags (see `docs/protocols.md` §5).

## 3. Catalog format

Static registry shipped in code, one seed array per upstream
(`src/upstreams/zen.ts`, `kilo.ts`, `llm7.ts`, `ovh.ts`), one entry per known
free model. The live listings of §1.1 replace a source's seeds at
health-check time. The **runtime catalog** is the union of the static
registry and dynamic snapshots, filtered by liveness; only the runtime
catalog is served.

```ts
type ModelDef = {
  id: string;            // exact upstream model id (never an alias)
  name: string;
  source: "zen" | "kilo" | "llm7" | "ovh" | "local";
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
  wireApi?: "chat" | "responses";  // upstream wire format; defaults to chat
  supportsTools?: boolean;          // false skips the model for tool requests
};
```

`wireApi: "responses"` marks a model the upstream only serves on
`/v1/responses`. The forward path swaps in `Upstream.responsesUrl`, translates
the outbound chat body with `chatToResponsesBody()`, and converts the reply back
with `responsesToChatJson()` (or `responsesToChatStream()` for SSE), all in
`src/protocols/responses-upstream.ts`. Everything downstream — the chat,
Responses, and Anthropic handlers, usage logging, the reasoning fold — keeps
seeing OpenAI chat and needs no per-model branching.

v1 seed (pinned seeds + live refresh; liveness drops dead ids, live `:free`
ids from the kilo API join at runtime):

**OpenCode Zen (10 seeded):** `muse-spark-1.3-contributor-free`,
`muse-spark-1.2-contributor-free` (both `wireApi: "responses"`), `cat-jam-free`,
`space-bunny-free`, `nemotron-3.5-lightning-free`, `longcat-2.5-preview-free`,
`mimo-v2.6-flash-free`, `big-pickle`, `nemotron-3-ultra-free`,
`step-5-preview-free`

**KiloCode gateway (17 seeded):** `kilo-auto/free`, `stepfun/step-3.7-flash:free`,
`nvidia/nemotron-3-ultra-550b-a55b:free`, `nvidia/nemotron-3-super-120b-a12b:free`,
`nvidia/nemotron-3.5-lightning:free`, `nvidia/nemotron-3.5-content-safety:free`,
`liquid/lfm-2.5-2.6b:free`, `poolside/laguna-s-2.1:free`, `cohere/north-mini-code:free`,
`poolside/laguna-xs-2.1:free`, `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`,
`inclusionai/ling-3.0-flash-sante:free`, `inclusionai/ling-3.0-flash-fin:free`,
`dots-studio/dots-3-note-preview:free`,
`thinkingmachines/inkling:free`, `thinkingmachines/inkling-small:free`, `openrouter/free`

**LLM7 (5 seeded + dynamic refresh):** `codestral-latest`, `minimax-m2.7`,
`mistral-Nemo-Instruct-2407`, `default`, `fast`. Live models are filtered by
`usage_based_only: false` (tier turbo); the retired `DeepSeek-V4-Flash-0731` /
`gpt-oss:20b` ids and the paid-only `gemini-3.1-flash-lite` were dropped.

**OVH (8 seeded, live-gated):** `ovh/gpt-oss-120b`, `ovh/gpt-oss-20b`,
`ovh/Qwen3.5-397B-A17B`, `ovh/Qwen3.8-27B`, `ovh/Qwen3.6-27B`, `ovh/Qwen3.5-9B`,
`ovh/Mistral-Small-3.2-24B-Instruct-2506`, `ovh/Meta-Llama-3_3-70B-Instruct`.
A seed absent from the live listing is dropped on refresh.

## 4. Health checking

| Phase | When | What |
|---|---|---|
| Startup | daemon boot | fetch each upstream catalog; mark alive/dead; log `✓/✗` per model |
| Periodic | every `refreshInterval` (default 30 min, configurable) | re-fetch; update runtime catalog in place; keep serving during the check |
| Manual | `bansos refresh` | force a check now |
| Failure policy | upstream unreachable | keep last-known-good catalog; mark source `degraded`; do not wipe models (a blip ≠ death) |

Catalog fetches are cheap (`GET /v1/models`-style). For kilo and llm7 the
listing itself is authoritative, so liveness of **individual** models is
derived from the upstream catalog containing that id. Zen's listing is not
exhaustive (some servable promos are never listed), so zen re-checks each
seed against the listing and only probe-verifies the unlisted ones keyless
(typically zero to one model per refresh).

### 4.1 Building the Zen catalog

Kilo and LLM7 can auto-add a model they have never seen because their listings
carry everything `ModelDef` needs. Zen's listing carries an id and nothing else,
so `fetchCatalog()` assembles a model from two live sources:

1. **models.dev** for the free/paid signal (`cost.input === 0`), retirement
   (`status`), and the facts about the model itself: name, reasoning, context,
   output limit, modalities. Values are used as published; a field the index
   omits falls back to the matching `ZEN_MODELS` entry before the generic
   default, so a dropped `limit` cannot silently shrink a known model to 128k.
2. **Zen's live `/v1/models`** to confirm the gateway actually offers the id.

`wireApi` is the only field neither source carries, and it is read off the
matching `ZEN_MODELS` entry. Everything else about a model now comes from the
index, so there is no override table to keep in sync.

Two global rules still apply, because they are about this router rather than
about any one model:

- Modalities are filtered per wire. `ZEN_RESPONSES_MODALITIES` allows text,
  image and pdf; `ZEN_CHAT_MODALITIES` allows text and image, because Zen
  answers 500 for a `file` part on `/chat/completions` while carrying the same
  PDF fine on `/responses`. A model the seed does not know defaults to the chat
  set. Audio is in neither: both models advertising it discard it on the wire
  (§3.4 of `protocols.md`).
- `supportsReasoningEffort` is always `false`, never derived. `pickFailover`
  only pairs models whose flag matches and every model in the catalog is
  `false`, so a single derived `true` would leave that model with no failover
  at all.

#### Retirement and liveness

A seeded model the index marks `deprecated` **or paid** is **probed** rather
than trusted, even while Zen still lists it. Both verdicts mean the same thing
for a keyless router: being listed no longer implies being servable. That is the difference between MiMo V2.5, which
is retired and still answering, and DeepSeek V4 Flash Free, which was listed for
days after it began returning 400. Alive keeps it; dead drops it.

A seeded id missing from the listing is probed too, since the listing is not
exhaustive. When models.dev is unreachable the seed alone drives the pass —
unreachable covers a rejected fetch (DNS failure, refused connection, timeout)
as well as a non-ok status, so an index outage degrades the pass instead of
wiping Zen out of the catalog. When the Zen listing is unreachable the catalog
keeps its last-known models.

#### Failover tolerance

`pickFailover` used to require a candidate's context to be greater than or equal
to the origin's, which made Muse's published 1_048_576 unusable: it pushed
Nemotron 3 Ultra's 1_000_000 out of the failover set over a 4.6% gap. The rule
now admits anything within `FAILOVER_CONTEXT_TOLERANCE` (90%), so the published
figure can be used as-is.

Ranking is asymmetric, because the two directions are not equally safe. A
candidate at or above the origin's context can serve every request the origin
could; one inside the 90% band cannot, and a near-full-context request that
lands there fails with a context-length 400. So candidates that cover the origin
are preferred as a group, ranked among themselves by the smallest surplus, and
the band is only reached for when nothing covers it. `maxTokens` breaks a tie,
larger winning.

## 5. Rate limiting (daemon-local)

- Per-IP sliding window on inbound requests, 300 per minute by default:
  protects the loopback socket if the user binds LAN, not a real abuse
  defense for public exposure (which we don't support).
- Set the limit with the `BANSOS_RATE_LIMIT` env var; `0` or an invalid value
  falls back to the default.

## 6. Upstream rate-limit reality

| Upstream | Limit | Shared across harnesses? |
|---|---|---|
| KiloCode | 200 req/hr/IP | ✅ yes: all harnesses share your IP |
| OpenCode Zen | unpublished | ✅ likely |
| LLM7 | 1 concurrent request per IP (anonymous) | ✅ yes |
| OVHcloud | 2 req/min/IP (anonymous) | ✅ yes; direct only, the relay cannot help |

**Consequence:** running 5 harnesses through one daemon shares one budget.
This is the core argument for the relay feature (§7).

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
  (`opencode.ai`, `api.kilo.ai`, `api.llm7.io`). Relay cannot be abused as an
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
| Vercel worker | `bansos relay deploy` is a **stub (M4)**; bring your own URL for now | free tier: 100 GB / 500k invocations/mo |
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
  Literal loopback/private/link-local IPs (e.g. `127.0.0.1`,
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
| Relay down | relay 5xx/timeout | silent direct fallback (keep working); `bansos relay off` turns relay egress off |
| Error under HTTP 200 (JSON) | `{error}` with no `choices` (Kilo → Nvidia overloaded) | treated as 502, fails over |
| Error under HTTP 200 (SSE) | first `data:` frame carries `error` (Zen `Streaming response failed: [503]`; Kilo/OpenRouter send it after `: KILO PROCESSING` keepalives and keep a `choices` array in the same frame) | `peekStreamError` buffers up to the first data frame, keepalives included, for at most 5 s so headers are never held back longer; an error there is treated as 502 and fails over; a later error frame becomes a 502 for non-stream callers, an Anthropic `error` event, or `response.failed` |
| Model cannot take tools / images | 400/404 `does not support tools`, `No endpoints found that support tool use`, `does not support vision` | catalog flag `supportsTools` (Kilo `supported_parameters`, LLM7 `capabilities.tools`) and `input` skip such models up front; a matching error message fails over too. With failover off the upstream error is returned as-is: tools are never silently dropped |
| Quota hint only in the body | 429 `Retry after 80618 seconds` with no `Retry-After` header (LLM7 daily quota) | `retryAfterFromMessage` feeds the cooldown (still capped at 15 min) |

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
