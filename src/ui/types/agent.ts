export interface AdapterSummary {
  id: string;
  name: string;
  wire: "chat" | "anthropic" | "responses";
  configPaths: string[];
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
