import type { HarnessAdapter, SetupContext, ConfigWrite } from "./types";
import { START_MARKER, END_MARKER } from "./types";
import { compareModelsByCapacity } from "../upstreams/types";

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

      // Haiku (fast non-reasoning), Opus (top reasoning), Sonnet (daily reasoning)
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
          options: { baseURL: ctx.baseUrl },
          models: modelEntries,
        },
      };
      return [
        {
          path: "~/.config/opencode/opencode.json",
          content: `${JSON.stringify({ provider }, null, 2)}\n`,
          mode: "merge",
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
    configPaths: ["~/.hermes/config.yaml"],
    render(ctx: SetupContext): ConfigWrite[] {
      const yaml = [
        `# ${START_MARKER}`,
        `model:`,
        `  provider: custom`,
        `  default: "${ctx.defaultModel}"`,
        `  base_url: "${ctx.baseUrl}"`,
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
        base_url: ctx.baseUrl,
        models,
      };
      return [
        {
          path: "~/.config/goose/custom_providers/bansos.json",
          content: `${JSON.stringify(provider, null, 2)}\n`,
          mode: "merge",
        },
      ];
    },
    undo(): string[] {
      return ["~/.config/goose/custom_providers/bansos.json"];
    },
    // file is dedicated to bansos; undo removes it entirely
    undoKeys: ["name", "engine", "display_name", "base_url", "models"],
  };
}

function openclawAdapter(): HarnessAdapter {
  return {
    id: "openclaw",
    name: "OpenClaw",
    wire: "chat",
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

function antigravityAdapter(): HarnessAdapter {
  return {
    id: "antigravity",
    name: "Antigravity CLI",
    wire: "chat",
    configPaths: ["~/.config/antigravity/config.toml"],
    render(ctx: SetupContext): ConfigWrite[] {
      const toml = [
        `# ${START_MARKER}`,
        `base_url = "${ctx.baseUrl}"`,
        `model = "${ctx.defaultModel}"`,
        `api_key = "bansos"`,
        `# ${END_MARKER}`,
      ];
      return [
        {
          path: "~/.config/antigravity/config.toml",
          content: `${toml.join("\n")}\n`,
          ...tomlBlock(),
        },
      ];
    },
    undo(): string[] {
      return ["~/.config/antigravity/config.toml"];
    },
  };
}

function jcodeAdapter(): HarnessAdapter {
  return {
    id: "jcode",
    name: "JCode",
    wire: "chat",
    configPaths: ["~/.jcode/config.toml", "~/.config/jcode/openai-compatible.env"],
    render(ctx: SetupContext): ConfigWrite[] {
      const targetModel = ctx.models.find((m) => m.id === ctx.defaultModel);
      const contextWindow = targetModel?.contextWindow || 256000;
      const toml = [
        `default_provider = "openai-compatible"`,
        `default_model = "${ctx.defaultModel}"`,
        "",
        `[providers.openai-compatible]`,
        `type = "open-ai-compatible"`,
        `base_url = "${ctx.baseUrl}"`,
        `auth = "bearer"`,
        `model_catalog = true`,
        `context_window = ${contextWindow}`,
      ];
      const envLines = [
        `# ${START_MARKER}`,
        `JCODE_OPENAI_COMPAT_API_BASE=${ctx.baseUrl.replace(/\/v1$/, "")}`,
        `OPENAI_COMPAT_API_KEY=bansos`,
        `JCODE_OPENAI_COMPAT_LOCAL_ENABLED=1`,
        `# ${END_MARKER}`,
      ];
      return [
        {
          path: "~/.jcode/config.toml",
          content: `${toml.join("\n")}\n`,
          mode: "toml-block",
          markers: [`# ${START_MARKER}`, `# ${END_MARKER}`],
          tomlTable: "providers.openai-compatible",
        },
        {
          path: "~/.config/jcode/openai-compatible.env",
          content: `${envLines.join("\n")}\n`,
          mode: "overwrite-block",
          markers: [`# ${START_MARKER}`, `# ${END_MARKER}`],
        },
      ];
    },
    undo(): string[] {
      return ["~/.jcode/config.toml", "~/.config/jcode/openai-compatible.env"];
    },
  };
}

function nineRouterAdapter(): HarnessAdapter {
  return {
    id: "9router",
    name: "9Router",
    wire: "chat",
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
    configPaths: ["~/.continue/config.json", ".continue/config.json"],
    render(ctx: SetupContext): ConfigWrite[] {
      const list = ctx.specificModel
        ? [{ id: ctx.defaultModel, name: ctx.defaultModel }]
        : ctx.models.length > 0
          ? ctx.models
          : [{ id: ctx.defaultModel, name: ctx.defaultModel }];
      const models = list.map((m) => ({
        title: `Bansos - ${m.name ?? m.id}`,
        provider: "openai",
        model: m.id,
        apiBase: ctx.baseUrl,
        apiKey: "bansos",
      }));
      return [
        {
          path: "~/.continue/config.json",
          content: `${JSON.stringify({ models }, null, 2)}\n`,
          mode: "merge",
        },
      ];
    },
    undo(ctx?: SetupContext): string[] {
      return ["~/.continue/config.json", ".continue/config.json"];
    },
    undoKeys: [
      "models.Bansos",
    ],
  };
}

const OPENAI_COMPAT_UNDO_KEYS = [
  "apiProvider",
  "openAiBaseUrl",
  "openAiApiKey",
  "openAiModelId",
  "openAiCustomModelInfo",
];

function renderOpenAiCompatConfig(ctx: SetupContext, configPath: string): ConfigWrite[] {
  const targetModel = ctx.models.find((m) => m.id === ctx.defaultModel);
  const cfg = {
    apiProvider: "openai-compatible",
    openAiBaseUrl: ctx.baseUrl,
    openAiApiKey: "bansos",
    openAiModelId: ctx.defaultModel,
    openAiCustomModelInfo: {
      contextWindow: targetModel?.contextWindow || 262144,
      maxTokens: targetModel?.maxTokens || 65536,
    },
  };
  return [
    {
      path: configPath,
      content: `${JSON.stringify(cfg, null, 2)}\n`,
      mode: "merge",
    },
  ];
}

function clineAdapter(): HarnessAdapter {
  return {
    id: "cline",
    name: "Cline (VS Code)",
    wire: "chat",
    configPaths: ["~/.config/cline/config.json", "~/.cline/config.json"],
    render(ctx: SetupContext): ConfigWrite[] {
      return renderOpenAiCompatConfig(ctx, "~/.config/cline/config.json");
    },
    undo(): string[] {
      return ["~/.config/cline/config.json", "~/.cline/config.json"];
    },
    undoKeys: OPENAI_COMPAT_UNDO_KEYS,
  };
}

function rooAdapter(): HarnessAdapter {
  return {
    id: "roo",
    name: "Roo Code (VS Code)",
    wire: "chat",
    configPaths: ["~/.config/roo-cline/config.json", "~/.roo-cline/config.json"],
    render(ctx: SetupContext): ConfigWrite[] {
      return renderOpenAiCompatConfig(ctx, "~/.config/roo-cline/config.json");
    },
    undo(): string[] {
      return ["~/.config/roo-cline/config.json", "~/.roo-cline/config.json"];
    },
    undoKeys: OPENAI_COMPAT_UNDO_KEYS,
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
  antigravityAdapter(),
  jcodeAdapter(),
  nineRouterAdapter(),
  continueAdapter(),
  clineAdapter(),
  rooAdapter(),
];

export function findAdapter(id: string): HarnessAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id);
}
