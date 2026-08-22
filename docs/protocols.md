# bansos-router — Wire Protocols & Translation

> Companion to `architecture.md`. Details the three inbound wire protocols,
> the internal normalized model, and the translation rules — including the
> hard parts: streaming, tool calls, and thinking blocks.

## 1. Endpoint map

| Endpoint | Protocol | Used by (examples) |
|---|---|---|
| `POST /v1/chat/completions` | OpenAI Chat Completions | pi, Aider, OpenCode, Hermes, Goose, OpenClaw, Antigravity, JCode, Cline, Continue |
| `POST /v1/messages` | Anthropic Messages | Claude Code, OpenClaw (anthropic mode) |
| `POST /v1/responses` | OpenAI Responses | Codex CLI (≥0.122, `wire_api = "responses"`) — **not live yet, lands in M3** |
| `GET /v1/models` | OpenAI (list) | model pickers; returns **only alive curated models** |
| `GET /` | Web UI Console | browser dashboard console |
| `GET /healthz` | — | daemon health |
| `GET /bansos/status` | — | CLI status payload (JSON) |
| `POST /bansos/refresh` | — | CLI refresh: re-run upstream health checks now |
| `GET /bansos/adapters` | — | list available harness adapters for Web UI |
| `GET /bansos/adapters/render` | — | render harness configuration snippet |
| `GET /bansos/relay` | — | get saved relay nodes and active state |
| `POST /bansos/relay` | — | update relay state (toggle, add, remove, use) |
| `POST /bansos/relay/probe` | — | test reachability and latency of a relay node |

## 2. Internal normalized model

Every inbound protocol is parsed into one internal representation, then
rendered to the upstream wire (all upstreams are OpenAI Chat Completions).

```ts
type InternalTurn = {
  model: string;                       // resolved catalog id
  system?: string;                     // system prompt (single, joined)
  messages: InternalMessage[];
  tools?: InternalTool[];              // or null to disable
  maxTokens?: number;                  // per-model default when absent
  thinking?: { enabled: boolean; budget?: number };
  reasoningEffort?: "low" | "medium" | "high"; // only for models that support it
  stream: boolean;
};

type InternalMessage =
  | { role: "user"; content: string | InternalContentBlock[] }
  | { role: "assistant"; content: string; toolCalls?: InternalToolCall[];
      thinking?: string }
  | { role: "tool"; toolCallId: string; content: string };

type InternalTool = { name: string; description?: string; parameters: object };
type InternalToolCall = { id: string; name: string; arguments: string };
```

Rules:

- **Model resolution** — inbound `model` string may be an alias. Aliases map
  to catalog ids (e.g. `"free"`, `"coding-fast"`, `"gemini"` style names
  configured per install). Unknown model → `404`-style error listing available
  ids. `max_tokens`/`max_tokens_to_sample` absent → per-model default from the
  catalog.
- **Reasoning flags come from the catalog**, not the client. If a model has
  `reasoning: false`, thinking/reasoning-effort parameters are stripped
  silently (Kilo models notably reject reasoning-effort).

## 3. Translation matrix (inbound → internal → upstream)

### 3.1 Messages

| Semantic | Chat Completions | Anthropic Messages | Responses API | Upstream (chat) |
|---|---|---|---|---|
| System prompt | `messages[0].role="system"` | top-level `system` | `instructions` | `messages[0] role=system` |
| User text | `role=user` | `role=user` | `input[].role=user` | `role=user` |
| User image | `content:[{type:image_url}]` | `content:[{type:image,source}]` | `input[].content` image_url | pass-through if model `input` includes `image` |
| Assistant text | `role=assistant` | `role=assistant` | `output` items | `role=assistant` |
| Tool call | `tool_calls[]` | `content:[{type:tool_use}]` | `output[]` function_call item | `tool_calls[]` |
| Tool result | `role=tool` + `tool_call_id` | `role=user` + `tool_result` block | `input[]` `function_call_output` item | `role=tool` + `tool_call_id` |
| Stop | `stop` | `end_turn` | `end_turn` | — |
| Stop: tool | `tool_calls` | `tool_use` | `function_call` | — |
| Stop: length | `length` | `max_tokens` | `max_output_tokens` | — |

### 3.2 Tool calling

Tools are the make-or-break feature for coding agents; translation must be
lossless.

- **Chat ↔ Anthropic**: `tools[] {type:function,function:{name,description,parameters}}`
  ↔ `tools[] {name,description,input_schema}`. Anthropic requires `input_schema`
  to be a JSON Schema object — if an upstream/client omits it, inject `{"type":"object"}`.
- **Responses ↔ Chat**: Responses uses `tools[] {type:"function",name,description,parameters}`
  (flat). The Responses API is stricter about function schemas; translation
  must preserve `strict`/`additionalProperties` if present, and strip
  unsupported keys (e.g. `$schema`).
- **Interleaving**: Anthropic requires exactly one `tool_result` per `tool_use`
  id; Chat allows `role=tool` anywhere. The normalizer groups/orders tool
  results to satisfy whichever upstream is hit. Since all upstreams are Chat
  Completions, we must **collapse consecutive Anthropic `tool_result` blocks
  into ordered `role=tool` messages** and rebuild `tool_use` blocks when
  rendering back out.

### 3.3 Thinking / reasoning

| Semantic | Chat Completions | Anthropic Messages | Responses API |
|---|---|---|---|
| Enable | `reasoning_effort` param (some providers) | `thinking: {type:"enabled", budget_tokens}` | `reasoning: {effort}` |
| Output text | `reasoning`/`reasoning_content` field (provider-dependent) | `content:[{type:"thinking", thinking}]` blocks | `output[]` `reasoning` items |

**Known upstream quirks (from pi-bansos field notes):**

- `nvidia/nemotron-3-super-120b-a12b:free` emits the response in the
  `reasoning` field instead of `content`, rendering blank in some clients.
- **Normalization rule (must implement):** if an upstream response has
  `reasoning`/`reasoning_content` but empty/missing `content`, and the inbound
  protocol expects content (Claude Code especially), synthesize:
  1. move `reasoning` → thinking block (Anthropic) or `reasoning` item
     (Responses);
  2. if `content` is still empty after the model's final turn, emit a minimal
     fallback `content` (e.g. `"[no content produced]"`) so the client does
     not stall — or a hard error with the reasoning text, configurable.
- Stripping: for `reasoning:false` models, never send thinking params and drop
  any thinking blocks in history.

## 4. Streaming (SSE)

All three protocols stream Server-Sent Events — but with different framing.
Translation strategy: **parse inbound event stream → emit internal turn deltas
→ render outbound event stream** (never buffer whole responses for streaming
requests; streamed answers must stay streamed).

| Protocol | Frame shape | Delta shape |
|---|---|---|
| Chat Completions | `data: {json}` … `data: [DONE]` | `choices[0].delta.content` / `delta.tool_calls` |
| Anthropic Messages | `event: <type>\ndata: {json}` | `content_block_delta` with `text_delta` / `input_json_delta` / `thinking_delta`; `message_stop` at end |
| Responses API | `event: <type>\ndata: {json}` | `response.output_text.delta`, `response.function_call_arguments.delta`, `response.reasoning_summary_text.delta`; `response.completed` at end |

### 4.1 Upstream → Chat Completions (the common path)

Upstreams stream Chat Completions; the outbound Chat Completions consumer gets
a near pass-through (only model-id normalization + reasoning-field fixes).
Anthropic and Responses consumers get a **full event re-render**:

- Upstream `delta.content` chunks → Anthropic `content_block_start(text)` +
  repeated `content_block_delta(text_delta)` + `content_block_stop`; or
  Responses `response.output_text.delta` events.
- Upstream `delta.tool_calls` (streamed arg fragments) → Anthropic
  `input_json_delta` fragments (same partial-JSON streaming semantics); or
  Responses `response.function_call_arguments.delta`.
- Upstream reasoning field → Anthropic `thinking_delta` / Responses
  `response.reasoning_summary_text.delta`.
- Terminal events: `[DONE]` → Anthropic `message_stop` / Responses
  `response.completed` (+ final `response.output_item.done` for any tool calls).
- **Stop-reason rewrite** must happen on the final chunk (`finish_reason` →
  the target protocol's stop enum from §3.1).

### 4.2 Heartbeats & idempotency

- Anthropic sends periodic `ping` events; Responses sends `response.in_progress`
  pings. When translating **to** these protocols, keep cadence sane (no
  artificial pings needed beyond what upstream produces; do not swallow
  upstream pings).
- Each rendered event must carry a monotonic `event_id` where the target
  protocol requires it (Responses `event_id`; Anthropic `message.id` created
  once at `message_start`).

### 4.3 Non-streaming

`stream:false` requests are buffered and returned as the target protocol's
non-stream shape:
- Chat: `{id, object:"chat.completion", choices:[{message:{role,content,tool_calls}}], usage}`
- Anthropic: `{id, type:"message", role:"assistant", content:[text/tool_use/thinking blocks], stop_reason, usage}`
- Responses: `{id, object:"response", output:[message/function_call/reasoning items], usage}`

## 5. Per-model metadata (drives translation)

The catalog (`docs/upstreams.md` §6) carries flags that gate translation:

```ts
type ModelDef = {
  id: string;            // exact upstream id
  name: string;
  source: "zen" | "kilo" | …;
  reasoning: boolean;    // supports/emits thinking
  contextWindow: number;
  maxTokens: number;
  input: ("text" | "image")[];
  // translation flags
  compat: {
    supportsReasoningEffort: boolean;   // kilo: false
    supportsDeveloperRole: boolean;     // some chat upstreams: false
    thinkingFormat?: "content" | "reasoning-field"; // nemotron-super style
  };
  cost: { input: 0; output: 0; cacheRead: 0; cacheWrite: 0 };
};
```

Translation code switches on `compat`:
- `supportsReasoningEffort:false` → strip `reasoning_effort` on outbound.
- `thinkingFormat:"reasoning-field"` → apply the §3.3 normalization on
  inbound-to-internal parse.

## 6. Error mapping

| Upstream / internal condition | Chat | Anthropic | Responses |
|---|---|---|---|
| Unknown model | `400 model_not_found` | `400 invalid_request_error` | `400 invalid_request_error` |
| Rate limited (upstream 429 / 402) | `429` + retry hint | `429 rate_limit_error` | `429` + `rate_limit` event |
| Upstream down / timeout | `502` | `502 api_error` | `502` |
| Relay unreachable | `502` (fall back to direct per config) | same | same |
| Over context (upstream refuses) | `400 context_length_exceeded` | `400 invalid_request_error` w/ message | `400` |

Error bodies always JSON; streaming requests that fail **before** the first
frame get a plain error JSON (clients handle this), never a half-open stream.

## 7. Test matrix (acceptance)

| # | Scenario | Expect |
|---|---|---|
| T1 | Chat streaming, tool call round-trip | deltas + `tool_calls` + correct `finish_reason` |
| T2 | Anthropic streaming w/ tools + thinking | `message_start`…`content_block_*`…`message_stop`, `stop_reason:"tool_use"`, thinking deltas |
| T3 | Responses streaming w/ tools | `response.output_text.delta` + `function_call` items + `response.completed` |
| T4 | Nemotron-super (reasoning-field) via Anthropic | non-empty content + thinking block; no stall |
| T5 | Kilo model via Claude Code | no reasoning params sent; valid stream |
| T6 | `/v1/models` | only alive curated ids |
| T7 | Relay on + upstream 429 | request goes out via relay, response intact |
| T8 | Non-stream variants of all three | correct final shapes + usage |
