import { llm7Upstream, LLM7_MODELS } from "./llm7";
import { kiloUpstream, KILO_MODELS } from "./kilo";
import { createLocalUpstream, type LocalUpstreamConfig } from "./local";
import { ovhUpstream, OVH_MODELS } from "./ovh";
import type { ModelDef, Upstream } from "./types";
import { zenUpstream, ZEN_MODELS } from "./zen";

export const DEFAULT_UPSTREAMS: Upstream[] = [zenUpstream, kiloUpstream, llm7Upstream, ovhUpstream];

export const SEEDED_MODELS: ModelDef[] = [
  ...ZEN_MODELS,
  ...KILO_MODELS,
  ...LLM7_MODELS,
  ...OVH_MODELS,
];

export function buildUpstreams(locals: LocalUpstreamConfig[] = []): Upstream[] {
  return [...DEFAULT_UPSTREAMS, ...locals.map(createLocalUpstream)];
}
