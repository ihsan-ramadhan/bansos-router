export type SecurityMode = "normal" | "strict";
export type DlpAction = "redact" | "block";

export interface SecuritySettings {
  mode: SecurityMode;
  dlp: DlpAction;
  allowedUpstreams: string[];
  allowCrossProviderFailover: boolean;
}

export interface DaemonSettings {
  security: SecuritySettings;
  refreshIntervalMs: number;
  port: number;
  bind: string;
}

export interface ConfigState {
  path: string;
  exists: boolean;
  invalid: boolean;
  warnings: string[];
  saved: DaemonSettings;
  running: DaemonSettings;
  upstreams: string[];
  flags: { port: boolean; bind: boolean; unsafeAllowNonLoopback: boolean };
  restartRequired: string[];
  canRestart: boolean;
}

export interface AutostartState {
  manager: "systemd" | "launchd" | "startup-folder" | null;
  supported: boolean;
  reason?: string;
  enabled: boolean;
  path?: string;
  command?: string[];
  broken: boolean;
}

export type HarnessState = "configured" | "unconfigured" | "missing";

export interface DoctorReport {
  version: string;
  update: { current: string; latest: string; hasUpdate: boolean };
  configWarnings: string[];
  security: Pick<DaemonSettings["security"], "mode" | "dlp" | "allowedUpstreams" | "allowCrossProviderFailover">;
  harnesses: Array<{ id: string; status: HarnessState; path?: string }>;
}

export interface SetupLine {
  kind: "ok" | "removed" | "skip" | "error";
  text: string;
}

export interface SetupResult {
  ok: boolean;
  lines: SetupLine[];
  harness?: { id: string; status: HarnessState; path?: string };
}

export interface BackupData {
  version: number;
  generator: string;
  timestamp: string;
  daemon: { version: string; platform: string };
  data: {
    config?: Record<string, unknown>;
    activity?: { updatedAt: number; events: unknown[] };
    relay?: { enabled: boolean; url: string; relays: unknown[] };
  };
}

export interface RestoreOptions {
  restoreConfig?: boolean;
  restoreActivity?: boolean;
  restoreRelay?: boolean;
  replaceActivity?: boolean;
}

export interface RestoreResponse {
  ok: boolean;
  restored: {
    config: boolean;
    activityCount: number;
    relay: boolean;
  };
  restartRequired: string[];
}
