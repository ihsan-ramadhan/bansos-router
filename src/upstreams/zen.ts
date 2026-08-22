import { randomUUID } from "node:crypto";
import { modelDef, type ModelDef, type Upstream } from "./types";

export const ZEN_BASE_URL = "https://opencode.ai/zen/v1";
export const ZEN_USER_AGENT = "opencode/latest/1.14.50/cli";

const ZEN_STATIC_HEADERS = {
  "User-Agent": ZEN_USER_AGENT,
  "x-opencode-client": "cli",
  "x-opencode-project": "default",
};

// pinned free models (carried over from pi-bansos)
export const ZEN_MODELS: ModelDef[] = [
  modelDef({
    id: "mimo-v2.5-free",
    name: "Mimo V2.5 Free",
    source: "zen",
    reasoning: false,
    contextWindow: 1_048_576,
    maxTokens: 131_072,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "nemotron-3-ultra-free",
    name: "Nemotron 3 Ultra",
    source: "zen",
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 65_536,
    input: ["text"],
    compat: { supportsReasoningEffort: true, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "big-pickle",
    name: "Big Pickle",
    source: "zen",
    reasoning: true,
    contextWindow: 200_000,
    maxTokens: 32_000,
    input: ["text"],
    compat: { supportsReasoningEffort: true, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "laguna-s-2.1-free",
    name: "Laguna S 2.1",
    source: "zen",
    reasoning: true,
    contextWindow: 262_144,
    maxTokens: 32_768,
    input: ["text"],
    compat: { supportsReasoningEffort: true, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "hy3-free",
    name: "Tencent HY3 Free",
    source: "zen",
    reasoning: true,
    contextWindow: 256_000,
    maxTokens: 65_536,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "nemotron-3.5-lightning-free",
    name: "Nemotron 3.5 Lightning Free",
    source: "zen",
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 65_536,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "x-preview-f-free",
    name: "Ox Alpha Free",
    source: "zen",
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 65_536,
    input: ["text"],
    compat: { supportsReasoningEffort: true, supportsDeveloperRole: false },
  }),
  modelDef({
    id: "muse-spark-1.2-contributor-free",
    name: "Muse Spark 1.2 Contributor Free",
    source: "zen",
    reasoning: false,
    contextWindow: 1_000_000,
    maxTokens: 65_536,
    input: ["text"],
    compat: { supportsReasoningEffort: false, supportsDeveloperRole: false },
  }),
];

export const zenUpstream: Upstream = {
  id: "zen",
  kind: "remote-keyless",
  relayAllowed: true,
  chatUrl: `${ZEN_BASE_URL}/chat/completions`,

  async fetchCatalog(): Promise<ModelDef[] | null> {
    // zen's /models returns claude-* ids, not our free coding models;
    // keep the seeded ZEN_MODELS instead of trusting that list
    return null;
  },

  requestHeaders(): Record<string, string> {
    return {
      ...ZEN_STATIC_HEADERS,
      "x-opencode-session": randomUUID(),
      "x-opencode-request": randomUUID(),
    };
  },
};
