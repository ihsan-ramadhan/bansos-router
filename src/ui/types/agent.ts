export type ModelMode = "list" | "tiered" | "single" | "discovery";

export interface ModelPick {
  model?: string;
  models?: string[];
  upstreams?: string[];
}

export interface AdapterSummary {
  id: string;
  name: string;
  wire: "chat" | "anthropic" | "responses";
  modelMode: ModelMode;
  configPaths: string[];
  status?: "configured" | "unconfigured" | "missing";
}

export interface ConfigWriteResult {
  path: string;
  content: string;
  mode: string;
}

export interface AdapterRenderResponse {
  id: string;
  name: string;
  wire: string;
  config: ConfigWriteResult[];
}
