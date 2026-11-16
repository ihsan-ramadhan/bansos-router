import type { HarnessAdapter, SetupContext, ConfigWrite } from "./types";
import { START_MARKER, END_MARKER } from "./types";
import { compareModelsByCapacity, pickSmartDefaultModel, type ModelDef } from "../upstreams/types";
import { CONTINUE_ITEM_RE, removeContinueModels, stripJcodeDefaults } from "../cli/write";

const tomlBlock = (): Pick<ConfigWrite, "mode" | "markers"> => ({
  mode: "overwrite-block",
  markers: [`# ${START_MARKER}`, `# ${END_MARKER}`],
});

const yamlBlock = (): Pick<ConfigWrite, "mode" | "markers"> => ({
  mode: "overwrite-block",
  markers: [`# ${START_MARKER}`, `# ${END_MARKER}`],
});

function claudeCodeAdapter(): HarnessAdapter {
  return {
    id: "claude-code",
    name: "Claude Code",
    wire: "anthropic",
    modelMode: "tiered",
    configPaths: ["~/.claude/settings.json"],
    render(ctx: SetupContext): ConfigWrite[] {
      const validModels = ctx.models.filter(
        (m) => !m.id.toLowerCase().includes("safety")
      );
      const nonReasoning = validModels.filter((m) => !m.reasoning);
      const reasoningModels = validModels.filter((m) => m.reasoning);

      const sortedReasoning = [...reasoningModels].sort(compareModelsByCapacity);
      const sortedNonReasoning = [...nonReasoning].sort(compareModelsByCapacity);

      const defaultModelDef = ctx.models.find((m) => m.id === ctx.defaultModel);

      // haiku maps to fast non-reasoning, opus to top reasoning, sonnet to daily
      const haikuModel = ctx.specificModel
        ? ctx.defaultModel
        : (sortedNonReasoning[0]?.id ?? ctx.defaultModel);

      const opusModel = ctx.specificModel
        ? ctx.defaultModel
        : (sortedReasoning[0]?.id ?? reasoningModels[0]?.id ?? ctx.defaultModel);

      let sonnetModel = ctx.defaultModel;
      if (!ctx.specificModel) {
        if (defaultModelDef?.reasoning) {
          sonnetModel = defaultModelDef.id;
        } else {
          sonnetModel = sortedReasoning[1]?.id ?? sortedReasoning[0]?.id ?? ctx.defaultModel;
        }
      }

      const env = {
        ANTHROPIC_BASE_URL: ctx.baseUrl.replace(/\/v1$/, ""),
        ANTHROPIC_AUTH_TOKEN: "bansos",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: haikuModel,
        ANTHROPIC_DEFAULT_SONNET_MODEL: sonnetModel,
        ANTHROPIC_DEFAULT_OPUS_MODEL: opusModel,
        CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
      };
      return [
        {
          path: "~/.claude/settings.json",
          content: `${JSON.stringify({ env }, null, 2)}\n`,
          mode: "merge",
        },
      ];
    },
    undo(): string[] {
      return ["~/.claude/settings.json"];
    },
    // keys bansos adds to settings.json (--undo removes only these)
    undoKeys: [
      "env.ANTHROPIC_BASE_URL",
      "env.ANTHROPIC_AUTH_TOKEN",
      "env.ANTHROPIC_DEFAULT_HAIKU_MODEL",
      "env.ANTHROPIC_DEFAULT_SONNET_MODEL",
      "env.ANTHROPIC_DEFAULT_OPUS_MODEL",
      "env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS",
    ],
  };
}

function aiderAdapter(): HarnessAdapter {
  return {
    id: "aider",
    name: "Aider",
    wire: "chat",
    modelMode: "single",
    configPaths: ["~/.aider.conf.yml", ".aider.conf.yml"],
    render(ctx: SetupContext): ConfigWrite[] {
      const lines = [
        `# ${START_MARKER}`,
        `openai_api_base: ${ctx.baseUrl}`,
        `openai_api_key: bansos`,
        `model: ${ctx.defaultModel}`,
        `# ${END_MARKER}`,
      ];
      return [
        {
          path: "~/.aider.conf.yml",
          content: `${lines.join("\n")}\n`,
          ...yamlBlock(),
        },
      ];
    },
    undo(): string[] {
      return ["~/.aider.conf.yml"];
    },
  };
}

function opencodeAdapter(): HarnessAdapter {
  return {
    id: "opencode",
    name: "OpenCode",
    wire: "chat",
    modelMode: "list",
    configPaths: [
      "~/.config/opencode/opencode.json",
      "~/.config/opencode/opencode.jsonc",
      "opencode.json",
      "opencode.jsonc",
    ],
    render(ctx: SetupContext): ConfigWrite[] {
      const modelEntries: Record<string, Record<string, unknown>> = {};
      if (ctx.specificModel) {
        modelEntries[ctx.defaultModel] = {};
      } else {
        const list = ctx.models.length > 0 ? ctx.models : [{ id: ctx.defaultModel }];
        for (const m of list) {
          modelEntries[m.id] = {};
        }
      }

      const provider = {
        bansos: {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: ctx.baseUrl, apiKey: "bansos", headers: { "x-bansos-client": "opencode" } },
          models: modelEntries,
        },
      };
      return [
        {
          path: "~/.config/opencode/opencode.json",
          content: `${JSON.stringify({ provider }, null, 2)}\n`,
          mode: "merge",
          replace: ["provider.bansos.models"],
        },
      ];
    },
    undo(): string[] {
      return [
        "~/.config/opencode/opencode.json",
        "~/.config/opencode/opencode.jsonc",
        "opencode.json",
        "opencode.jsonc",
      ];
    },
    undoKeys: ["provider.bansos"],
  };
}

function codexAdapter(): HarnessAdapter {
  return {
    id: "codex",
    name: "Codex CLI",
    wire: "responses",
    modelMode: "single",
    configPaths: ["~/.codex/config.toml", ".codex/config.toml"],
    render(ctx: SetupContext): ConfigWrite[] {
      const toml = [
        `model = "${ctx.defaultModel}"`,
        `model_provider = "bansos"`,
        "",
        `[model_providers.bansos]`,
        `name = "Bansos Router"`,
        `base_url = "${ctx.baseUrl}"`,
        `experimental_bearer_token = "bansos"`,
        `wire_api = "responses"`,
        `http_headers = { "x-bansos-client" = "codex" }`,
      ];
      return [
        {
          path: "~/.codex/config.toml",
          content: `${toml.join("\n")}\n`,
          mode: "toml-block",
          markers: [`# ${START_MARKER}`, `# ${END_MARKER}`],
          tomlTable: "model_providers.bansos",
        },
      ];
    },
    undo(): string[] {
      return ["~/.codex/config.toml", ".codex/config.toml"];
    },
  };
}

function hermesAdapter(): HarnessAdapter {
  return {
    id: "hermes",
    name: "Hermes (Nous)",
    wire: "chat",
    // one live model as the default, every picked model as a /model alias
    modelMode: "list",
    configPaths: ["~/.hermes/config.yaml"],
    render(ctx: SetupContext): ConfigWrite[] {
      const aliases = (ctx.specificModel ? [] : ctx.models).filter((m) => m.id !== ctx.defaultModel);
      const yaml = [
        `# ${START_MARKER}`,
        `model:`,
        `  provider: custom`,
        `  default: "${ctx.defaultModel}"`,
        `  base_url: "${ctx.baseUrl}"`,
        `  api_key: bansos`,
        ...(aliases.length > 0
          ? [
              `model_aliases:`,
              ...aliases.flatMap((m) => [
                `  ${m.id}:`,
                `    model: ${m.id}`,
                `    provider: custom`,
                `    base_url: "${ctx.baseUrl}"`,
                `    api_key: bansos`,
              ]),
            ]
          : []),
        `# ${END_MARKER}`,
      ];
      return [
        {
          path: "~/.hermes/config.yaml",
          content: `${yaml.join("\n")}\n`,
          ...yamlBlock(),
        },
      ];
    },
    undo(): string[] {
      return ["~/.hermes/config.yaml"];
    },
  };
}

function gooseAdapter(): HarnessAdapter {
  return {
    id: "goose",
    name: "Goose",
    wire: "chat",
    modelMode: "list",
    configPaths: ["~/.config/goose/custom_providers/bansos.json"],
    render(ctx: SetupContext): ConfigWrite[] {
      const models = ctx.specificModel
        ? [{ name: ctx.defaultModel, context_limit: 256000 }]
        : (ctx.models.length > 0 ? ctx.models : [{ id: ctx.defaultModel, contextWindow: 256000 }]).map((m) => ({
            name: m.id,
            context_limit: m.contextWindow || 256000,
          }));

      const provider = {
        name: "bansos",
        engine: "openai",
        display_name: "Bansos Router",
        description: "Free keyless models via bansos-router",
        api_key_env: "BANSOS_API_KEY",
        base_url: ctx.baseUrl,
        headers: { "x-bansos-client": "goose" },
        models,
      };
      return [
        {
          path: "~/.config/goose/custom_providers/bansos.json",
          content: `${JSON.stringify(provider, null, 2)}\n`,
          mode: "merge",
          replace: ["models"],
        },
      ];
    },
    undo(): string[] {
      return ["~/.config/goose/custom_providers/bansos.json"];
    },
    // file is dedicated to bansos; undo removes it entirely
    undoKeys: ["name", "engine", "display_name", "description", "api_key_env", "base_url", "headers", "models"],
  };
}

function openclawAdapter(): HarnessAdapter {
  return {
    id: "openclaw",
    name: "OpenClaw",
    wire: "chat",
    modelMode: "list",
    configPaths: [
      "~/.openclaw/config.json",
      "~/.openclaw/openclaw.json",
      "openclaw.json",
    ],
    render(ctx: SetupContext): ConfigWrite[] {
      const models = ctx.specificModel
        ? [{ id: ctx.defaultModel }]
        : (ctx.models.length > 0 ? ctx.models : [{ id: ctx.defaultModel }]).map((m) => ({
            id: m.id,
          }));

      const config = {
        models: {
          providers: {
            bansos: {
              baseUrl: ctx.baseUrl,
              apiKey: "bansos",
              api: "openai-completions",
              models,
            },
          },
        },
      };
      return [
        {
          path: "~/.openclaw/config.json",
          content: `${JSON.stringify(config, null, 2)}\n`,
          mode: "merge",
          replace: ["models.providers.bansos.models"],
        },
      ];
    },
    undo(): string[] {
      return [
        "~/.openclaw/config.json",
        "~/.openclaw/openclaw.json",
        "openclaw.json",
      ];
    },
    undoKeys: ["models.providers.bansos"],
  };
}

// jcode honours JCODE_HOME and falls back to ~/.jcode
function jcodeConfigPath(): string {
  return `${process.env.JCODE_HOME?.trim().replace(/\/+$/, "") || "~/.jcode"}/config.toml`;
}

function jcodeAdapter(): HarnessAdapter {
  return {
    id: "jcode",
    name: "JCode",
    wire: "chat",
    modelMode: "discovery",
    configPaths: [jcodeConfigPath()],
    render(ctx: SetupContext): ConfigWrite[] {
      const path = jcodeConfigPath();
      // each table needs its own marker pair: the writer strips the whole block
      // between markers first, so shared markers would delete the other table
      const markers: [string, string] = [`# ${START_MARKER}`, `# ${END_MARKER}`];
      const defaultMarkers: [string, string] = [
        "# bansos-router:provider-start",
        "# bansos-router:provider-end",
      ];
      // jcode only reads its startup selection from [provider], and only builds picker
      // routes for a non-active profile from this static list
      const models = ctx.specificModel
        ? [{ id: ctx.defaultModel }]
        : ctx.models.length > 0
          ? ctx.models.map((m) => ({ id: m.id }))
          : [{ id: ctx.defaultModel }];
      const profile = [
        `[providers.bansos]`,
        `type = "openai-compatible"`,
        `base_url = "${ctx.baseUrl}"`,
        // the router accepts any key; naming one only sends jcode looking for a file
        `auth = "none"`,
        `requires_api_key = false`,
        `model_catalog = true`,
        `default_model = "${ctx.defaultModel}"`,
        `models = [${models.map((m) => `{ id = "${m.id}" }`).join(", ")}]`,
      ].join("\n");

      return [
        {
          path,
          content: [`[provider]`, `default_provider = "bansos"`, `default_model = "${ctx.defaultModel}"`].join("\n"),
          mode: "toml-block",
          markers: defaultMarkers,
          tomlTable: "provider",
          fillOnly: true,
        },
        {
          path,
          content: profile,
          mode: "toml-block",
          markers,
          tomlTable: "providers.bansos",
        },
      ];
    },
    undo(): string[] {
      return [jcodeConfigPath()];
    },
    // jcode rewrites config.toml from its own model and drops comments, so the markers do not survive
    detect: (content) => /^\[providers\.bansos\]\s*$/m.test(content),
    undoContent: stripJcodeDefaults,
  };
}

function nineRouterAdapter(): HarnessAdapter {
  return {
    id: "9router",
    name: "9Router",
    wire: "chat",
    modelMode: "discovery",
    configPaths: ["~/.9router/db.json", "~/.9router/db/data.sqlite"],
    render(ctx: SetupContext): ConfigWrite[] {
      const db = {
        providerNodes: [
          {
            id: "openai-compatible-chat-bansos",
            name: "Bansos Router",
            type: "openai-compatible",
            prefix: "bansos",
            apiType: "chat",
            baseUrl: ctx.baseUrl,
          },
        ],
        providerConnections: [
          {
            id: "bansos-default",
            provider: "openai-compatible-chat-bansos",
            authType: "api_key",
            name: "Bansos Router",
            priority: 1,
            isActive: true,
            apiKey: "bansos",
          },
        ],
      };
      return [
        {
          path: "~/.9router/db.json",
          content: `${JSON.stringify(db, null, 2)}\n`,
          mode: "merge",
        },
      ];
    },
    undo(): string[] {
      return ["~/.9router/db.json", "~/.9router/db/data.sqlite"];
    },
    undoKeys: [
      "providerNodes.openai-compatible-chat-bansos",
      "providerConnections.bansos-default",
      "providerNodes.bansos",
      "providerConnections.bansos-default",
    ],
  };
}

function continueAdapter(): HarnessAdapter {
  return {
    id: "continue",
    name: "Continue (VS Code / JetBrains)",
    wire: "chat",
    modelMode: "list",
    // continue v1 reads config.yaml only; config.json is deprecated and ignored
    configPaths: ["~/.continue/config.yaml", ".continue/config.yaml"],
    render(ctx: SetupContext): ConfigWrite[] {
      const list = ctx.specificModel
        ? [{ id: ctx.defaultModel, name: ctx.defaultModel }]
        : ctx.models.length > 0
          ? ctx.models
          : [{ id: ctx.defaultModel, name: ctx.defaultModel }];
      const content = list
        .map((m) =>
          [
            `- name: Bansos - ${m.name ?? m.id}`,
            "  provider: openai",
            `  model: ${m.id}`,
            `  apiBase: ${ctx.baseUrl}`,
            "  apiKey: bansos",
            "  roles: [chat, edit, apply]",
          ].join("\n"),
        )
        .join("\n");
      return [
        {
          path: "~/.continue/config.yaml",
          content,
          mode: "yaml-block",
          markers: [`# ${START_MARKER}`, `# ${END_MARKER}`],
          yamlParent: "models",
        },
      ];
    },
    undo(ctx?: SetupContext): string[] {
      return ["~/.continue/config.yaml", ".continue/config.yaml"];
    },
    detect: (content) => CONTINUE_ITEM_RE.test(content),
    undoContent: removeContinueModels,
  };
}

// cline keeps provider settings in one file the extension, CLI and SDK all read
function clineAdapter(): HarnessAdapter {
  return {
    id: "cline",
    name: "Cline (VS Code / CLI)",
    wire: "chat",
    modelMode: "single",
    configPaths: ["~/.cline/data/settings/providers.json"],
    render(ctx: SetupContext): ConfigWrite[] {
      const targetModel = ctx.models.find((m) => m.id === ctx.defaultModel);
      const cfg = {
        version: 1,
        lastUsedProvider: "openai-compatible",
        providers: {
          "openai-compatible": {
            provider: "openai-compatible",
            apiKey: "bansos",
            model: ctx.defaultModel,
            baseUrl: ctx.baseUrl,
            contextWindow: targetModel?.contextWindow || 262144,
            maxTokens: targetModel?.maxTokens || 65536,
            headers: { "x-bansos-client": "cline" },
          },
        },
      };
      return [
        {
          path: "~/.cline/data/settings/providers.json",
          content: `${JSON.stringify(cfg, null, 2)}\n`,
          mode: "merge",
          replace: ["providers.openai-compatible"],
        },
      ];
    },
    undo(): string[] {
      return ["~/.cline/data/settings/providers.json"];
    },
    undoKeys: ["providers.openai-compatible", "lastUsedProvider"],
  };
}

function ompAdapter(): HarnessAdapter {
  return {
    id: "omp",
    name: "OMP (Oh My Pi)",
    wire: "chat",
    modelMode: "discovery",
    configPaths: ["~/.omp/agent/models.yml"],
    render(ctx: SetupContext): ConfigWrite[] {
      // column 0; applyYamlBlockWrite nests it under providers: at the right indent
      const child = [
        `bansos:`,
        `  name: bansos-router`,
        `  baseUrl: "${ctx.baseUrl}"`,
        `  apiKey: bansos`,
        `  api: openai-completions`,
        `  discovery:`,
        `    type: openai-models-list`,
        `    timeoutMs: 15000`,
      ];
      return [
        {
          path: "~/.omp/agent/models.yml",
          content: `${child.join("\n")}\n`,
          mode: "yaml-block",
          markers: [`# ${START_MARKER}`, `# ${END_MARKER}`],
          yamlParent: "providers",
        },
      ];
    },
    undo(): string[] {
      return ["~/.omp/agent/models.yml"];
    },
  };
}

// dsh ships one profile directory per entry point: web UI and terminal runs
const DSH_PROFILES = ["web", "headless"];
const DSH_ENTRY_RE = /^\s*-\s*(?:id|name):\s*['"]?(?:llm-pi-ai|@deepseek-ai\/dsh-llm-pi-ai)['"]?\s*$/;

function dshProviderBlock(ctx: SetupContext, indent: number): string[] {
  const pad = (n: number) => " ".repeat(indent + n);
  const models = ctx.models.length > 0 ? ctx.models : [{ id: ctx.defaultModel } as ModelDef];
  return [
    `${pad(0)}bansos:`,
    `${pad(2)}displayName: Bansos Router`,
    `${pad(2)}api: openai-completions`,
    `${pad(2)}baseURL: ${ctx.baseUrl}`,
    `${pad(2)}apiKeyEnv: BANSOS_API_KEY`,
    `${pad(2)}# dsh reads the key from the env or .credentials.yaml; the router checks none`,
    `${pad(2)}headers:`,
    `${pad(4)}x-bansos-client: dsh`,
    `${pad(2)}models:`,
    ...models.flatMap((m) => {
      const out = [`${pad(4)}- id: ${m.id}`];
      if (m.contextWindow) out.push(`${pad(6)}contextWindow: ${m.contextWindow}`);
      if (m.maxTokens) out.push(`${pad(6)}maxTokens: ${m.maxTokens}`);
      if (m.input?.length) out.push(`${pad(6)}input: [${m.input.join(", ")}]`);
      return out;
    }),
  ];
}

export type DshMerge =
  | { status: "merged"; content: string }
  | { status: "present" }
  | { status: "manual" }
  | { status: "no-entry" };

// dsh mounts a single llm-pi-ai entry: a second one would replace the providers it already holds
export function dshMergeProviders(content: string, ctx: SetupContext): DshMerge {
  const lines = content.split("\n");
  const entryIdx = lines.findIndex((l) => DSH_ENTRY_RE.test(l));
  if (entryIdx === -1) return { status: "no-entry" };
  const entryIndent = lines[entryIdx]!.length - lines[entryIdx]!.trimStart().length;

  let entryEnd = lines.length;
  for (let i = entryIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= entryIndent && /^\s*-/.test(line)) {
      entryEnd = i;
      break;
    }
  }

  let providersIdx = -1;
  for (let i = entryIdx + 1; i < entryEnd; i++) {
    if (/^\s*providers:\s*(#.*)?$/.test(lines[i]!)) {
      providersIdx = i;
      break;
    }
    if (/^\s*providers:\s*\S/.test(lines[i]!)) return { status: "manual" };
  }
  if (providersIdx === -1) return { status: "manual" };

  const providersIndent = lines[providersIdx]!.length - lines[providersIdx]!.trimStart().length;
  let insertAt = providersIdx + 1;
  for (let i = providersIdx + 1; i < entryEnd; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= providersIndent) break;
    if (/^\s*bansos:/.test(line)) return { status: "present" };
    insertAt = i + 1;
  }

  const indent = providersIndent + 2;
  const marker = " ".repeat(indent);
  lines.splice(
    insertAt,
    0,
    `${marker}# ${START_MARKER}`,
    ...dshProviderBlock(ctx, indent),
    `${marker}# ${END_MARKER}`,
  );
  return { status: "merged", content: lines.join("\n") };
}

// dsh resolves apiKeyEnv through its own store, the launch environment, then $DSH_HOME/.env
const DSH_KEY_ENV_FILE = "~/.dsh/.env";

function deepseekAdapter(): HarnessAdapter {
  return {
    id: "dsh",
    name: "DeepSeek Harness (dsh)",
    wire: "chat",
    modelMode: "list",
    configPaths: [
      ...DSH_PROFILES.map((p) => `~/.dsh/profiles/${p}/cordis.patch.yml`),
      DSH_KEY_ENV_FILE,
    ],
    render(ctx: SetupContext): ConfigWrite[] {
      const lines = [
        `# ${START_MARKER}`,
        `- id: llm-pi-ai`,
        `  config:`,
        `    providers:`,
        ...dshProviderBlock(ctx, 6),
        `# ${END_MARKER}`,
      ];
      return [
        ...DSH_PROFILES.map((p) => ({
          path: `~/.dsh/profiles/${p}/cordis.patch.yml`,
          content: `${lines.join("\n")}\n`,
          ...yamlBlock(),
        })),
        {
          path: DSH_KEY_ENV_FILE,
          // dsh fails a route whose key var is unset even though the router checks no key
          content: "BANSOS_API_KEY=bansos\n",
          ...yamlBlock(),
        },
      ];
    },
    undo(): string[] {
      return [...DSH_PROFILES.map((p) => `~/.dsh/profiles/${p}/cordis.patch.yml`), DSH_KEY_ENV_FILE];
    },
  };
}

export const ADAPTERS: HarnessAdapter[] = [
  claudeCodeAdapter(),
  aiderAdapter(),
  opencodeAdapter(),
  codexAdapter(),
  hermesAdapter(),
  gooseAdapter(),
  openclawAdapter(),
  jcodeAdapter(),
  nineRouterAdapter(),
  continueAdapter(),
  clineAdapter(),
  ompAdapter(),
  deepseekAdapter(),
];

export function findAdapter(id: string): HarnessAdapter | undefined {
  // the adapter shipped as "deepseek"; keep the old word working for scripts and muscle memory
  const wanted = id === "deepseek" ? "dsh" : id;
  return ADAPTERS.find((a) => a.id === wanted);
}

export interface ModelPick {
  model?: string;
  models?: string[];
  upstreams?: string[];
}

// a list or upstream pick narrows the models written; a single model pins one; neither means every model
export function buildSetupContext(baseUrl: string, pool: ModelDef[], pick: ModelPick): SetupContext | { error: string } {
  const ids = pick.models ?? [];
  const upstreams = pick.upstreams ?? [];
  if (pick.model) {
    if (ids.length > 0 || upstreams.length > 0) return { error: "pick either one model or a model list, not both" };
    return { baseUrl, defaultModel: pick.model, models: pool, specificModel: true };
  }
  if (ids.length === 0 && upstreams.length === 0) {
    return { baseUrl, defaultModel: pickSmartDefaultModel(pool), models: pool, specificModel: false };
  }
  const known = new Set(pool.map((m) => m.source));
  const badUpstreams = upstreams.filter((u) => !known.has(u as ModelDef["source"]));
  if (badUpstreams.length > 0) return { error: `no models from upstream: ${badUpstreams.join(", ")}` };
  const find = (id: string) => pool.find((m) => m.id === id) ?? pool.find((m) => m.id.endsWith(`/${id}`));
  const missing = ids.filter((id) => !find(id));
  if (missing.length > 0) return { error: `unknown or unavailable model: ${missing.join(", ")}` };
  const wanted = new Set(ids.map((id) => find(id)!.id));
  const models = pool.filter((m) => wanted.has(m.id) || upstreams.includes(m.source));
  return { baseUrl, defaultModel: pickSmartDefaultModel(models), models, specificModel: false };
}
