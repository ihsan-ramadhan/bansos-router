import type { WireProtocol } from "../protocols/internal";
import type { ModelDef } from "../upstreams/types";

export interface SetupContext {
  baseUrl: string;
  defaultModel: string;
  models: ModelDef[];
  specificModel?: boolean;
}

export interface ConfigWrite {
  path: string;
  content: string;
  // marker variants: overwrite-block (root append), toml-block (table-aware), yaml-block (nested under a key)
  mode: "merge" | "overwrite-block" | "toml-block" | "yaml-block";
  markers?: [string, string];
  // for toml-block: the table name the block defines (e.g. "providers.bansos")
  tomlTable?: string;
  // for yaml-block: the top-level key the block nests under (e.g. "providers")
  yamlParent?: string;
}

export interface HarnessAdapter {
  id: string;
  name: string;
  wire: WireProtocol;
  // candidate config locations; first existing wins (or create)
  configPaths: string[];
  // pure render; file writing happens in the cli (milestone M2)
  render(ctx: SetupContext): ConfigWrite[];
  undo(ctx: SetupContext): string[]; // paths that would be touched
  // for merge-mode writes: dotted keys that --undo removes
  undoKeys?: string[];
}

// standard marker pair used by every adapter
export const START_MARKER = "bansos-router:start";
export const END_MARKER = "bansos-router:end";
